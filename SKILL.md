---
name: diagram-studio
description: 使用 SE Diagram Studio 生成论文流程图、用例图、时序图、模块图、架构图、概念E-R图及数据库ERD等13类技术插图。适用于自然语言设计说明或真实SQL，先核实实体、属性和关系，再渲染SVG/PNG并检查可读性；复杂业务拆分小图，用例图默认按角色拆成多张（张数=角色数+可选总览1张），属性须连接所属实体。含DSL、API及排错指导，不内置密钥。
metadata:
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

1. **判断图型**：读 `references/dsl-syntax.md` 第 14 节「自然语言 → 图型选择」对照表。拿不准时按用户用词选：说「流程/步骤」→ `flowchart`，说「谁能做什么」→ `usecase`，说「消息先后」→ `sequence`，说「表结构」→ `erd`，说「分几层」→ `architecture`。**`usecase` 一律优先走按角色拆图（`ucv`）**，见第 5 步。
2. **输入是现成 SQL？先体检，别直接丢给接口**：
   ```bash
   node scripts/sql-audit.mjs --file schema.sql                              # 报告
   node scripts/sql-audit.mjs --file schema.sql --emit-dsl er/model.dsl      # 概念 DSL 骨架
   ```
   审核人、发布者、回复人等字段可能需要进一步核实。审计报告只用于定位疑点；逐项查明实际SQL约束及源码中的业务归属，保留能追溯的证据。不得仅凭`xxx_id`名称自动补出关系或猜测基数；未核实的项记为待核实。物理E-R图中的外键和基数以真实SQL为准，概念关系也须有实际业务依据，不能为了图看起来完整而编造连接。
3. **取语法**：`node scripts/ds.mjs syntax <kind>`，或读 `references/dsl-syntax.md` 对应章节。**不要凭记忆写 DSL** —— 13 种图型的声明关键字各不相同，写错一个词就 400。
4. **写 DSL**：先列实体（参与者/类/表/节点），再列关系。别名用英文，中文放显示位置。
5. **出图**：`render`（SVG 默认，论文用）/ `--format png --dpi 600`（投稿要求位图时）。`X-Diagram-Errors=0` 只说明语法和规范检查通过，仍须检查实际图片的连线、文字、重叠和论文尺寸下的可读性；**大于 0 时**再跑 `check` 看 issues 明细（`check` 走 batch 接口，同样按张计费 1 积分，不要无条件先跑一遍）。
   **`usecase` 默认用 `ucv` 按角色拆图，不要用 `render --kind usecase` 画合并图**：
   ```bash
   node scripts/ds.mjs ucv --file system.dsl --outdir figures/usecase              # 只出角色图
   node scripts/ds.mjs ucv --file system.dsl --outdir figures/usecase --with-overview  # 另加一张全角色总览
   ```
   **张数规则（先算好再交付，别少给也别多给）**：角色图 = `actorCount` 张（每个声明了关联用例的参与者各 1 张）；加 `--with-overview` 再多 1 张总览。所以 `3 个角色 + --with-overview` = **4 张**，`5 个角色` 不加总览 = **5 张**。命令行第一行会打印 `参与者 3 · 角色图 3 张 + 总览 1 张 = 共 4 张`，与落盘文件数一一对应。详见第 2 节「用例图默认按角色拆」。
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

### ZhiRen 论文制图补充

