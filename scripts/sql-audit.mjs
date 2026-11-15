#!/usr/bin/env node
/**
 * SQL 体检 / 关系补全（本地静态规则，不联网、不消耗积分）
 *
 *   node sql-audit.mjs --file schema.sql                    体检报告
 *   node sql-audit.mjs --file schema.sql --json             机器可读
 *   node sql-audit.mjs --file schema.sql --emit-dsl er.dsl  生成概念 E-R DSL 骨架
 *
 * 设计前提：渲染引擎只认两种关系 —— 显式 FOREIGN KEY，以及「xxx_id 且 base 能对上表名」。
 * 其余业务关联（字段根本没建、命名错位、多态外键、自引用树、字典枚举）
 * 引擎一律看不见，所以必须在出图前由本脚本指出来，交给调用方补进概念 DSL。
 *
 * 报告分四类，对应四种处理方式（详见 references/sql-to-erd.md）：
 *   T1 可推断 —— 引擎自动出图，不用管
 *   T2 可救   —— 改名或手写联系，字段在但命名不合规
 *   T3 结构缺失 —— 业务上必然有联系，但库里连字段都没有，只能靠业务理解补
 *   T4 不该画 —— 字典/框架/日志表，明确排除，避免凭空加实体
 */
import fs from "node:fs";

/* ─────────────────────────── 解析（与 src/lib/sql.ts 同算法） ─────────────────────────── */

function splitSqlStatements(sql) {
  const cleaned = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const result = [];
  let buffer = "";
  let quote = "";
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (quote) {
      buffer += char;
      if (char === quote) {
        if (cleaned[index + 1] === quote) { buffer += cleaned[index + 1]; index += 1; }
        else quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; buffer += char; continue; }
    if (char === ";") { if (buffer.trim()) result.push(buffer.trim()); buffer = ""; continue; }
    buffer += char;
  }
  if (buffer.trim()) result.push(buffer.trim());
  return result;
}

function splitTopLevel(input) {
  const result = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote && input[index + 1] === quote) index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(char)) quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) { result.push(input.slice(start, index).trim()); start = index + 1; }
  }
  result.push(input.slice(start).trim());
  return result.filter(Boolean);
}

function cleanIdentifier(value) {
  return value.trim().replace(/^\[|\]$/g, "").replace(/^["`]|["`]$/g, "").split(".").pop().replace(/^["`]|["`]$/g, "");
}

/** 生成器（SQLyog 模板）往 COMMENT 里塞的标记，概念图里不能出现。 */
function stripJunk(comment) {
  return (comment || "")
    .replace(/\b(?:Search\d*|show\d+|photoShow|nameShow|fileShow|videoShow|\w*Show\d*)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseTables(sql) {
  const tables = [];
  for (const statement of splitSqlStatements(sql).filter((item) => /^CREATE\s+TABLE/i.test(item))) {
    const open = statement.indexOf("(");
    const close = statement.lastIndexOf(")");
    if (open < 0 || close <= open) continue;
    const header = statement.slice(0, open).match(/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i);
    if (!header) continue;
    const name = cleanIdentifier(header[1]);
    const tail = statement.slice(close + 1);
    const comment = stripJunk(tail.match(/\bCOMMENT\s*=\s*'((?:[^']|'')*)'/i)?.[1]);
    const fields = [];
    const tablePk = new Set();
    const tableFk = [];

    for (const definition of splitTopLevel(statement.slice(open + 1, close))) {
      const pk = definition.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) { pk[1].split(",").forEach((col) => tablePk.add(cleanIdentifier(col))); continue; }
      const fk = definition.match(/^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([^\s(]+)/i);
      if (fk) {
        tableFk.push({ column: cleanIdentifier(fk[1].split(",")[0]), target: cleanIdentifier(fk[2]), explicit: true });
        continue;
      }
      const head = definition.match(/^("(?:[^"]|"")+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+([\s\S]+)$/);
      if (!head) continue;
      const fieldName = cleanIdentifier(head[1]);
      const rest = head[2];
      const type = (rest.match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?(?:\s*\([^)]*\))?)/)?.[1] || "TEXT").replace(/\s+/g, " ").toUpperCase();
      const rawComment = rest.match(/\bCOMMENT\s+'((?:[^']|'')*)'/i)?.[1] || "";
      const label = stripJunk(rawComment);
      const inlineRef = rest.match(/\bREFERENCES\s+([^\s(]+)/i);
      if (inlineRef) tableFk.push({ column: fieldName, target: cleanIdentifier(inlineRef[1]), explicit: true });
      fields.push({
        name: fieldName,
        label,
        rawComment,
        junk: /\b(?:Search\d*|show\d+|photoShow|nameShow)\b/i.test(rawComment),
        type,
        primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest),
        nullable: !/\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(rest),
        unique: /\bUNIQUE\b/i.test(rest),
        autoIncrement: /\bAUTO_INCREMENT\b/i.test(rest),
        defaultNull: /\bDEFAULT\s+NULL\b/i.test(rest),
      });
    }
    for (const field of fields) if (tablePk.has(field.name)) field.primaryKey = true;
    tables.push({ name, label: comment, hasComment: Boolean(comment), fields, explicitFk: tableFk });
  }
  return tables;
}

