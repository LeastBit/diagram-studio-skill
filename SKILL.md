---
name: diagram-studio
description: 调用 SE Diagram Studio 在线渲染 API，把自然语言需求生成符合 GB/T 1526、OMG UML 2.5.1、Chen 1976、Crow's Foot 等规范的论文插图（流程图、用例图、功能结构图、时序图、类图、数据流图、架构图、构件图、概念 E-R 图、数据库 ERD、泳道图、活动图、部署图）。当用户要求“画一张 XX 图”“生成论文/设计文档里的用例图、ER 图、时序图、架构图”“把这段设计说明变成插图”“导出 SVG/PNG 矢量图”时使用。对现成建表脚本（SQL/DDL）会先做本地体检：补全库里没建但业务上存在的联系（审核人、发布者、回复人、多对多中介表），再出规范 E-R 图，避免“少一半联系”。技能内含 13 种图型的 DSL 伪代码语法、API 与鉴权说明、校验与排错流程；API Key 由用户自行填写，技能不内置任何密钥。
agent_created: true
---

# SE Diagram Studio 绘图技能

把「一段中文需求」变成「一张能直接排进论文的规范插图」。渲染在云端完成（`https://yougood.ggff.net`），本技能负责：选对图型 → 写对 DSL 伪代码 → 调用 API → 检查规范错误 → 交付 SVG/PNG。

- 站点：<https://yougood.ggff.net>　在线文档：<https://yougood.ggff.net/api-docs>　能力自述：`GET /api/v1/capabilities`

## 0. 先解决 API Key（不内置、不落盘）

**技能里没有任何密钥，必须由用户提供。** 按以下顺序获取：

1. 环境变量 `DIAGRAM_STUDIO_API_KEY`（推荐，由用户自己 export）
2. 用户直接把 Key 贴在对话里（形如 `sk-` + 64 位十六进制）→ 仅在本次命令中通过 `--key` 传入

```bash
export DIAGRAM_STUDIO_API_KEY='sk-用户自己的key'
```

禁止把 Key 写进 `SKILL.md`、脚本、示例、`.env` 或提交到 git。Key 在网页 `/dashboard/keys` 创建，只显示一次；新账号注册赠 66 积分，1 积分/张。

## 1. 工作流（按顺序，不要跳）

1. **判断图型**：读 `references/dsl-syntax.md` 第 14 节「自然语言 → 图型选择」对照表。拿不准时按用户用词选：说「流程/步骤」→ `flowchart`，说「谁能做什么」→ `usecase`，说「消息先后」→ `sequence`，说「表结构」→ `erd`，说「分几层」→ `architecture`。
2. **输入是现成 SQL？先体检，别直接丢给接口**：
   ```bash
   node scripts/sql-audit.mjs --file schema.sql                              # 报告
   node scripts/sql-audit.mjs --file schema.sql --emit-dsl er/model.dsl      # 概念 DSL 骨架
   ```
   引擎只认两种关系：显式 `FOREIGN KEY`，和 `xxx_id` 能对上表名的字段。**业务上存在但库里没建的关系（审核人、发布者、回复人）它一律看不见**，直接出图会少一半联系。按 `references/sql-to-erd.md` 的三步法补全后再画。
3. **取语法**：`node scripts/ds.mjs syntax <kind>`，或读 `references/dsl-syntax.md` 对应章节。**不要凭记忆写 DSL** —— 13 种图型的声明关键字各不相同，写错一个词就 400。
4. **写 DSL**：先列实体（参与者/类/表/节点），再列关系。别名用英文，中文放显示位置。
5. **出图**：`render`（SVG 默认，论文用）/ `--format png --dpi 600`（投稿要求位图时）。看响应里的 `X-Diagram-Errors`：为 `0` 就直接交付；**大于 0 时**再跑 `check` 看 issues 明细（`check` 走 batch 接口，同样按张计费 1 积分，不要无条件先跑一遍）。
6. **交付**：给图 + `.dsl` 源文件 + 「图型 / 图题 / 生成命令」三行摘要。

```bash
# 出 SVG
node scripts/ds.mjs render --kind flowchart --file login.dsl --out figures/login.svg
# 出 600DPI PNG，黑白（论文）
node scripts/ds.mjs render --kind class --file model.dsl --format png --dpi 600 --theme mono --out figures/model.png
# 只有规范错误数 > 0 时才需要：查具体问题
node scripts/ds.mjs check --kind sequence --file pay.dsl
```

脚本从环境变量读 Key 与站点地址；没有脚本环境时用 `curl`（见第 3 节）。

## 2. 13 种图型速查

