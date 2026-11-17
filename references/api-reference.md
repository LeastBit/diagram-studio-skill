# API 参考（SE Diagram Studio v1）

- **Base URL**：`https://yougood.ggff.net`
- **协议**：HTTPS，JSON 请求体
- **在线文档**：<https://yougood.ggff.net/api-docs>
- **能力自述（机器可读）**：`GET /api/v1/capabilities` —— 返回 13 种图型的 `kind`、名称、标准、一句话语法、完整示例。写 DSL 前先取一次，可whereas 保证语法与线上版本一致。

---

## 1. 鉴权

| 项 | 说明 |
| --- | --- |
| 请求头 | `Authorization: Bearer sk-xxxxxxxx` |
| 密钥来源 | 登录网页 → 「API Key」页（`/dashboard/keys`）创建，形如 `sk-` + 64 位十六进制，**只在创建时显示一次** |
| 权限 | 密钥归属某个账号；生成结果会写入该账号的图表库 |
| 未带密钥 | 生产环境返回 `401` |
| 无效密钥 | `401 API Key 无效`；同一 IP 每分钟超过 30 次无效尝试会被 `429` |

密钥只应存在环境变量里（`DIAGRAM_STUDIO_API_KEY`），不要写进代码或提交到仓库。

---

## 2. 计费、并发与限流

| 项 | 数值 | 说明 |
| --- | --- | --- |
| 计费 | **1 积分 / 张** | batch 按张数计（10 张 = 10 积分）；管理员账号调用不扣积分 |
| 余额不足 | `402 积分不足，请充值` | 新注册赠 66 积分 |
| 用户并发 | 普通 **50** / 管理员 **500** | 同一个 Key 同时进行的渲染请求数，超出 `429` |
| 网关限流 | **120 次/分钟/IP**（突发 30） | 由 Nginx 执行，覆盖整个 `/api/`；多张图优先用 batch |
| 请求体上限 | 2 MB | DSL 本身另有 100,000 字符上限 |
| 渲染缓存 | 相同 `kind + source + page + dpi` 10 分钟内直接复用 | 重复调用仍计费，但响应快很多 |

---

## 3. 渲染接口

### POST /api/v1/render/svg

返回 `image/svg+xml` 文本（矢量，可直接嵌论文或再编辑）。

### POST /api/v1/render/png

返回 `image/png` 二进制，`dpi` 取 `300`（默认）或 `600`。

### POST /api/v1/render

与 `/render/svg` 等价，保留兼容；新代码用 `/render/svg`。

**请求体（三者相同）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | string | 是 | 图型标识，见下方「图型清单」 |
| `source` | string | 是 | DSL 伪代码，≤ 100,000 字符 |
| `page` | object | 否 | 页面设置，可只传需要覆盖的字段，见下表 |
| `dpi` | `300` \| `600` | 否 | 仅 PNG 生效，默认 300 |

**page 字段（全部可选，默认 A4 竖版）**

| 字段 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `orientation` | `portrait` \| `landscape` | 自动 | 不传时按图形宽高比自动选（宽 > 高 1.12 倍则横版） |
| `margin` | 0–40 | `20` | 页边距 mm |
| `fontFamily` | string | 宋体栈 | 论文用 `SimSun, 'Songti SC', serif` |
| `fontSize` | 8–36 | `14` | 正文字号 px |
| `fit` | `page` \| `width` \| `content` | `page` | 适配方式 |
| `caption` | string ≤300 | 取 `title` | 图题 |
| `showPage` | boolean | `true` | 是否画 A4 页面边框 |
| `theme` | `mono` \| `color` | `mono` | 黑白（论文）/ 彩色（答辩 PPT） |

> `format` 字段固定为 `A4`，一般不用传；传了必须是 `"A4"`。

**响应头**

| 头 | 说明 |
| --- | --- |
| `Content-Type` | `image/svg+xml; charset=utf-8` 或 `image/png` |
| `X-Diagram-Errors` | 规范校验**错误条数**，`0` 表示完全符合标准画法；>0 说明图能画出来但画法不规范（如用例没有参与者、活动图 fork 没有 join） |
| `Cache-Control` | `no-store` |

```bash
curl -X POST https://yougood.ggff.net/api/v1/render/svg \
  -H "Authorization: Bearer $DIAGRAM_STUDIO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"kind":"flowchart","source":"start S: 开始\nprocess P: 处理\nend E: 结束\nS -> P -> E"}' \
  -o flowchart.svg
```

---

## 4. 批量接口

### POST /api/v1/render/batch

一次 1–10 张，**只算一次网关限流**，最适合「一份文档配多张图」。

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `format` | `svg` \| `png` \| `json` | `svg`/`png` 返回成品；`json` 只返回模型与校验结果（用于检查，不返回图形） |
| `dpi` | `300` \| `600` | PNG 生效 |
| `items` | `RenderRequest[]` | 1–10 个，字段同渲染接口（`kind` + `source` + 可选 `page`） |

**响应**

```json
{
  "format": "svg",
  "count": 2,
  "succeeded": 2,
  "results": [
    { "index": 0, "ok": true, "kind": "flowchart", "svg": "<svg …>", "issues": [], "model": {…}, "page": {…} },
    { "index": 1, "ok": false, "kind": "dfd", "message": "第 3 行：DFD 语句格式不正确。" }
  ]
}
```

单张失败不影响其它张（`ok: false` + `message`）。`format: "json"` 时结果里没有 `svg`/`base64`，但有完整 `issues` 数组 —— 这是**查规范问题最省额度**的方式（仍然按张计费 1 积分，但不出图）。

---