/* ─────────────────────────── 规则 ─────────────────────────── */

const SYSTEM_TABLE = /^(config|configuration|dictionary|dict|sys_?dict|token|session|sys_?config|sys_?log|operation_?log|admin_?log|login_?log|.*_log|qrtz_\w+|flyway_\w+|schema_version|migrations?)$/i;
const USER_TABLE = /^(users?|yonghu|admin|administrator|member|staff|employee|student|teacher|sys_?user)$/i;
const AUDIT_HINT = /(shenhe|audit|approv|examine|verify|check_?record|apply|shenqing)/i;
const ACTOR_HINT = /(shenhe_?user|shenhe_?ren|audit_?user|auditor|check_?user|operator_?id|handler_?id|admin_?id|reply_?user|reply_?id|create_?by|author_?id|publisher_?id|fabu_?user)/i;
/** 角色型外键：字段名描述的是「谁」，不是「哪张表」，按字面匹配必然失败。 */
const ROLE_SUFFIX = /^(manager|owner|creator|create_?user|author|reviewer|approver|handler|operator|leader|chief|checker|auditor|receiver|sender|from_?user|to_?user|reply_?user|shenhe_?user|fabu_?user|salesman|clerk)$/;
const BUSINESS_KEY = /^(username|user_name|login_?name|account|phone|mobile|tel|email|mail|id_?card|id_?number|shenfen|code)$/i;
const PII_HINT = /(password|passwd|pwd|身份证|id_?card|id_?number|手机号|phone|mobile|bank|card_?no)/i;
const CONTENT_HINT = /(_content|_text|content|_detail|detail|_desc|description)$/i;

function baseOf(column) {
  const normalized = column.toLowerCase();
  if (normalized === "id" || !/_?id$/.test(normalized)) return null;
  const base = normalized.replace(/_?id$/, "");
  return base || null;
}

/** 与引擎 inferReference 完全一致：base、base+s、去掉尾部 s。 */
function resolveTarget(column, names) {
  const base = baseOf(column);
  if (!base) return null;
  if (names.has(base)) return base;
  if (names.has(`${base}s`)) return `${base}s`;
  if (base.endsWith("s") && names.has(base.slice(0, -1))) return base.slice(0, -1);
  return null;
}

/** 概念图里联系名应是「动作」，不是「角色名」或实体名。与后端 conceptRelationshipLabel 同规则。 */
function relationshipLabel(childLabel, parentLabel, columnLabel, siblingLabels = []) {
  const column = (columnLabel || "").trim();
  if (!column) return "关联";
  if (column.endsWith("用户") && column.length > 2) return column.slice(0, -2);
  const prefixes = [column, parentLabel, ...siblingLabels].map((item) => (item || "").trim()).filter((item) => item && item !== childLabel);
  for (const prefix of new Set(prefixes)) {
    if (childLabel.startsWith(prefix) && childLabel.length > prefix.length) return childLabel.slice(prefix.length).trim() || column;
  }
  return column;
}

/**
 * 给一组联系定名，并尽量消除重名。
 *
 * 「去前缀」会撞车：宠物领养审核 → 审核、宠物认领审核 → 审核，
 * 在总 E-R 图里就是两个同名菱形（《数据库系统概论》所说的命名冲突）。
 *
 * 但限定词不能随便加：chen-er 的菱形是定宽的，「审核（宠物领养）」这种 8 字标签会撑出图形。
 * 所以只在「同组所有成员都能压到 2 字以内」时才加前缀 —— 宠物领养/宠物认领 的公共前缀是「宠物」，
 * 剩下 领养/认领，于是得到 领养审核 / 认领审核（各 4 字，菱形放得下）。
 * 压不下去的保持原名，由调用方在报告里提示人工区分。
 */