| kind | 图型 | 关键声明词 | 典型场景 |
| --- | --- | --- | --- |
| `flowchart` | 程序流程图 | `start/end/input/process/decision` | 算法、业务步骤 |
| `usecase` | UML 用例图 | `actor` / `usecase`（边界自动生成） | 参与者与功能 |
| `functional` | 功能结构图 | 纯缩进（**无 title、无连线**） | 功能模块分解 |
| `sequence` | UML 时序图 | `participant/actor/database` + `->` | 接口调用顺序 |
| `class` | UML 类图 | `class{...}` / `interface{...}` | 领域模型 |
| `dfd` | 数据流图 | `entity` / `process 1.0` / `store D1` | 数据加工与存储 |
| `architecture` | 系统架构图 | `layer` + `service ... in L1` | 分层技术架构 |
| `component` | UML 构件图 | `component` + `provides/requires` | 构件与接口 |
| `chen-er` | 概念 E-R 图 | `entity/relationship/attribute ... of` | 数据库概念设计 |
| `erd` | 数据库 ERD | `table{ 字段 类型 PK }` + `\|\|--o{` | 表结构与主外键 |
| `swimlane` | 泳道图 | `lane` + `action ... in 道` | 跨角色流程 |
| `activity` | UML 活动图 | `initial/action/decision/fork/join/final` | 并行分支 |
| `deployment` | UML 部署图 | `device/node/execution/artifact ... in` | 物理部署 |

详细语法、完整示例、每种图型的专属坑：`references/dsl-syntax.md`。

## 3. 直接调 API（没有脚本时）

```bash
curl -X POST https://yougood.ggff.net/api/v1/render/svg \
  -H "Authorization: Bearer $DIAGRAM_STUDIO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"flowchart","source":"start S: 开始\nprocess P: 处理\nend E: 结束\nS -> P -> E"}' \
  -o out.svg
```

- `.../render/png` 返回二进制 PNG，加 `"dpi":600`
- `.../render/batch` 一次 1–10 张，**只消耗一次网关限流**，多图文档优先用它
- `.../er/views` 传 `CREATE TABLE` 或**概念模型 DSL**（`entity X as Y {` … `}` 那套），一次拿到「每表一张分 E-R 图 + 总 E-R 图」；传 SQL 时基数恒为 `1:n`
- 响应头 `X-Diagram-Errors` 是规范错误数，`0` 才算符合标准画法

请求体、`page` 排版参数、错误码、限流额度：`references/api-reference.md`。

## 4. 六条硬规则（违反必报错或出废图）

1. **先声明后引用**：`A -> B` 之前 A、B 必须已被声明，否则 `400 引用了未声明的标识符`。
2. **标识符只能是英文**：`^[A-Za-z_][\w-]*$`，中文只能出现在 `as` 后的显示名里。
3. **`functional` 图不写 `title:`、不写连线**，第一行就是系统名，缩进固定 2 空格。
4. **标签里不要再出现冒号**，第二个冒号后的内容会被丢弃。
5. **一次 batch 最多 10 张**，超过要拆批；整站 `/api/` 限流 120 次/分钟/IP。
6. **`chen-er` 的 DSL 和 `/er/views` 的概念 DSL 是两套语法**：前者的属性要写成 `attribute 学号 as Sno of Student`（必须带 `of`），后者写成 `entity X as Y { key 学号 }`。`sql-audit.mjs --emit-dsl` 生成的是**后者**，塞给 `render --kind chen-er` 会报「第 3 行：Chen ER 语句格式不正确」。

## 5. 交付规范

- 产物存到用户项目的 `figures/` 或 `docs/figures/`，文件名用 `序号-图型-主题`（如 `03-sequence-borrow.svg`）。
- 论文插图默认 **SVG + 黑白（`theme=mono`）**；期刊要求位图时给 **PNG 600 DPI**。
- 每张图旁边保留同名 `.dsl`，并在回复里给出「图型 + 图题 + 命令」三行摘要，方便复现。
- 服务端只做 2 小时留存（普通账号），**产物必须落到本地**。
- 用户要「一套图」时，先给图清单（图名 + kind），确认后再批量生成，避免一次烧掉几十积分。
- **SVG 可直接导入 Visio / Word / PowerPoint / Illustrator**：文件里每行（竖排时每字）都是独立 `<text>` 且自带 `x`/`y`，不用 `<tspan>` 承担定位，`font-size` 带 `px` 单位，字体族只写两级 `SimSun, serif`。这是为兼容 Office 系解析器专门做的——Visio 会丢弃 `<tspan>` 上的坐标，把多行文字堆到起点（表现为"文字挤成一团"）。若导入后**箭头或基数符号丢失**，则是 Visio 对 `<marker>` 支持不完整，属已知限制：改用 Word/PPT 插入 SVG，或直接交付 PNG 600 DPI。