- 已授权的一键生成任务直接规划并执行，不逐图要求用户确认。技术图全部使用本技能；业务照片另由图像生成流程提供。
- 按真实功能拆成多张小图。复杂业务流程通常拆为2–3幅，每幅围绕一个办理阶段、约6–10个节点；开始和结束各表达一次，普通顺序边不重复写节点动作，判断边标短条件。模块、用例、时序图也按职责分图，不靠缩小字号压进一页。
- 以实际SQL及源码核实实体、属性、外键和基数；推测出的联系只能记为待核实，不能直接补成已存在的数据库关系。论文先展示主要实体的无属性总E-R图，再展示主要实体分E-R图，辅助关联表留在SQL。当前项目要求12–15张真实表、每表最多8字段；不得在图中隐藏超额字段来绕过限制。
- 分E-R图每个属性必须且仅连接所属实体；Chen DSL属性显式带`of`，`/er/views`使用其独立的块语法。核对响应模型的实体和属性标识及连线，随后看实际图，不能只比较属性数量。显示名用简短数据含义，状态枚举、字段类型及详细解释放字段字典。
- `/er/views`的`global`可能只是分页的第一页。检查所有分页实体和跨页关系，不将若干无连线的孤立方框称为完整总E-R图。必要时按真实业务关系重排或拆成有明确范围的关系图，保留真实关系和对应说明。
- 图内不嵌图号和长标题；正文分别说明每幅小图的业务范围、关键分支及关系。输出文件、图题、正文引用必须一致；最终在论文实际尺寸下核对文字、箭头、属性归属及重叠情况。

| kind | 图型 | 关键声明词 | 典型场景 |
| --- | --- | --- | --- |
| `flowchart` | 程序流程图 | `start/end/input/process/decision` | 算法、业务步骤 |
| `usecase` | UML 用例图 | `actor` / `usecase`（边界自动生成） | 参与者与功能；**默认用 `ucv` 按角色拆图**（张数 = 角色数，+1 张总览） |
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

### 用例图默认按角色拆（推荐，替代单张合并图）

**只要图型是 `usecase`，默认就按参与者拆成多张**，不写「一张图放所有角色」。理由不是审美：`layoutUseCase` 把参与者摆在系统边界两侧，角色一多就互相压住，关联线横穿整张图，`«include»` 标签叠成一团。

```bash
# 默认：每个角色一张
node scripts/ds.mjs ucv --file uc.dsl --outdir figures/usecase
# 需要一张全角色对照图时再加
node scripts/ds.mjs ucv --file uc.dsl --outdir figures/usecase --with-overview
```

**会返回多少张？** 先按 DSL 数一遍再动手，交付时也要说清楚：

| 项 | 张数 | 说明 |
| --- | --- | --- |
| 角色图 `views[]` | **= 有「角色 → 用例」关联的参与者数** | 每个参与者 1 张，文件名 `01-角色名用例视图.svg` |
| 总览 `overview` | 0 或 **1** | 加 `--with-overview` 才落盘；接口的 json 响应里**始终**带 `overview`（不想用它忽略即可） |
| 合计 | **角色数（+1）** | 例：老人/家属、配送员、管理员 = 3 张；加总览 = 4 张 |

- 声明了 `actor` 但没写任何 `角色 -> 用例` 的角色**不出图**，只在 `layoutHint` 里提示，别把它算进张数。
- 每张角色图里的用例 = 该角色**直接关联**的（`role: "primary"`）+ 被 include/extend **单向带出**的公共用例（`role: "linked"`）。所以一张图里的用例数通常多于该角色自己声明的条数，这是对的。
- 拆分完全在服务端按模型做，**DSL 不用改**；同一个 `.dsl` 既能出拆图，也能被 `render --kind usecase` 出合并图（角色 ≤ 2 时合并图也够用）。
- 接口字段对应关系：`actorCount`（参与者总数）、`viewCount`（角色图张数）、`views[]`（每张含 `svg`，`format=png` 时含 `pngBase64`）、`shared[]`（多角色共用、会在多张图里重复出现的用例）、`orphans[]`（既无角色使用、也未被 include/extend 引用的用例 —— 通常意味着漏了关联，先补模型再出图）。

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
- `.../usecase/views` 传用例图 DSL，一次拿到「每个角色一张用例图 + 全角色总览」，附 `shared`（公共用例）与 `orphans`（未关联用例）
- 响应头 `X-Diagram-Errors` 是规范错误数，`0` 才算符合标准画法

请求体、`page` 排版参数、错误码、限流额度：`references/api-reference.md`。

## 4. 七条硬规则（违反必报错或出废图）