function nameRelations(relations, labelOf, columnLabelOf) {
  const raw = relations.map((rel) => {
    const childLabel = labelOf.get(rel.from.toLowerCase()) || rel.from;
    const parentLabel = labelOf.get(rel.to) || rel.to;
    const siblings = relations.filter((item) => item.from === rel.from && item.column !== rel.column).map((item) => columnLabelOf(item));
    const action = relationshipLabel(childLabel, parentLabel, columnLabelOf(rel), siblings);
    return { rel, childLabel, parentLabel, action, name: action };
  });

  const groups = new Map();
  for (const item of raw) {
    if (!groups.has(item.action)) groups.set(item.action, []);
    groups.get(item.action).push(item);
  }
  for (const [action, group] of groups) {
    if (group.length < 2) continue;
    // 取父实体的区分性片段：去掉组内公共前缀
    const parents = group.map((item) => item.parentLabel);
    let common = parents[0];
    for (const label of parents) {
      while (common && !label.startsWith(common)) common = common.slice(0, -1);
    }
    const tokens = parents.map((label) => label.slice(common.length));
    const usable = tokens.every((token) => token.length >= 1 && token.length <= 2) && new Set(tokens).size === group.length;
    if (usable) group.forEach((item, index) => { item.name = `${tokens[index]}${action}`; });
  }
  return raw;
}