## 6. 三个落地示例

**需求**：「帮我画一张借阅图书的时序图，读者、借阅页面、借阅服务、数据库四个对象。」

1. 选型：消息先后 → `sequence`
2. 写 DSL（先声明生命线，再按时间顺序写消息，成对用 `activate/deactivate`）：

```
title: 借阅图书时序图
actor 读者 as U
participant 借阅页面 as UI
participant 借阅服务 as S
database 图书数据库 as DB
U -> UI: 提交借阅请求
UI -> S: borrow(bookId)
S -> DB: 查询图书库存
DB --> S: 库存记录
S --> UI: 借阅成功
UI --> U: 显示借阅结果
```

3. `node scripts/ds.mjs check --kind sequence --file borrow.dsl` → 0 error
4. `node scripts/ds.mjs render --kind sequence --file borrow.dsl --out figures/03-borrow.svg`

**需求**：「把这个系统的功能模块整理一张图：用户管理（注册、认证）、馆藏管理（录入、盘点）、借阅管理（借书、还书）。」

1. 选型：功能分解 → `functional`
2. 注意不能写 `title:`，第一行是系统名，两层缩进用 2 空格：

```
在线图书系统
  用户管理
    用户注册
    权限认证
  馆藏管理
    图书录入
    库存盘点
  借阅管理
    借书登记
    还书登记
```

3. 直接出图即可（结构简单，`check` 通常 0 问题）

**需求**：「这是我毕设的建表 SQL，画个 E-R 图。」（`schema.sql`，14 张表、0 条外键）

1. 选型：数据库概念设计 → `chen-er`（概念模型，中文实体名），**不是** `erd`（物理表结构）
2. **先体检**，别直接丢给 `/er/views`：

```bash
node scripts/sql-audit.mjs --file schema.sql --emit-dsl er/model.dsl --title "宠物领养系统 E-R 模型"
```

3. 报告里 `T2/T3` 条目就是引擎看不见的关系。典型几条：审核表只有一个用户外键（缺审核人）、内容表没有发布者、留言表有 `reply_text` 但没有回复人。按 `references/sql-to-erd.md` 第 3 节补进 DSL。
4. `--emit-dsl` 已做好：主键显示为「编号」、外键字段不进属性列表、联系名去角色化（`领养用户` → `领养`）、重名联系自动区分（`领养审核` / `认领审核`）。
5. 出图：`node scripts/ds.mjs er --file er/model.dsl --outdir figures/er`（一次拿到 N 张分 E-R 图 + 总图）
6. 交付时**必须声明**：哪些联系是按 `xxx_id` 推断的、哪些是库里没有但按业务补的。

## 7. 排错顺序

| 症状 | 先查 |
| --- | --- |
| `400` 带行号 | DSL 语法；对照 `references/dsl-syntax.md` 该图型的语句表 |
| `401` | Key 是否过期 / 复制不完整；`Authorization: Bearer sk-...` 的空格 |
| `402` | 账号积分不足（1 积分/张） |
| `429` | 并发 50/500 或网关 120 次/分；退避 5–10 秒，或改 batch |
| 图能出但 `X-Diagram-Errors > 0` | 画法不规范；跑 `check` 拿到代码，再到 `references/dsl-syntax.md` 第 16 节按代码改（如 `DECISION_BRANCHES` 判断框少一条出口、`UNNAMED_DATAFLOW` 数据流没名字、`REALIZATION_TARGET` 实现箭头方向反了） || 图太挤 | 拆图，或 `--orientation landscape` / `--margin 12`；节点 > 34 会自动给 `LARGE_DIAGRAM` 提示 |

## 8. 参考文件

| 文件 | 内容 |
| --- | --- |
| `references/dsl-syntax.md` | 13 种图型逐个的语句表、最小示例、完整示例、专属坑、自然语言→图型对照、报错对照表 |
| `references/sql-to-erd.md` | 脏 SQL → 规范 E-R 图：引擎能/不能推断什么、四类问题、三步法、八种典型病症（含 SQL 前后对照）、改库还是只画图的决策、真实毕设库完整案例、出图前自检清单 |
| `references/api-reference.md` | 端点、请求体、`page` 排版参数、计费与限流、错误码、留存策略 |
| `scripts/ds.mjs` | 零依赖 CLI：`kinds` / `syntax` / `render` / `check` / `batch` / `er` |
| `scripts/sql-audit.mjs` | 本地 SQL 体检（不联网、不扣积分）：找引擎推断不到的关系、生成概念 DSL 骨架 |