## 5. E-R 视图接口（分图 + 总图）

### POST /api/v1/er/views

一次生成「每张表一张分 E-R 图 + 总 E-R 图（不含属性 / 含属性，多表自动分页）」，输入可以是概念 E-R DSL，也可以直接粘 `CREATE TABLE` 语句。

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `source` | string | 概念 E-R DSL 或 SQL DDL |
| `format` | `json` \| `svg` \| `png` | 默认 `json` |
| `dpi` | `300` \| `600` | PNG 生效 |

**响应（json）**：`title`、`conflicts`（视图集成冲突）、`entities`、`relationships`、`partials[]`（分 E-R 图）、`global`（总图·不含属性）、`globalPages[]`、`globalFullPages[]`（总图·含属性，每页最多 6 实体）、`layoutHint`、`rules`。

每个视图对象含 `id / title / mode / page / issues / model / svg`，`format=png` 时另带 `pngBase64`。

> 该接口当前不走 API Key 计费（网页 ER Studio 也用它），仍受网关 120 次/分钟限流。批量做 E-R 图时优先用它，比手写 `chen-er` DSL 更规范。

---

## 5.1 用例视图接口（按角色拆图）

### POST /api/v1/usecase/views

输入一段用例图 DSL，**按参与者拆成多张独立用例图**：一张图只画一个角色、他直接关联的用例，
以及沿 include/extend 单向带出的公共用例。这是用例图的默认出图方式（`render --kind usecase` 的合并图只适合角色 ≤ 2）。

**返回张数**：`views.length` = 有「角色 → 用例」关联的参与者数（每个参与者 1 张）；`overview` 另计 1 张。
即 `3 个角色` → 3 张；`3 个角色 + 总览` → 4 张。只声明 `actor`、没有任何关联用例的角色不出图，只在 `layoutHint` 里提示。

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `source` | string | 用例图 DSL（`actor` / `usecase` / `->` / `..>`），≤ 20,000 字符 |
| `format` | `json` \| `svg` \| `png` | 默认 `json`（每张图都带 `svg`） |
| `dpi` | `300` \| `600` | PNG 生效 |

**响应（json）**：

| 字段 | 含义 |
| --- | --- |
| `actorCount` | 参与者总数 |
| `viewCount` | 角色图张数（= `views.length`，每个参与者 1 张） |
| `views[]` | 每个参与者一条：`id / actorId / actorLabel / title / usecases[] / page / issues / model / svg` |
| `overview` | 全部角色画在一张图上的对照图（另计 1 张） |
| `shared[]` | 被多个角色共用、会在多张图里重复出现的用例（`{ id, label, actors[] }`） |
| `orphans[]` | 既无角色使用、也未被 include/extend 引用的用例 —— 通常意味着模型漏了关联 |
| `layoutHint` | 拆图说明、未出图角色与待核实项 |
| `rules` | 拆图原则与记法规范 |

`usecases[]` 里每条带 `role`：`primary`（该角色直接使用）或 `linked`（由 include/extend 带入）。

> 与 `/er/views` 一样，该接口不走 API Key 计费（网页端也用），仍受网关限流。
> 拆分在服务端完成，DSL 不需要改。

---

## 6. 图型清单

| kind | 名称 | 标准 |
| --- | --- | --- |
| `flowchart` | 程序流程图 | GB/T 1526-1989 / ISO 5807:1985 |
| `usecase` | UML 用例图 | OMG UML 2.5.1 §18 |
| `functional` | 功能结构图 | 层次化功能分解 |
| `sequence` | UML 时序图 | OMG UML 2.5.1 §17 |
| `class` | UML 类图 | OMG UML 2.5.1 §11 |
| `dfd` | 数据流图 | Yourdon/DeMarco、Gane/Sarson |
| `architecture` | 系统架构图 | 分层架构 / C4 风格 |
| `component` | UML 构件图 | OMG UML 2.5.1 §12 |
| `chen-er` | 概念 E-R 图（Chen） | Chen 1976 /《数据库系统概论》 |
| `erd` | 数据库 ERD | Crow's Foot |
| `swimlane` | 泳道图 | UML Activity Partition / BPMN |
| `activity` | UML 活动图 | OMG UML 2.5.1 §15 |
| `deployment` | UML 部署图 | OMG UML 2.5.1 §19 |

---

## 7. 错误码

| 状态码 | 含义 | 处理 |
| --- | --- | --- |
| `400` | DSL 语法错误 / 字段校验失败 | 读 `message` 里的行号，改 DSL 重试（**不重试同样的请求**） |
| `401` | 缺少或无效 API Key | 检查 `Authorization` 头与环境变量 |
| `402` | 积分不足 | 让账号管理员充值 |
| `403` | 无权限 | 密钥所属账号不是管理员，却调用了管理接口 |
| `404` | 资源不存在 | 图表/项目 ID 错误 |
| `429` | 并发超限或网关限流 | 退避 5–10 秒重试；批量改用 batch |
| `500` | 渲染引擎异常 | 记录请求体，稍后重试一次；持续失败则反馈 |

错误响应统一为 JSON：`{"message": "…"}`。

---

## 8. 结果留存

通过渲染接口生成的图会同步写入密钥所属账号的图表库（网页「我的图表」可见，可继续编辑）：

| 账号类型 | 保留期 |
| --- | --- |
| 普通用户 | 最后一次保存后 **2 小时**自动删除（`expiresAt` 字段给出具体时间） |
| 管理员 | 永久 |

同一 DSL 在 30 分钟内只保留一条记录，不会无限堆积。**本地一定要自己存一份产物**，不要指望服务端当图床。