function audit(sql) {
  const allTables = parseTables(sql);
  if (!allTables.length) throw new Error("未识别到 CREATE TABLE 语句，请检查 SQL 方言（当前只解析标准 CREATE TABLE）。");

  const names = new Set(allTables.map((table) => table.name.toLowerCase()));
  const business = allTables.filter((table) => !SYSTEM_TABLE.test(table.name));
  const issues = [];
  const add = (severity, tier, code, where, message, fix) => issues.push({ severity, tier, code, where, message, fix });

  /* ---- 1. 关系清单：显式 FK + 命名推断 ---- */
  const relations = [];
  for (const table of allTables) {
    for (const fk of table.explicitFk) {
      relations.push({ from: table.name, to: fk.target.toLowerCase(), column: fk.column, explicit: true });
    }
  }
  const declared = new Set(relations.map((rel) => `${rel.from}.${rel.column}`));
  for (const table of allTables) {
    for (const field of table.fields) {
      if (declared.has(`${table.name}.${field.name}`)) continue;
      const target = resolveTarget(field.name, names);
      if (target) relations.push({ from: table.name, to: target, column: field.name, explicit: false });
    }
  }

  /* ---- 2. T2：字段在、但引擎认不出目标表 ---- */
  for (const table of allTables) {
    for (const field of table.fields) {
      if (declared.has(`${table.name}.${field.name}`)) continue;
      const base = baseOf(field.name);
      if (!base) continue;
      if (resolveTarget(field.name, names)) continue;
      if (/^(super|parent|pid|father)$/.test(base)) {
        add("medium", "T2", "REL_SELF_TREE", `${table.name}.${field.name}`,
          `自引用树字段（${field.label || field.name}），引擎按「有对应表名」推断会漏掉`,
          `手写：relationship 层级 as Lv between ${cap(table.name)}, ${cap(table.name)} cardinality 1:n（或视为普通属性）`);
        continue;
      }
      if (ROLE_SUFFIX.test(base)) {
        add("medium", "T2", "REL_ROLE_NAMED", `${table.name}.${field.name}`,
          `角色型外键（${base}）—— 按字面匹配找不到同名表，但业务上通常指向用户表或本表自身`,
          `改名成 <真实表名>_id（如 operator_id → yonghu_id），或在概念 DSL 里手写这条联系并注明角色`);
        continue;
      }
      add("high", "T2", "REL_UNRESOLVED", `${table.name}.${field.name}`,
        `字段长得像外键（base = "${base}"），但没有名为 ${base} / ${base}s 的表，引擎不会画这条联系`,
        `若确实指向某张表：把字段改名为 <表名>_id，或直接在概念 DSL 里手写这条联系`);
    }
  }

  /* ---- 3. T2：命名错位（复制粘贴遗留）----
   * 注意：外键带「被引用表」的前缀是正确写法（chongwulingyangshenhe.chongwulingyang_id），
   * 只有「非外键字段挂着别的表前缀」才是复制粘贴 bug。三条豁免：
   *   ① 字段自带本表前缀 → 正确；
   *   ② 字段本身能解析成外键 → 正确；
   *   ③ 前缀命中本表名 → 正确（长表名优先，如 jiaoxueshipin_liuyan_text）。
   */
  for (const table of allTables) {
    const own = table.name.toLowerCase();
    for (const field of table.fields) {
      const lower = field.name.toLowerCase();
      if (lower.startsWith(`${own}_`)) continue;
      if (declared.has(`${table.name}.${field.name}`)) continue;
      if (resolveTarget(field.name, names)) continue;
      const prefix = allTables
        .map((item) => item.name.toLowerCase())
        .filter((item) => item !== own && item.length > 2)
        .sort((a, b) => b.length - a.length)
        .find((item) => lower.startsWith(`${item}_`));
      if (!prefix) continue;
      const rest = lower.slice(prefix.length + 1);
      add("high", "T2", "NAME_PREFIX_MISMATCH", `${table.name}.${field.name}`,
        `字段用了「${prefix}」表的前缀（${field.label || "无注释"}），但它在 ${table.name} 里 —— 复制粘贴遗留，语义已错位`,
        `改名为 ${own}_${rest}，并核对 COMMENT 是否也抄错了`);
    }
  }

  /* ---- 4. T4：字典枚举（引擎看不见，但也不该画成联系）---- */
  const dictFields = [];
  for (const table of allTables) {
    for (const field of table.fields) {
      if (/(_types?|_status|_state|_flag)$/i.test(field.name) && /INT|TINYINT|SMALLINT/i.test(field.type)) {
        dictFields.push({ table: table.name, field: field.name, label: field.label });
      }
    }
  }
  if (dictFields.length) {
    add("info", "T4", "DICT_COLUMN", `${dictFields.length} 个字段`,
      `字典/枚举字段（${dictFields.slice(0, 3).map((item) => item.field).join("、")}${dictFields.length > 3 ? " 等" : ""}），` +
      `引擎不建联系 —— 这是对的，概念图里应作为属性并显示中文含义`,
      `确认每个字段都有 COMMENT；缺注释的会退化成物理字段名，评委看不懂`);
  }

  /* ---- 5. T4：系统/框架表 ---- */
  const systemTables = allTables.filter((table) => SYSTEM_TABLE.test(table.name));
  if (systemTables.length) {
    add("info", "T4", "SYSTEM_TABLE", systemTables.map((table) => table.name).join("、"),
      `${systemTables.length} 张框架表会在概念 E-R 图中被自动排除（config / dictionary / token / 日志类）`,
      `不用处理。若论文需要说明，单独一段文字交代即可，不要画进概念图`);
  }

  /* ---- 6. T3：结构缺失 —— 业务上必然有联系，但字段都没有 ---- */
  for (const table of business) {
    const userFks = relations.filter((rel) => rel.from === table.name && USER_TABLE.test(rel.to));
    const label = table.label || table.name;

    if (AUDIT_HINT.test(table.name) && userFks.length === 1 && !table.fields.some((field) => ACTOR_HINT.test(field.name))) {
      add("high", "T3", "MISSING_AUDITOR", table.name,
        `「${label}」只有一个用户外键（${userFks[0].column}），没有审核人字段 —— ` +
        `除非这张表只有申请人没有审核人，否则「谁审的」这条联系在库里根本不存在`,
        `补 ${table.name}_shenhe_user_id 或 admin_id；概念图里该表与用户之间应是两条联系（申请 / 审核）`);
    }

    if (CONTENT_HINT.test(table.name) || table.fields.some((field) => CONTENT_HINT.test(field.name))) {
      if (!userFks.length) {
        add("medium", "T3", "MISSING_AUTHOR", table.name,
          `「${label}」有正文内容，但没有任何用户外键 —— 缺「发布者」联系`,
          `若内容由管理员发布，概念图按「管理员 1:n ${label}」补一条；若前台用户可发，需补 ${table.name === "news" ? "admin" : "yonghu"}_id 字段`);
      }
    }

    if (table.fields.some((field) => /^reply_/i.test(field.name)) && userFks.length < 2) {
      add("medium", "T3", "MISSING_REPLIER", table.name,
        `「${label}」有 reply_* 字段（回复内容/时间），但只有一个用户外键 —— 「谁回复的」没有落库`,
        `补 reply_user_id 或 admin_id；概念图里与用户之间应是「留言」「回复」两条联系`);
    }

    if (!table.fields.some((field) => ACTOR_HINT.test(field.name)) && /_number$|_count$/.test(table.fields.map((field) => field.name).join("|"))) {
      // 计数类表（点赞/收藏/浏览）通常需要「谁操作」，这里只做提醒，避免噪音
    }
  }

  /* ---- 7. 中介表：两个外键 + 只剩状态/时间 → M:N 被拆成了实体 ---- */
  const junctions = [];
  for (const table of business) {
    const fks = relations.filter((rel) => rel.from === table.name);
    if (fks.length !== 2) continue;
    const rest = table.fields.filter((field) => !field.primaryKey && !fks.some((rel) => rel.column === field.name));
    // 正文类字段最多允许 1 个（充当「联系属性」，如申请凭据）。
    // 出现 2 个以上正文 / 回复字段，说明这张表有自己的生命周期（留言 + 回复），是实体不是桥。
    const texts = rest.filter((field) => /(_text|_content)$/i.test(field.name));
    if (texts.length > 1) continue;
    const trivial = rest.every((field) => /(_types?|_status|_state|_flag|_text|_content|_remark|_beizhu|_reason|_score|_amount|_num|_count|_hours|_qty)$/i.test(field.name)
      || /^(INT|TINYINT|SMALLINT|MEDIUMINT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)/i.test(field.type)  // 数值型多半是联系属性（成绩/数量/时长）
      || /(create_time|insert_time|update_time|addtime|deletetime)$/i.test(field.name));
    if (!trivial) continue;
    junctions.push(table);
    add("medium", "T3", "M2M_JUNCTION", table.name,
      `「${table.label || table.name}」= 两个外键 + 状态/数值/时间，是多对多的中介表`,
      `概念图里还原成 m:n 联系（把状态、成绩这类字段挂到菱形上），不要画成一个独立实体 —— ` +
      `除非该申请需要独立生命周期（多次申请、可撤销），那就保留实体并说明`);
  }

  /* ---- 8. 同构表：结构完全一样 → 可合并 ---- */
  const shape = (table) => table.fields
    .map((field) => field.name.toLowerCase().replace(table.name.toLowerCase(), "*"))
    .sort().join(",");
  const byShape = new Map();
  for (const table of business) {
    // 只有「够宽 + 带外键」的同构才值得怀疑。department(id,name) 和 project(id,name)
    // 结构一样但显然不是冗余，误报比漏报更伤信任。
    if (table.fields.length < 5) continue;
    if (!relations.some((rel) => rel.from === table.name)) continue;
    const key = shape(table);
    if (!byShape.has(key)) byShape.set(key, []);
    byShape.get(key).push(table);
  }
  for (const group of byShape.values()) {
    if (group.length < 2) continue;
    add("medium", "T3", "ISOMORPHIC_TABLE", group.map((table) => table.name).join("、"),
      `${group.length} 张表结构完全同构 —— 现实中往往是「同一业务的不同类型」被复制成多张表`,
      `可合并成一张 + 类型字段；若为了论文规模保留，请在文档里说明为何拆表，否则会被质疑冗余`);
  }

  /* ---- 9. 同名异义（只查会导致「属性名撞车」或「角色混淆」的字段）---- */
  const relationColumns = new Set(relations.map((rel) => `${rel.from}.${rel.column}`));
  const labelByName = new Map();
  for (const table of allTables) {
    for (const field of table.fields) {
      if (!field.label) continue;
      // 时间类字段带上下文是正常的（收藏时间 / 公告时间），不算冲突
      if (/(_time|_at|_date|time|date)$/i.test(field.name)) continue;
      // 只关心枚举字段与外键字段：它们的中文名会直接变成概念图上的属性名或联系名
      const isEnum = /(_types?|_status|_state|_flag)$/i.test(field.name);
      const isRel = relationColumns.has(`${table.name}.${field.name}`);
      if (!isEnum && !isRel) continue;
      const key = field.name.toLowerCase();
      if (!labelByName.has(key)) labelByName.set(key, new Map());
      labelByName.get(key).set(field.label, [...(labelByName.get(key).get(field.label) || []), table.name]);
    }
  }
  for (const [name, labels] of labelByName) {
    if (labels.size < 2) continue;
    const detail = [...labels.entries()].map(([label, tables]) => `${label}（${tables.join("、")}）`).join(" / ");
    const isRel = allTables.some((table) => relationColumns.has(`${table.name}.${name}`));
    add(isRel ? "high" : "medium", "T2", "SAME_NAME_DIFF_MEANING", name,
      `同一字段名承担了不同语义：${detail}`,
      isRel
        ? `外键被当成多角色复用：概念图里会画成同一条联系，但业务上是「申请人」和「审核人」两件事，必须拆成两条`
        : `概念图里属性名会撞车，读图人无法分辨；改成 xxx_类型 / xxx_状态 这类带主体的名字`);
  }

  /* ---- 10. 主键 / 业务键 / 基数 ---- */
  let junkTotal = 0;
  const noTableComment = [];
  for (const table of allTables) {
    if (!table.fields.some((field) => field.primaryKey)) {
      add("high", "T2", "NO_PRIMARY_KEY", table.name,
        `没有主键 —— 实体无法唯一标识，1:n 联系会退化成 m:n`,
        `补自增主键；概念图里该实体的「主键」属性只能标成普通属性，不符合规范`);
    }
    if (SYSTEM_TABLE.test(table.name)) continue;
    for (const field of table.fields) {
      if (field.primaryKey || field.unique) continue;
      const looksKey = BUSINESS_KEY.test(field.name) || /(账户|用户名|手机号|身份证|邮箱|编号|学号|工号)/.test(field.label);
      if (!looksKey) continue;
      add("medium", "T2", "NO_UNIQUE_KEY", `${table.name}.${field.name}`,
        `看起来是业务键（${field.label || field.name}），但没有 UNIQUE 约束`,
        `业务上重复会导致「一个用户两条记录」，概念图里也说不清谁是标识属性`);
    }
    if (!table.hasComment) noTableComment.push(table.name);
    // 逐字段的注释问题按表聚合：一张表十几个字段全报一遍会把真正的高危项淹掉
    const noComment = table.fields.filter((field) => !field.label && !field.primaryKey && !relationColumns.has(`${table.name}.${field.name}`));
    if (noComment.length) {
      add("low", "T2", "NO_COLUMN_COMMENT", `${table.name}（${noComment.length} 个字段）`,
        `字段缺 COMMENT：${noComment.slice(0, 4).map((field) => field.name).join("、")}${noComment.length > 4 ? " 等" : ""}`,
        `补中文 COMMENT；否则概念 E-R 图只能显示英文物理名，论文里不能用`);
    }
    const junk = table.fields.filter((field) => field.junk);
    if (junk.length) junkTotal += junk.length;
  }
  if (junkTotal) {
    add("low", "T2", "COMMENT_JUNK", `${junkTotal} 个字段`,
      `COMMENT 里混着代码生成器标记（Search111 / show1 / photoShow）`,
      `引擎会自动剥离，不影响出图；但反过来说明这套表是生成器产出而非手工设计，论文里别声称"自主设计"`);
  }
  if (noTableComment.length === 1) {
    add("medium", "T2", "NO_TABLE_COMMENT", noTableComment[0],
      `表没有 COMMENT —— 概念 E-R 图只能显示物理表名 ${noTableComment[0]}`,
      `补 COMMENT='中文实体名'；这是论文插图能不能看懂的前提`);
  } else if (noTableComment.length > 1) {
    add("medium", "T2", "NO_TABLE_COMMENT", `${noTableComment.length} 张表`,
      `表缺 COMMENT：${noTableComment.slice(0, 5).join("、")}${noTableComment.length > 5 ? " 等" : ""} —— 概念图里会显示成英文表名`,
      `补 COMMENT='中文实体名'；这是论文插图能不能看懂的前提`);
  }

  /* ---- 11. 类型与时间字段 ---- */
  for (const table of allTables) {
    for (const field of table.fields) {
      const width = field.type.match(/^INT\s*\(\s*(\d+)\s*\)$/i);
      if (width && Number(width[1]) > 11) {
        add("low", "T2", "INT_WIDTH_JUNK", `${table.name}.${field.name}`, `类型写成 ${field.type} —— 显示宽度在 MySQL 8 已废弃，且 >11 无意义`, `改成 INT 或 INT(11)`);
      }
      if (PII_HINT.test(field.name) || PII_HINT.test(field.label)) {
        if (/^VARCHAR\s*\(\s*(2|3)\d\d\s*\)$/i.test(field.type) || /TEXT/i.test(field.type)) {
          add("low", "T2", "PII_PLAINTEXT", `${table.name}.${field.name}`, `敏感字段（${field.label || field.name}）明文存储，长度 ${field.type}`, `入库加密/脱敏；概念图中不必画出，或标注「加密」`);
        }
      }
    }
    const times = table.fields.map((field) => field.name.toLowerCase()).filter((name) => /(_time|_at|time|date)$/.test(name));
    if (times.includes("create_time") && times.includes("insert_time")) {
      add("low", "T2", "DUPLICATE_TIME", table.name, `同时存在 create_time 与 insert_time，语义重叠`, `统一成一个；概念图属性表里两个都画会显得冗余`);
    }
  }

  if (allTables.every((table) => !table.explicitFk.length)) {
    add("info", "T1", "NO_EXPLICIT_FK", `${allTables.length} 张表`,
      `整个脚本没有一条 FOREIGN KEY 约束 —— 关系全部依赖 xxx_id 命名推断`,
      `能推断出来的照常出图；推断不出的看下面 T2/T3 条目。论文里可以说明「物理层未建约束，逻辑层按业务补全」`);
  }

  /* ---- 12. 富文本泄漏 ---- */
  const html = (sql.match(/'<p[^']{0,40}/g) || []).length;
  if (html) {
    add("low", "T2", "RICH_TEXT_LEAK", `${html} 处 INSERT`,
      `正文里直接存了 HTML 片段（'<p><span style=...>），说明富文本未净化`,
      `概念层无影响；但若要交付修正版 DDL，建议注明「正文存净化后的 HTML」`);
  }

  /* ---- 13. 联系重名（总 E-R 图里的命名冲突）---- */
  const bizNames = new Set(business.map((table) => table.name.toLowerCase()));
  const drawnRelations = relations.filter((rel) => bizNames.has(rel.from.toLowerCase()) && bizNames.has(rel.to));
  const labelOf = new Map(allTables.map((table) => [table.name.toLowerCase(), table.label || table.name]));
  const colLabel = (rel) => allTables.find((table) => table.name === rel.from)?.fields.find((field) => field.name === rel.column)?.label || rel.column;
  const nameCount = new Map();
  for (const item of nameRelations(drawnRelations, labelOf, colLabel)) {
    if (!nameCount.has(item.name)) nameCount.set(item.name, []);
    nameCount.get(item.name).push(`${item.parentLabel}→${item.childLabel}`);
  }
  for (const [name, pairs] of nameCount) {
    if (pairs.length < 2) continue;
    add("info", "T2", "REL_NAME_DUPLICATE", `联系「${name}」`,
      `${pairs.length} 条联系重名（${pairs.join("、")}）—— 总 E-R 图里会出现多个同名菱形，属于命名冲突`,
      `若两处语义相同可保留；语义不同请拆成「XX${name}」（如 领养审核 / 认领审核）。菱形是定宽的，限定词尽量压到 2 字`);
  }

  return { tables: allTables, business, relations, issues, junctions };
}