1. **先声明后引用**：`A -> B` 之前 A、B 必须已被声明，否则 `400 引用了未声明的标识符`。
2. **标识符只能是英文**：`^[A-Za-z_][\w-]*$`，中文只能出现在 `as` 后的显示名里。
3. **`functional` 图不写 `title:`、不写连线**，第一行就是系统名，缩进固定 2 空格。
4. **标签里不要再出现冒号**，第二个冒号后的内容会被丢弃。
5. **一次 batch 最多 10 张**，超过要拆批；整站 `/api/` 限流 120 次/分钟/IP。
6. **`usecase` 默认按角色拆图，不要默认画合并图**：`layoutUseCase` 会把参与者排在边界两侧，角色一多就互相压住、关联线横穿别的用例椭圆。用 `ucv`（`POST /api/v1/usecase/views`）按参与者拆图，每张图只留一个角色；拆图是服务端按模型做的，DSL 不用改。**张数 = 有用例关联的参与者数（+1 张总览，若加 `--with-overview`）**，交付前先数清楚，回复里写明「共 N 张：M 个角色各 1 张 + 总览 1 张」。
7. **`chen-er` 的 DSL 和 `/er/views` 的概念 DSL 是两套语法**：前者的属性要写成 `attribute 学号 as Sno of Student`（必须带 `of`），后者写成 `entity X as Y { key 学号 }`。`sql-audit.mjs --emit-dsl` 生成的是**后者**，塞给 `render --kind chen-er` 会报「第 3 行：Chen ER 语句格式不正确」。

## 5. 交付规范

- 产物存到用户项目的 `figures/` 或 `docs/figures/`，文件名用 `序号-图型-主题`（如 `03-sequence-borrow.svg`）。
- 论文插图默认 **SVG + 黑白（`theme=mono`）**；期刊要求位图时给 **PNG 600 DPI**。
- 每张图旁边保留同名 `.dsl`，并在回复里给出「图型 + 图题 + 命令」三行摘要，方便复现。
- 服务端只做 2 小时留存（普通账号），**产物必须落到本地**。
- 用户要「一套图」时，先给图清单（图名 + kind），确认后再批量生成，避免一次烧掉几十积分。
- **用例图按角色分文件交付**：`figures/usecase/01-老人-家属用例视图.svg`、`02-…`，回复里写明确切张数「共 4 张：3 个角色各 1 张 + 全角色总览 1 张」，不要用「几张」糊过去。拆图后同一用例（如「身份登录」）在多个文件里重复出现是正常的。
- **SVG 结构对第三方工具友好，不依赖任何特定软件**：每行（竖排时每字）都是独立 `<text>` 且自带 `x`/`y`，不用 `<tspan>` 承担多行定位，`font-size` 带 `px` 单位，字体族只写两级 `SimSun, serif`。部分解析器会丢弃 `<tspan>` 上的坐标，把多行文字堆到起点（表现为「文字挤成一团」）；**箭头与基数符号也不用 `<marker>`**，改按末端线段方向逐条画成真实 `<path>`（实心三角 / 开放箭头 / 空心三角 / 乌鸦脚 / 单竖杠），换任何工具打开都不会丢方向。技能本身只依赖 Node.js 与 HTTP，不调用任何桌面软件的接口。

## 6. 四个落地示例

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

**需求**：「这个系统有老人/家属、配送员、管理员三种角色，画用例图。」

1. 选型：参与者与功能 → `usecase`；**角色超过两个，按角色拆图**（一张图塞三个角色，人物符号会叠在一起，关联线横穿整张图）
2. 照常写一张完整的用例 DSL：

```
title: 社区助老送餐系统
actor 老人/家属 as U
actor 配送员 as C
actor 管理员 as A
usecase 预约订餐 as UC1
usecase 任务接单 as UC4
usecase 排班派单 as UC7
usecase 身份登录 as UC9
U -> UC1
C -> UC4
A -> UC7
UC1 ..> UC9 : include
UC4 ..> UC9 : include
UC7 ..> UC9 : include
```

