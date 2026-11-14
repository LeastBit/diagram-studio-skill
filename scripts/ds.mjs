#!/usr/bin/env node
/**
 * SE Diagram Studio 命令行客户端（零依赖，Node 18+）
 *
 *   node ds.mjs kinds                                  列出 13 种图型
 *   node ds.mjs syntax <kind>                          打印该图型的 DSL 语法与示例
 *   node ds.mjs render --kind flowchart --file a.dsl --out a.svg
 *   node ds.mjs check  --kind flowchart --file a.dsl   只做规范校验，不落地文件
 *   node ds.mjs batch  --manifest list.json --outdir out
 *   node ds.mjs er     --file schema.sql --outdir er
 *
 * 通用参数：--base https://yougood.ggff.net / --key sk-xxx
 * 也可用环境变量 DIAGRAM_STUDIO_BASE / DIAGRAM_STUDIO_API_KEY。
 */
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.DIAGRAM_STUDIO_BASE || "https://yougood.ggff.net").replace(/\/+$/, "");
const KEY = process.env.DIAGRAM_STUDIO_API_KEY || "";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[name] = true;
      else { out[name] = next; i += 1; }
    } else out._.push(token);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const base = (typeof args.base === "string" ? args.base : BASE).replace(/\/+$/, "");
const key = typeof args.key === "string" ? args.key : KEY;