const cap = (name) => `T_${String(name).replace(/[^\w-]/g, "_")}`;

/* ─────────────────────────── 输出 ─────────────────────────── */

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const SEVERITY_LABEL = { high: "【高】", medium: "【中】", low: "【低】", info: "【提示】" };

function printReport(result, sqlPath) {
  const { tables, business, relations, issues } = result;
  const explicit = relations.filter((rel) => rel.explicit).length;
  const inferred = relations.filter((rel) => !rel.explicit).length;
  const excluded = tables.length - business.length;
  const businessNames = new Set(business.map((table) => table.name.toLowerCase()));
  const labelOf = new Map(tables.map((table) => [table.name.toLowerCase(), table.label || table.name]));
  // 联系名要按「外键字段的 COMMENT」推，且同表的其它外键注释也参与去前缀（与后端 conceptRelationshipLabel 一致）
  const columnLabel = (rel) => tables.find((table) => table.name === rel.from)?.fields.find((field) => field.name === rel.column)?.label || rel.column;
  const drawn = relations.filter((rel) => businessNames.has(rel.from.toLowerCase()) && businessNames.has(rel.to));
  const named = new Map(nameRelations(relations, labelOf, columnLabel).map((item) => [item.rel, item.name]));

  console.log(`SQL 体检 · ${sqlPath}`);
  console.log(`${tables.length} 张表 / 显式外键 ${explicit} 条 / 命名推断 ${inferred} 条 / 概念图排除 ${excluded} 张`);
  console.log(`能画进概念 E-R 图的联系：${drawn.length} 条\n`);

  console.log("关系清单（引擎能画出来的）");
  for (const rel of relations) {
    const inGraph = businessNames.has(rel.from.toLowerCase()) && businessNames.has(rel.to);
    const mark = inGraph ? (rel.explicit ? "FK" : "≈ ") : "× ";
    const name = named.get(rel);
    const suffix = inGraph ? `1:n   联系名「${name}」` : "涉及系统表，概念图自动排除";
    console.log(`  ${mark} ${`${rel.from}.${rel.column}`.padEnd(46)} → ${rel.to.padEnd(22)} ${suffix}`);
  }
  console.log("");
  if (!relations.length) console.log("  （没有识别到任何关系 —— 表之间可能完全独立，或字段命名无法推断）\n");

  const groups = new Map();
  for (const issue of issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) {
    const key = `${issue.severity}|${issue.tier}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  const TIER_LABEL = { T1: "可推断", T2: "可救·改命名", T3: "结构缺失·工程师必须补", T4: "不该画" };
  for (const [key, list] of groups) {
    const [severity, tier] = key.split("|");
    console.log(`${SEVERITY_LABEL[severity]} ${tier} ${TIER_LABEL[tier]}`);
    for (const issue of list) {
      console.log(`  ${issue.code.padEnd(22)} ${issue.where}`);
      console.log(`      ${issue.message}`);
      console.log(`      → ${issue.fix}`);
    }
    console.log("");
  }
  const high = issues.filter((issue) => issue.severity === "high").length;
  console.log(high
    ? `结论：${high} 条高优先级问题会让 E-R 图缺关系或语义错位，出图前先处理。`
    : "结论：没有高优先级问题，可以直接出图。");
}

function emitDsl(result, outPath, title) {
  const { tables, business, relations } = result;
  const businessNames = new Set(business.map((table) => table.name.toLowerCase()));
  const usable = relations.filter((rel) => businessNames.has(rel.from.toLowerCase()) && businessNames.has(rel.to.toLowerCase()));
  const labelOf = new Map(tables.map((table) => [table.name.toLowerCase(), table.label || table.name]));
  const lines = [`title: ${title}`, ""];

  for (const table of business) {
    const fks = new Set(usable.filter((rel) => rel.from === table.name).map((rel) => rel.column));
    const pk = table.fields.find((field) => field.primaryKey);
    const pkName = pk ? (pk.label === "主键" || !pk.label ? "编号" : pk.label) : null;
    lines.push(`entity ${table.label || table.name} as ${cap(table.name)} {`);
    if (pkName) lines.push(`  key ${pkName}`);
    const used = new Set([pkName]);
    for (const field of table.fields) {
      if (field.primaryKey || fks.has(field.name)) continue;
      let name = field.label || field.name;
      if (!name) continue;
      while (used.has(name)) name = `${name}(${field.name})`;
      used.add(name);
      lines.push(`  attribute ${name}`);
    }
    lines.push("}");
  }
  lines.push("");

  const columnLabel = (rel) => tables.find((table) => table.name === rel.from)?.fields.find((field) => field.name === rel.column)?.label || rel.column;
  const named = nameRelations(usable, labelOf, columnLabel);
  named.forEach((item, index) => {
    lines.push(`relationship ${item.name} as R${index + 1} between ${cap(item.rel.to)}, ${cap(item.rel.from)} cardinality 1:n`);
  });

  // 注释块只放「关系层面」的待确认项。类型宽度、时间字段重复、明文存储这些属于 DDL 质量问题，
  // 与画图无关，塞进来只会让调用方以为要改 29 处才能出图。
  const RELATION_CODES = new Set([
    "NAME_PREFIX_MISMATCH", "REL_UNRESOLVED", "REL_SELF_TREE", "SAME_NAME_DIFF_MEANING",
    "MISSING_AUDITOR", "MISSING_AUTHOR", "MISSING_REPLIER", "M2M_JUNCTION", "ISOMORPHIC_TABLE",
  ]);
  const pending = result.issues.filter((issue) => RELATION_CODES.has(issue.code));
  if (pending.length) {
    lines.push("", "# ── 以下联系引擎推断不出来，需按业务确认后手工补写（改完删掉本段注释）");
    for (const issue of pending) {
      lines.push(`# [${issue.code}] ${issue.where} — ${issue.message}`);
    }
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(`✓ 概念 E-R DSL 骨架 → ${outPath}（${business.length} 实体 / ${usable.length} 联系 / ${pending.length} 条待确认）`);
  console.log("  下一步：node ds.mjs er --file " + outPath + " --outdir out/er");
}

/* ─────────────────────────── 入口 ─────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : null;
};

const file = value("file");
if (!file) {
  console.error(`SQL 体检（本地规则，不联网、不扣积分）

  node sql-audit.mjs --file schema.sql                    体检报告
  node sql-audit.mjs --file schema.sql --json             机器可读
  node sql-audit.mjs --file schema.sql --emit-dsl er.dsl  生成概念 E-R DSL 骨架
                     [--title "宠物领养系统 E-R 模型"]`);
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`✗ 找不到文件：${file}`);
  process.exit(1);
}

try {
  const sql = fs.readFileSync(file, "utf8");
  const result = audit(sql);
  if (flag("json")) {
    console.log(JSON.stringify({ tables: result.tables.length, relations: result.relations, issues: result.issues }, null, 2));
  } else {
    printReport(result, file);
  }
  const dsl = value("emit-dsl");
  if (dsl) emitDsl(result, dsl, value("title") || "系统概念 E-R 模型");
  // 高优先级问题用退出码 2 表示「能出图但不该直接交付」，便于脚本串联
  if (result.issues.some((issue) => issue.severity === "high")) process.exitCode = 2;
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