3. 用 `ucv` 拆分（服务端按模型拆，DSL 不用改）：

```bash
node scripts/ds.mjs ucv --file usecase.dsl --outdir figures/usecase --with-overview
```

4. 产出 **4 张**：`01-老人-家属用例视图.svg`、`02-配送员用例视图.svg`、`03-管理员用例视图.svg`（3 个角色各 1 张），外加 `总览-全角色用例图.svg`。每张角色图只有一个角色，`身份登录` 这类公共用例会在多张图里各出现一次——这是对的，每张图都要能独立读懂。
5. 命令输出会列出 `shared`（公共用例）与 `orphans`（没有任何角色使用、也没被 include/extend 引用的用例）；`orphans` 非空时要回去核对需求，通常是漏了关联。交付话术示例：「共 4 张：老人/家属、配送员、管理员各 1 张，另附 1 张全角色总览；其中「身份登录」为三个角色共用，故在 3 张图里重复出现。」

## 7. 排错顺序

| 症状 | 先查 |
| --- | --- |
| `400` 带行号 | DSL 语法；对照 `references/dsl-syntax.md` 该图型的语句表 |
| `401` | Key 是否过期 / 复制不完整；`Authorization: Bearer sk-...` 的空格 |
| `402` | 账号积分不足（1 积分/张） |
| `429` | 并发 50/500 或网关 120 次/分；退避 5–10 秒，或改 batch |
| 图能出但 `X-Diagram-Errors > 0` | 画法不规范；跑 `check` 拿到代码，再到 `references/dsl-syntax.md` 第 16 节按代码改（如 `DECISION_BRANCHES` 判断框少一条出口、`UNNAMED_DATAFLOW` 数据流没名字、`REALIZATION_TARGET` 实现箭头方向反了） |
| 图太挤 | 拆图，或 `--orientation landscape` / `--margin 12`；节点 > 34 会自动给 `LARGE_DIAGRAM` 提示 |

## 8. 参考文件

| 文件 | 内容 |
| --- | --- |
| `references/dsl-syntax.md` | 13 种图型逐个的语句表、最小示例、完整示例、专属坑、自然语言→图型对照、报错对照表 |
| `references/sql-to-erd.md` | 脏 SQL → 规范 E-R 图：引擎能/不能推断什么、四类问题、三步法、八种典型病症（含 SQL 前后对照）、改库还是只画图的决策、真实毕设库完整案例、出图前自检清单 |
| `references/api-reference.md` | 端点、请求体、`page` 排版参数、计费与限流、错误码、留存策略 |
| `scripts/ds.mjs` | 零依赖 CLI：`kinds` / `syntax` / `render` / `check` / `batch` / `er` / `ucv` |
| `scripts/sql-audit.mjs` | 本地 SQL 体检（不联网、不扣积分）：找引擎推断不到的关系、生成概念 DSL 骨架 |


## ZhiRen 当前用例图规则

默认只保存各角色图，不保存全角色合并总览；3个真实角色生成3张，4个角色生成4张。每张图只包含一个参与者及该角色实际使用的用例，共享用例可在相关角色图中分别出现。角色名与需求及源码一致，保留真实职责和include/extend联系，不用删角色、删功能凑数量，也不因同一角色出现在不同业务小图而重复出图。角色图数量必须等于实际角色数。只有用户明确另要总览时才选择with-overview。


### 本轮论文交付规则

- 总E-R图严格限制为一至两张，只表达经过SQL及源码核对的主要业务关系；不把次要关系逐条拆成补充关系图。完整SQL与关系核对记录另行保存，不混入论文主体。随后展示主要业务实体分E-R图，属性全部连接其所属实体。
- 每个真实角色单独一张用例图，默认不提供角色总览；每角色最多十个主要用例，功能名用二至八字，按真实权限关联。
- 系统使用受控API适配器调用本技能相同的绘图接口，保留技能版本、技能内容摘要、脚本与接口文档摘要、DSL与供应商绘图记录，最终核对论文下载包。
