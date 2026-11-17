# Diagram Studio Skill

> 让 AI Agent 直接调用 [SE Diagram Studio](https://yougood.ggff.net) 的渲染引擎，把一句自然语言变成符合 GB/T 1526、OMG UML 2.5.1、Chen (1976) 与 Crow's Foot 规范的论文插图。

这是一个 **Agent Skill**（技能包），不是独立软件。装进本地技能目录后，AI 会按包内的 DSL 语法书写伪代码，调用远端 API 出图。

---

## 为什么需要它

大模型能读懂"画一张图书借阅系统的用例图"，但画不出符合答辩要求的图——符号位置、判断框出口、泳道分栏、E-R 基数记法都有各自的规范约束。本技能把这些约束固化成 13 种图型的 DSL 语法与校验规则，模型只需照语法填内容，排版交给渲染引擎。

| 能力 | 说明 |
|---|---|
| 13 种图型 | 流程图 / 用例图 / 功能结构图 / 时序图 / 类图 / 数据流图 / 架构图 / 构件图 / 概念 E-R / 数据库 ERD / 泳道图 / 活动图 / 部署图 |
| 输出格式 | SVG 矢量 + PNG（150 / 300 / 600 DPI） |
| 规范自检 | 响应头 `X-Diagram-Errors` 返回规范问题条数，可先校验后出图 |
| 批量渲染 | 单次请求最多 10 张 |
| **SQL 体检** | 本地分析建表脚本，找出引擎推断不到的业务联系（审核人、发布者、多对多中介表），生成概念 E-R DSL 骨架 |
| **用例图按角色拆图** | 一段用例 DSL → 每个参与者一张独立用例图，另附全角色总览；公共用例自动带出，孤立用例单独提示 |
| 零依赖 CLI | `scripts/ds.mjs` + `scripts/sql-audit.mjs` 只用 Node.js 内置模块，无需 `npm install` |

---

## 安装

### 方式一：下载压缩包（推荐）

从 [Releases](https://github.com/LeastBit/diagram-studio-skill/releases/latest) 下载 `diagram-studio.zip`，解压到本地技能目录：

```bash
# macOS / Linux
unzip diagram-studio.zip -d ~/.workbuddy/skills/

# Windows (PowerShell)
Expand-Archive diagram-studio.zip -DestinationPath "$env:USERPROFILE\.workbuddy\skills\"
```

### 方式二：克隆仓库

```bash
git clone https://github.com/LeastBit/diagram-studio-skill.git \
  ~/.workbuddy/skills/diagram-studio
```

安装后目录形如：

```
~/.workbuddy/skills/diagram-studio/
├── SKILL.md
├── references/
│   ├── dsl-syntax.md        # 13 种图型的 DSL 伪代码语法
│   ├── sql-to-erd.md        # 脏 SQL → 规范 E-R 图：补全引擎看不见的关系
│   └── api-reference.md     # 鉴权 / 计费 / 端点 / 错误码
└── scripts/
    ├── ds.mjs               # 零依赖 CLI（出图）
    └── sql-audit.mjs        # 零依赖 CLI（SQL 体检 / 生成 DSL 骨架）
```

---

## 配置 API Key

技能**不内置任何密钥**，需要你自行提供。前往 [yougood.ggff.net](https://yougood.ggff.net) 注册后在控制台创建 API Key，然后：

```bash
export DIAGRAM_STUDIO_API_KEY="sk-你的密钥"
```

也可以临时通过 `--key` 传入，或直接告诉 AI「用这个 Key：sk-...」。

> 密钥只用于当次请求，不会被写入技能文件、日志或版本库。

---

## 快速开始

```bash
cd ~/.workbuddy/skills/diagram-studio

# 列出 13 种图型
node scripts/ds.mjs kinds

# 查看某种图型的 DSL 语法
node scripts/ds.mjs syntax sequence

# 从 DSL 文本渲染 SVG
node scripts/ds.mjs render --kind flowchart --source "start S: 开始
input I: 输入读者证号
end E: 结束
S -> I -> E" --out fig-3-1.svg

# 出 600 DPI PNG，带图题
node scripts/ds.mjs render --kind usecase --file uc.dsl \
  --format png --dpi 600 --caption "图 3-1 系统用例图" --out fig-3-1.png

# 只做规范校验，不出图（查看错误码）
node scripts/ds.mjs check --kind flowchart --file fc.dsl

# 用例图按角色拆成多张（每个参与者一张 + 全角色总览）
node scripts/ds.mjs ucv --file uc.dsl --outdir figures/usecase --with-overview
```

`check` 走批量接口的 JSON 模式，返回每条违规的 `code`、`message` 与 `rule`，便于模型自行修正后重试。

---

## 从现成 SQL 出 E-R 图

真实毕设库多半是从代码生成器导出的：**没有一条外键、字段名靠拼接**。直接丢给渲染接口，出来的 E-R 图会少一半联系——因为引擎只认两件事：显式 `FOREIGN KEY`，和 `xxx_id` 能对上表名的字段。

先做本地体检（不联网、不消耗积分）：

```bash
# 体检报告：哪些联系能画、哪些画不出来、各自该怎么修
node scripts/sql-audit.mjs --file schema.sql

# 直接生成概念 E-R DSL 骨架（含待确认项注释）
node scripts/sql-audit.mjs --file schema.sql --emit-dsl er/model.dsl --title "XX 系统 E-R 模型"

# 出图：N 张分 E-R 图 + 总 E-R 图
node scripts/ds.mjs er --file er/model.dsl --outdir figures/er
```

报告把问题分成四类：

| 类别 | 含义 | 处理 |
|---|---|---|
| T1 可推断 | 外键规范，引擎自动画 | 不用管 |
| T2 可救 | 字段在，但命名让引擎认不出（`dept_id`、`uid`） | 改名或手写联系 |
| **T3 结构缺失** | 业务上必然有联系，库里连字段都没有（审核人、发布者、回复人） | **只能靠读业务补** |
| T4 不该画 | 字典、config、token、日志表 | 明确排除 |

实测一个真实的宠物领养毕设库（14 张表、0 条外键）：能画出 10 条联系，另找出 5 条高优先级问题——两张审核表都缺审核人字段、认领表里用了领养表的前缀、一个 `yonghu_id` 同时充当申请人和审核人。

方法论、八种典型病症的前后对照、改库还是只画图的决策树见 [`references/sql-to-erd.md`](references/sql-to-erd.md)。

---

## 用例图按角色拆图

一张用例图塞四五个角色，是论文里最常见的「看不清」来源：参与者挤在边界两侧互相压住，
关联线从别的用例椭圆上横穿过去，`«include»` 标签叠成一团。UML 并不要求把系统画在一张图上，
**按角色拆成一组视图反而更规范**。

```bash
# 照常写一张完整的用例 DSL
node scripts/ds.mjs ucv --file uc.dsl --outdir figures/usecase
```

```bash
# 等价 HTTP 调用
curl -X POST https://yougood.ggff.net/api/v1/usecase/views \
  -H "Authorization: Bearer $DIAGRAM_STUDIO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source": "…同一段 usecase DSL…", "format": "svg"}'
```

拆分在服务端按模型完成，DSL 不用改：

| 输出 | 含义 |
|---|---|
| `views[]` | 每个参与者一张图，只含他直接关联的用例 + 沿 include/extend 单向带出的公共用例 |
| `overview` | 全角色画在一张图上的对照图 |
| `shared[]` | 被多个角色共用、会在多张图里重复出现的用例 |
| `orphans[]` | 既无角色使用、也未被 include/extend 引用的用例 —— 通常是漏了关联 |

`usecases[]` 里每条带 `role`：`primary`（直接使用）或 `linked`（由 include/extend 带入）。
`render --kind usecase` 仍输出「一张图」的版本，角色不超过两个时够用。

---

## 13 种图型

| kind | 名称 | 规范依据 |
|---|---|---|
| `flowchart` | 程序流程图 | GB/T 1526-1989 / ISO 5807 |
| `usecase` | 用例图 | UML 2.5.1 |
| `functional` | 功能结构图 | 学位论文制图惯例 |
| `sequence` | 时序图 | UML 2.5.1 |
| `class` | 类图 | UML 2.5.1 |
| `dfd` | 数据流图 | 结构化分析方法 |
| `architecture` | 系统架构图 | 分层视图惯例 |
| `component` | 构件图 | UML 2.5.1 |
| `chen-er` | 概念 E-R 图 | Chen (1976) |
| `erd` | 数据库 ERD | Crow's Foot |
| `swimlane` | 泳道图 | 跨职能流程图惯例 |
| `activity` | 活动图 | UML 2.5.1 |
| `deployment` | 部署图 | UML 2.5.1 |

每种图型的语句表、最小示例、完整示例与易错点见 [`references/dsl-syntax.md`](references/dsl-syntax.md)。

---

## 直接调 API

不使用 CLI 也可以直接 POST：

```bash
curl -X POST https://yougood.ggff.net/api/v1/render/svg \
  -H "Authorization: Bearer $DIAGRAM_STUDIO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "flowchart",
    "dsl": "start S: 开始\ninput I: 输入读者证号\nend E: 结束\nS -> I -> E",
    "page": { "theme": "mono", "caption": "图 3-1 借阅流程" }
  }'
```

端点、参数、计费与错误码见 [`references/api-reference.md`](references/api-reference.md)。

---

## 相关链接

- 在线平台：[yougood.ggff.net](https://yougood.ggff.net)
- API 文档：[yougood.ggff.net/api-docs](https://yougood.ggff.net/api-docs)
- 完整论文示例：[yougood.ggff.net/examples](https://yougood.ggff.net/examples)

---

## License

[MIT](LICENSE)