function die(message, code = 1) {
  console.error(`✗ ${message}`);
  process.exit(code);
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/** 需要鉴权的命令先做一次提示：缺 Key 时服务端会 401，提前说明比让用户猜要好。 */
function preflight() {
  if (key) return;
  console.error("提示：未检测到 DIAGRAM_STUDIO_API_KEY。请先 export DIAGRAM_STUDIO_API_KEY='sk-...'（或在命令后加 --key sk-...）。");
}

function readSource() {
  if (typeof args.file === "string") {
    if (!fs.existsSync(args.file)) die(`找不到文件：${args.file}`);
    return fs.readFileSync(args.file, "utf8");
  }
  if (typeof args.source === "string") return args.source;
  if (args.source === true) die("--source 后面要跟 DSL 文本，长文本建议改用 --file。");
  // 没有 --file 也没有 --source 时从 stdin 读，便于管道
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    die("缺少 DSL 输入：请用 --file <路径> 或从 stdin 传入。");
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function pageFromArgs() {
  const page = {};
  if (typeof args.orientation === "string") page.orientation = args.orientation;
  if (typeof args.margin === "string") page.margin = Number(args.margin);
  if (typeof args.font === "string") page.fontFamily = args.font;
  if (typeof args["font-size"] === "string") page.fontSize = Number(args["font-size"]);
  if (typeof args.theme === "string") page.theme = args.theme;
  if (typeof args.fit === "string") page.fit = args.fit;
  if (typeof args.caption === "string") page.caption = args.caption;
  if (args["no-page-frame"] === true) page.showPage = false;
  return Object.keys(page).length ? page : undefined;
}

async function postJson(url, body) {
  const response = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  return response;
}

async function describeError(response) {
  const text = await response.text().catch(() => "");
  let message = text;
  try { message = JSON.parse(text).message ?? text; } catch { /* 非 JSON，原样输出 */ }
  return `HTTP ${response.status} — ${message || response.statusText}`;
}

async function cmdKinds() {
  const response = await fetch(`${base}/api/v1/capabilities`);
  if (!response.ok) die(await describeError(response));
  const data = await response.json();
  console.log(`SE Diagram Studio · ${base}`);
  console.log(`共 ${data.kinds.length} 种图型\n`);
  for (const item of data.kinds) {
    console.log(`  ${item.kind.padEnd(14)} ${item.name.padEnd(18)} ${item.standard}`);
  }
  console.log("\n查看语法：node ds.mjs syntax <kind>");
}

async function cmdSyntax() {
  const kind = args._[1];
  if (!kind) die("用法：node ds.mjs syntax <kind>");
  const response = await fetch(`${base}/api/v1/capabilities`);
  if (!response.ok) die(await describeError(response));
  const data = await response.json();
  const item = data.kinds.find((entry) => entry.kind === kind);
  if (!item) die(`未知图型 ${kind}，可选：${data.kinds.map((k) => k.kind).join(", ")}`);
  console.log(`${item.kind} · ${item.name} · ${item.standard}\n`);
  console.log(`语法：${item.syntax}\n`);
  console.log("示例：");
  console.log(item.example);
}

async function cmdRender() {
  preflight();
  const kind = args.kind;
  if (typeof kind !== "string") die("缺少 --kind，可用 node ds.mjs kinds 查看。");
  const format = args.format === "png" ? "png" : "svg";
  const source = readSource();
  if (!source.trim()) die("DSL 内容为空。");

  const body = { kind, source };
  const page = pageFromArgs();
  if (page) body.page = page;
  if (format === "png") body.dpi = Number(args.dpi === "600" ? 600 : 300);

  const endpoint = `${base}/api/v1/render/${format}`;
  const response = await postJson(endpoint, body);
  if (!response.ok) die(await describeError(response));

  const buffer = Buffer.from(await response.arrayBuffer());
  const out = typeof args.out === "string"
    ? args.out
    : path.join("out", `${kind}-${Date.now()}.${format}`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buffer);

  const issues = response.headers.get("x-diagram-errors") ?? "0";
  console.log(`✓ ${kind} → ${out}  ${(buffer.length / 1024).toFixed(1)}KB`);
  console.log(`  规范错误数：${issues}${issues === "0" ? "（符合标准画法）" : "（建议跑 node ds.mjs check 看具体条目）"}`);
}

async function cmdCheck() {
  preflight();
  const kind = args.kind;
  if (typeof kind !== "string") die("缺少 --kind。");
  const source = readSource();
  const response = await postJson(`${base}/api/v1/render/batch`, { format: "json", items: [{ kind, source }] });
  if (!response.ok) die(await describeError(response));
  const data = await response.json();
  const item = data.results?.[0];
  if (!item?.ok) die(item?.message ?? "校验失败");
  const issues = item.issues ?? [];
  const errors = issues.filter((entry) => entry.severity === "error");
  const warnings = issues.filter((entry) => entry.severity === "warning");
  console.log(`节点 ${item.model.nodes.length} · 连线 ${item.model.edges.length} · 错误 ${errors.length} · 建议 ${warnings.length}`);
  for (const entry of issues) {
    console.log(`  [${entry.severity}] ${entry.code} ${entry.message}${entry.rule ? `（${entry.rule}）` : ""}`);
  }
  if (errors.length) process.exitCode = 1;
}

async function cmdBatch() {
  preflight();
  if (typeof args.manifest !== "string") die("缺少 --manifest <json>。");
  const manifest = JSON.parse(fs.readFileSync(args.manifest, "utf8"));
  const items = Array.isArray(manifest) ? manifest : manifest.items;
  if (!Array.isArray(items) || !items.length) die("manifest 需要是数组或 { items: [...] }。");
  if (items.length > 10) die("单次 batch 最多 10 张，请拆成多次。");

  const format = args.format === "png" ? "png" : "svg";
  const response = await postJson(`${base}/api/v1/render/batch`, { format, items, dpi: Number(args.dpi === "600" ? 600 : 300) });
  if (!response.ok) die(await describeError(response));
  const data = await response.json();

  const outdir = typeof args.outdir === "string" ? args.outdir : "out";
  fs.mkdirSync(outdir, { recursive: true });
  let saved = 0;
  for (const item of data.results) {
    if (!item.ok) { console.log(`  ✗ #${item.index} ${item.kind}: ${item.message}`); continue; }
    const name = path.join(outdir, `${String(item.index).padStart(2, "0")}-${item.kind}.${format}`);
    if (format === "svg") fs.writeFileSync(name, item.svg);
    else fs.writeFileSync(name, Buffer.from(item.base64, "base64"));
    const errors = (item.issues ?? []).filter((entry) => entry.severity === "error").length;
    console.log(`  ✓ #${item.index} ${item.kind} → ${name}（规范错误 ${errors}）`);
    saved += 1;
  }
  console.log(`共 ${data.count} 张，成功 ${data.succeeded} 张，已保存 ${saved} 个文件到 ${outdir}/`);
}

async function cmdEr() {
  preflight();
  const source = typeof args.file === "string" ? fs.readFileSync(args.file, "utf8") : readStdin();
  if (!source.trim()) die("缺少 --file（概念 E-R DSL 或 CREATE TABLE 语句）。");
  const format = args.format === "png" ? "png" : "svg";
  const response = await postJson(`${base}/api/v1/er/views`, { source, format, dpi: Number(args.dpi === "600" ? 600 : 300) });
  if (!response.ok) die(await describeError(response));
  const data = await response.json();

  const outdir = typeof args.outdir === "string" ? args.outdir : "out/er";
  fs.mkdirSync(outdir, { recursive: true });
  const write = (view, name) => {
    if (!view) return;
    const file = path.join(outdir, `${name}.${format}`);
    if (format === "svg") fs.writeFileSync(file, view.svg);
    else fs.writeFileSync(file, Buffer.from(view.pngBase64, "base64"));
    console.log(`  ✓ ${name} → ${file}`);
  };
  console.log(`实体 ${data.entities.length} · 联系 ${data.relationships.length} · 集成提示 ${data.conflicts.length}`);
  const safe = (value) => String(value ?? "").replace(/[\\/:*?"<>|：]/g, "-").slice(0, 60);
  data.partials.forEach((view, index) => write(view, `${String(index + 1).padStart(2, "0")}-分ER-${safe(view.title || view.id)}`));
  write(data.global, "总ER-不含属性");
  if ((data.globalPages?.length ?? 0) > 1) {
    data.globalPages.forEach((view, index) => write(view, `总ER-不含属性-第${index + 1}页`));
  }
  if ((data.globalFullPages?.length ?? 0) > 0) {
    data.globalFullPages.forEach((view, index) => write(view, `总ER-含属性-第${index + 1}页`));
  }
  for (const item of data.conflicts) console.log(`  · ${item.message ?? JSON.stringify(item)}`);
}

const usage = `SE Diagram Studio CLI

  node ds.mjs kinds
  node ds.mjs syntax <kind>
  node ds.mjs render --kind <kind> --file <dsl> [--out a.svg] [--format svg|png] [--dpi 600]
                     [--theme color] [--orientation landscape] [--margin 15] [--caption "图 1"]
  node ds.mjs check  --kind <kind> --file <dsl>
  node ds.mjs batch  --manifest list.json [--outdir out] [--format png]
  node ds.mjs er     --file schema.sql [--outdir out/er]

  环境变量：DIAGRAM_STUDIO_BASE（默认 ${BASE}）· DIAGRAM_STUDIO_API_KEY`;

try {
  if (cmd === "kinds") await cmdKinds();
  else if (cmd === "syntax") await cmdSyntax();
  else if (cmd === "render") await cmdRender();
  else if (cmd === "check") await cmdCheck();
  else if (cmd === "batch") await cmdBatch();
  else if (cmd === "er") await cmdEr();
  else console.log(usage);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
