# DSL 伪代码语法手册（13 种图型）

面向「把自然语言需求翻译成 DSL」的场景。每种图型都是**逐行文本**，一行一条语句，顺序无关（连线可以写在声明之前？**不可以** —— 被引用的标识符必须先声明，否则报 `引用了未声明的标识符`）。

---

## 0. 总则（所有图型通用）

| 规则 | 说明 |
| --- | --- |
| 注释 | `#` 开头整行忽略（不支持行尾注释） |
| 空行 | 忽略，可用来分组 |
| 冒号 | 半角 `:` 与全角 `：` 等价 |
| 标题 | `title: 文本`（**`functional` 例外，见该节**）；标题会作为图题渲染在图上 |
| 标识符 | 正则 `^[A-Za-z_][\w-]*$`：字母或下划线开头，可含字母、数字、下划线、短横线；**不能重复**，不能是纯数字，不能用中文 |
| 显示文字 | 中文/空格/标点都直接写，**不要加引号** |
| 大小写 | 关键字不区分大小写（`Process` = `process`），标识符区分大小写 |
| 行号报错 | 语法错误返回 400，`message` 形如 `第 7 行：无法识别…`，按行号改 |
| 长度 | 单次 DSL ≤ 100,000 字符（API 侧请求体上限 2MB） |

三条最容易踩的通用坑：

1. **先声明后引用**。`A -> B` 里的 A、B 必须已在上方用 `start/process/class/table/...` 声明过。
2. **标签里不要再写冒号**。`A -> B: 成功: 200` 只会保留 `成功`（第二个冒号后的内容被丢弃），需要时写成 `成功(200)`。
3. **标识符别用中文**。中文只能出现在 `as` 后面的显示名位置：`process 校验登录信息 as P`。

---

## 1. flowchart · 程序流程图

标准：GB/T 1526-1989 / ISO 5807:1985。用于算法、业务流程、控制流。

```
title: <图题>                                  # 可省
( start | end | input | io | process | decision ) <别名> : <显示文字>
<别名> ( -> <别名> )+ [ : <标签> ]
```

- `input` 与 `io` 都是「输入/输出」平行四边形。
- 支持链式：`S -> I -> P -> D`，一次连多条边。
- **链式末尾的标签只落在最后一条边上**；每条边都要标签就拆成多行。
- 判断节点不会自动出两个分支，`是/否` 靠两个 `->` 行表达。

最小可用：

```
start S: 开始
process P: 处理数据
end E: 结束
S -> P -> E
```

完整示例（判断 + 回流）：

```
title: 用户登录流程
start S: 开始
input I: 输入账号和密码
process P: 校验登录信息
decision D: 认证通过？
process A: 写入登录日志
end E: 结束
S -> I -> P -> D
D -> A: 是
D -> E: 否
A -> E
```

---

## 2. usecase · UML 用例图

标准：OMG UML 2.5.1 §18。系统边界框自动生成，标题即边界名。

```
title: <系统名>                                 # 同时作为系统边界名称
actor <显示名> as <别名>
usecase <显示名> as <别名>
<别名> -> <别名> [ : <关联标签> ]                 # 实线：关联
<别名> ..> <别名> [ : include | extend ]         # 虚线：包含 / 扩展
```

- 参与者必须在系统边界**外**，用例在里面，由渲染器自动摆放。
- `..>` 的标签**只认 `include` 与 `extend`** 两个词；写别的词会被当成 `include` 且不显示标签。

```
title: 在线图书系统
actor 读者 as Reader
actor 图书管理员 as Admin
usecase 检索图书 as Search
usecase 借阅图书 as Borrow
usecase 登录系统 as Login
usecase 续借图书 as Renew
Reader -> Search
Reader -> Borrow
Admin -> Manage
Borrow ..> Login: include
Search ..> Login: include
Renew ..> Borrow: extend
```

`Manage`（维护馆藏）要先声明：`usecase 维护馆藏 as Manage`，否则报未声明。

### 2.1 角色多于两个时：按角色拆图，别塞成一张

一张图放三个以上参与者，参与者会挤在两侧互相压住，关联线从别的用例椭圆上横穿过去，
`«include»` 标签也会叠成一团。**规范做法是每个参与者一张图**，每张图只画他直接关联的用例，
再沿 include/extend 把公共用例带进来（`身份登录` 这类用例在多张图里重复出现是正常的）：

```bash
node scripts/ds.mjs ucv --file system.dsl --outdir figures/usecase   # 每个角色一张
node scripts/ds.mjs ucv --file system.dsl --with-overview            # 额外给一张全角色总览
```

```bash
curl -X POST https://yougood.ggff.net/api/v1/usecase/views \
  -H "Content-Type: application/json" \
  -d '{"source": "…同一段 usecase DSL…", "format": "svg"}'
```

返回 `views[]`（每个角色一条，含 `svg`）、`overview`（全角色总览）、`shared`（被多个角色共用、
会重复出现的用例）、`orphans`（既无角色使用、也未被 include/extend 引用的用例——通常意味着漏了关联）。

拆分是**服务端按模型做的**，DSL 不用改；`render --kind usecase` 仍然画「一张图」的版本，
适合角色不超过两个的场景。

---

## 3. functional · 功能结构图

标准：层次化功能分解。**只有缩进，没有连线关键字。**

```
<系统名>
  <功能模块>
    <功能点>
    <功能点>
  <功能模块>
    <功能点>
```

- 缩进必须是 **2 个空格的整数倍**，奇数个空格直接报错。
- 第 1 层（0 缩进）= 系统，第 2 层 = 模块，第 3 层及更深 = 功能点。
- **不支持 `title:`**：`title: xxx` 会被当成一个节点画出来。系统名直接写第一行。
- 不写任何 `->`，父子关系由缩进自动生成。

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

---

## 4. sequence · UML 时序图

标准：OMG UML 2.5.1 §17。

```
title: <图题>
( participant | actor | database ) <显示名> as <别名>
<别名> ( -> | ->> | --> | ->> ) <别名> : <消息文本>
activate <别名>
deactivate <别名>
( alt | opt | loop | par | critical | ref ) [ <片段标签> ]
  ...
  else [ <分支标签> ]            # 只能出现在 alt 内
end
note ( left | right ) of <别名> : <文本>
```

四种箭头的语义：

| 写法 | 含义 |
| --- | --- |
| `A -> B: msg` | 同步消息（实线实心箭头） |
| `A ->> B: msg` | 异步消息（实线开放箭头） |
| `A --> B: msg` | 返回消息（虚线） |
| `A -->> B: msg` | 异步返回（虚线开放箭头） |

- **消息行必须有 `: 文本`**，不写文本会报「无法识别时序图语句」。
- `alt/opt/loop/par/critical/ref` 必须成对 `end`；`else` 只能出现在 `alt` 内。
- `activate` / `deactivate` 成对出现才画得出激活条；未 `deactivate` 的会在图末尾自动闭合。
- 生命线顺序 = 声明顺序，横向排布。

```
title: 借阅图书时序图
actor 读者 as U
participant 借阅页面 as UI
participant 借阅服务 as S
database 图书数据库 as DB
U -> UI: 提交借阅请求
activate UI
UI -> S: borrow(bookId)
activate S
S -> DB: 查询图书库存
activate DB
DB --> S: 库存记录
deactivate DB
alt 库存充足
  S -> DB: 写入借阅记录
  S --> UI: 借阅成功
else 库存不足
  S --> UI: 返回缺货原因
end
deactivate S
UI --> U: 显示借阅结果
deactivate UI
note right of S: 借阅记录与库存更新应在同一事务中
```

---

## 5. class · UML 类图

标准：OMG UML 2.5.1 §11。

```
( class | interface | abstract class | abstract | enum ) <类名> [ as <别名> ] {
  <成员>
}
<类A> " <源基数> " -- " <目标基数> " <类B> [ : <标签> ]      # 关联（带多重性）
<类A> ( ..> | --|> | <|.. | o-- | *-- | -- ) <类B> [ : <标签> ]
```

成员解析规则（无 `+/-/#` 也能画，它们只是文本前缀）：

| 行内容 | 归类 |
| --- | --- |
| 含 `(` | 操作方法（下半栏） |
| 不含 `(` | 属性（中栏） |
| `enum` 体内的所有行 | 全部进属性栏（枚举值） |

关系运算符：

| 运算符 | 语义 | 方向写法 |
| --- | --- | --- |
| `--` | 关联（无基数） | `A -- B` |
| `..>` | 依赖 | `A ..> B`（A 依赖 B，箭头指向 B） |
| `--\|>` | 泛化/继承 | `子类 --\|> 父类` |
| `<\|..` | 实现 | `接口 <\|.. 实现类`（**左操作数是接口**，空心三角指在接口上） |
| `o--` | 聚合（空心菱形） | `整体 o-- 部分`（菱形在整体侧） |
| `*--` | 组合（实心菱形） | `整体 *-- 部分`（菱形在整体侧） |

> `<|..` 的方向容易记反：它的空心三角落在**右边的操作数**上，所以接口要写在左边 —— `Api <|.. ApiImpl` 渲染成 `ApiImpl ──▷ Api`。

- 类体必须用 `}` 收尾，缺了就报「缺少结束花括号」。
- 一行只写一条关系，基数必须**两侧都写**（`A "1" -- "0..*" B`）。
- **类名同时是标识符，必须是英文**：`class 学生` 会报「标识符 学生 不合法」。中文只能写在类体的成员行里，或改用 `class Student` + 成员 `+ 学号: String`。

```
class User {
  + id: UUID
  + name: String
  + login(): Boolean
}
class Order {
  + id: UUID
  + status: OrderStatus
  + submit(): void
}
interface OrderService {
  + place(order: Order): Receipt
}
User "1" -- "0..*" Order: 拥有
Order ..> OrderService: 使用
```

---

## 6. dfd · 数据流图

标准：Yourdon/DeMarco 与 Gane/Sarson。画数据变换，不画控制流。

```
title: <图题>
level: <层号数字>
entity <外部实体名> as <别名>
process <编号> <加工名> as <别名>
store <编号> <数据存储名> as <别名>
<别名> -> <别名> : <数据流名>
```

- **`process` 与 `store` 必须写编号**：`process 1.0 验证订单 as P1`。少了编号（只写名字）会解析失败。
- 编号习惯：加工 `1.0 / 2.0`，存储 `D1 / D2`。
- 数据流必须有名称，否则报错（DFD 规范要求每条流有名字）。

```
title: 订单处理数据流图
level: 1
entity 客户 as C
process 1.0 验证订单 as P1
process 2.0 生成确认单 as P2
store D1 订单 as D1
entity 支付系统 as Pay
C -> P1: 订单明细
P1 -> D1: 有效订单
P1 -> P2: 有效订单
P2 -> Pay: 支付请求
P2 -> C: 订单确认单
```

---

## 7. architecture · 系统架构图

标准：分层架构 / C4 风格规则包。

```
title: <图题>
layer <层名> as <别名>
( service | database | client | external ) <组件名> as <别名> [ in <层别名> ]
<别名> -> <别名> : <协议或说明>            # 可选，一般不写
```

- **分层图只表达层次**：组件用 `in` 归属到层，渲染结果是「层容器竖向堆叠 + 左侧主干线」，**不要在组件之间画调用线**（画了也不会按架构风格呈现）。
- `in` 必须引用已声明的 `layer`。
- 层的顺序 = 声明顺序（自上而下）。论文习惯：表现层 → 应用服务层 → 数据访问层 → 基础设施层。

```
title: 在线图书系统架构
layer 表现层 as L1
service 借阅页面 as UI in L1
service 管理后台 as Admin in L1
layer 应用服务层 as L2
service 借阅服务 as Borrow in L2
service 用户服务 as User in L2
layer 数据访问层 as L3
database 图书数据库 as DB in L3
```

---

## 8. component · UML 构件图

标准：OMG UML 2.5.1 §12。接口画在构件边界上。

```
title: <图题>
component <构件名> as <别名>
<构件别名> provides <接口名> as <接口别名>      # 提供接口（棒棒糖）
<构件别名> requires <接口名> as <接口别名>      # 需求接口（插座）
( provided | required ) <接口名> as <别名>      # 旧式独立接口，一般不用
<别名> ..> <别名> [ : <标签> ]                  # 依赖
<别名> <|.. <别名> [ : <标签> ]                 # 实现
```

- `provides/requires` 的第一个标识符必须是**已声明的构件**，接口会自动附着在它的边界上。
- 依赖方向：`A ..> B` 表示 A 依赖 B（A 调 B）。
- 实现关系同样把**接口写在左边**：`渲染接口 <|.. 导出服务`。

```
component 图编辑器 as Editor
component 布局引擎 as Layout
component 导出服务 as Export
Editor provides SVG导出接口 as Svg
Editor requires 模型访问接口 as Model
Export provides 渲染接口 as Render
Export requires 模型访问接口 as Store
Editor ..> Layout: 调用
Editor ..> Export: 调用
```

---

## 9. chen-er · 概念 E-R 图（Chen 记法）

标准：Chen (1976) /《数据库系统概论》。**含属性 = 分 E-R 图；不含属性 = 总 E-R 图**（由是否出现属性自动判定）。

```
title: <图题>
( entity | weak | relationship | identifying ) <名称> as <别名>
( attribute | key | derived | multivalued ) <名称> as <别名> of <宿主别名>
<实体>(<基数>) -- <联系> -- (<基数>) <实体>
```

| 关键字 | 图形 |
| --- | --- |
| `entity` | 矩形（实体） |
| `weak` | 双线矩形（弱实体） |
| `relationship` | 菱形（联系） |
| `identifying` | 双线菱形（标识性联系） |
| `attribute` | 椭圆（属性） |
| `key` | 带下划线的椭圆（码属性） |
| `derived` | 虚线椭圆（派生属性） |
| `multivalued` | 双线椭圆（多值属性） |

- 每个 `attribute/key/derived/multivalued` **必须带 `of <宿主>`**，否则属性会成为孤立节点。
- 参与关系一行写两侧基数：`Student(1) -- Enroll -- (n) Course`。
- 联系自身也可以挂属性：`attribute 成绩 as Score of Enroll`。
- 属性多时图会很大；论文里常见的做法是「分 E-R 图带属性 + 总 E-R 图不带属性」。

```
title: 学生选课局部 E-R 图
entity 学生 as Student
entity 课程 as Course
relationship 选修 as Enroll
attribute 学号 as Sno of Student
attribute 姓名 as Sname of Student
attribute 课程号 as Cno of Course
attribute 成绩 as Score of Enroll
Student(1) -- Enroll -- (n) Course
```

---

## 10. erd · 数据库 ERD（Crow's Foot）

标准：Crow's Foot / 关系模式。可直接从建表语句手抄。

```
table <表名> [ as <别名> ] {
  <字段名> <类型> [PK] [FK] [NOT NULL] [UNIQUE]
}
<别名> ||--o{ <别名> [ : <标签> ]     # 一对多
<别名> ||--|| <别名> [ : <标签> ]     # 一对一
<别名> }o--o{ <别名> [ : <标签> ]     # 多对多
```

- 字段三个 token 起：名称、类型、可选约束；类型可带长度 `VARCHAR(80)`。
- `PK` 自动加下划线，`FK` 自动标记；`NOT NULL` 决定可空性。
- 表名与别名都可用于关系行（别名优先）。

```
table users {
  id BIGINT PK
  name VARCHAR(80) NOT NULL
  email VARCHAR(120) UNIQUE
}
table orders {
  id BIGINT PK
  user_id BIGINT FK NOT NULL
  status VARCHAR(20)
}
users ||--o{ orders: 拥有
```

---

## 11. swimlane · 泳道图

标准：UML Activity Partition / BPMN 分区规则。按角色横向分道。

```
lane <泳道名> as <别名>
( start | end | action | decision ) <显示文字> as <别名> in <泳道别名>
<别名> -> <别名> [ : <标签> ]
```

- 每个流程节点**必须 `in` 一条泳道**，否则不会落在任何道里。
- 泳道声明顺序 = 从上到下的顺序。
- 跨道连线自动走折线，表达职责交接。

```
lane 用户 as U
lane 系统 as S
lane 管理员 as A
start 开始 as Start in U
action 提交申请 as Apply in U
action 审核申请 as Review in A
decision 审核通过？ as D in A
action 发送审核结果 as Notify in S
end 结束 as End in U
Start -> Apply
Apply -> Review
Review -> D
D -> Notify: 是
D -> Apply: 否
Notify -> End
```

---

## 12. activity · UML 活动图

标准：OMG UML 2.5.1 §15。

```
title: <图题>
initial <别名>                      # 实心圆起点
final <别名>                        # 同心圆终点
fork <别名>                         # 分叉（粗横线）
join <别名>                         # 汇合（粗横线）
action <显示文字> as <别名>
decision <显示文字> as <别名>
<别名> -> <别名> [ : [<守卫条件>] ]
```

- `initial/final/fork/join` **只写一个别名**，不写显示文字。
- 守卫条件写成方括号：`D -> F: [有库存]`。
- **没有 `merge` 关键字**（面板上有图形，DSL 不支持）：合并直接连回 `decision` 或下一个 `action` 即可。
- `fork` 出去的每条分支都要有对应 `join` 汇入，否则图会显得悬空。

```
initial I
action 接收订单 as Receive
decision 库存充足？ as D
fork F
action 预扣库存 as Reserve
action 请求支付 as Pay
join J
action 标记缺货 as Reject
final End
I -> Receive
Receive -> D
D -> F: [有库存]
D -> Reject: [无库存]
F -> Reserve
F -> Pay
Reserve -> J
Pay -> J
J -> End
Reject -> End
```

---

## 13. deployment · UML 部署图

标准：OMG UML 2.5.1 §19。节点内可嵌套执行环境与制品。

```
title: <图题>
( device | node | execution | artifact | database ) <名称> as <别名> [ in <上层别名> ]
<别名> ( <--> | -- | ..> ) <别名> [ : <标签> ]
```

- `in` 表达「部署在……之内」，可多层嵌套（database in node，artifact in execution）。
- `<-->` 通信路径（带标签写协议，如 `HTTPS`）；`--` 无向连接；`..>` 部署依赖（制品→节点）。

```
device 客户端设备 as Client
node 应用服务器 as Server
execution Node.js运行环境 as Runtime in Server
artifact web-app as App in Server
node 数据库服务器 as DBServer
database PostgreSQL as DB in DBServer
Client <--> Server: HTTPS
Server <--> DBServer: TCP 5432
Runtime ..> App: 部署
```

---

## 14. 自然语言 → 图型选择

| 用户说法 | 选这个 kind |
| --- | --- |
| 「画个流程图 / 业务办理步骤 / 算法流程」 | `flowchart` |
| 「系统有哪些功能 / 功能模块划分 / 功能分解」 | `functional` |
| 「谁能做什么 / 参与者与用例 / 用例规约」 | `usecase` |
| 「接口调用顺序 / 消息交互 / 时序」 | `sequence` |
| 「类有哪些属性方法 / 类之间的关系」 | `class` |
| 「数据怎么流动 / 数据加工过程」 | `dfd` |
| 「系统分几层 / 技术架构 / 部署形态（软件分层）」 | `architecture` |
| 「构件、接口、依赖」 | `component` |
| 「概念模型 / 实体联系 / 分 E-R 图」 | `chen-er` |
| 「数据库表结构 / 主外键 / 建表」 | `erd`（或 `POST /api/v1/er/views` 直接从 SQL 出全套 E-R 图） |
| 「跨部门流程 / 谁在哪个环节做什么」 | `swimlane` |
| 「并行分支 / 活动图 / 状态流转（带分叉汇合）」 | `activity` |
| 「服务器、容器、制品部署在哪台机器」 | `deployment` |

**多图组合**：一篇论文/一份设计文档通常需要 3–6 张图（如 功能结构 + 用例 + 时序 + 类 + E-R + 部署）。批量生成用 `/api/v1/render/batch`（一次 1–10 张），比逐张调用省限流额度。

---

## 15. 常见报错对照

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `标识符 X 不合法` | 用了中文或数字开头 | 换成 `X` 之类的英文别名，中文放显示位置 |
| `标识符 X 重复` | 同一别名声明两次 | 改别名或删重复声明 |
| `引用了未声明的标识符 X` | 连线写在了声明之前 / 漏声明 | 把声明行提前，或补 `actor/process/...` |
| `第 N 行：无法识别…语句` | 该图型不支持这种写法 | 对照本文件对应章节的语句表 |
| `缩进必须使用两个空格` | functional 用了 4 空格或 tab | 统一 2 空格 |
| `类 X 缺少结束花括号` | 类体没写 `}` | 补 `}` |
| `else 必须位于 alt 组合片段内` | `else` 前面没有 `alt` | 加 `alt` 或删 `else` |
| `end 没有对应的组合片段` | `end` 多了 | 删掉或补 `alt/opt/...` |
| `组合片段缺少 end` | 片段没闭合 | 补 `end` |
| `字段格式应为 名称 类型 PK/FK` | erd 字段少写类型 | `id BIGINT PK` |

---

## 16. 校验码速查（`X-Diagram-Errors` 与 `check` 的 `issues`）

图能画出来 ≠ 画法合规。渲染成功但 `X-Diagram-Errors > 0` 时，到这一节对号入座改 DSL。

| 代码 | 级别 | 含义 | 怎么改 |
| --- | --- | --- | --- |
| `DECISION_BRANCHES` | error | 判断节点只有 1 条出口 | 补第二个分支 `D -> X: 否` |
| `DECISION_TWO_EXITS` | warning | 判断框出口不是恰好 2 条 | 合并多余分支或拆图 |
| `DECISION_YES` / `DECISION_NO` | warning | 判断框缺「是/否」标注 | 两条出线分别写 `: 是`、`: 否` |
| `MISSING_GUARD` | warning | 判断出口没有条件文字 | 同上，给出条件 |
| `FLOW_NO_END` | warning | 流程图没有结束框 | 加 `end E: 结束` 并连上 |
| `FORK_BRANCHES` | error | 分叉没有「一个入口多个出口」 | 检查 `fork` 前后连线 |
| `JOIN_INPUTS` | error | 汇合没有多个入口 | 用 `join` 前接多条分支 |
| `UNNAMED_DATAFLOW` | error | DFD 数据流没名字 | `A -> B: 数据名` |
| `DFD_BYPASS` | error | 外部实体与数据存储直连 | 中间加一个 `process` |
| `MESSAGE_LIFELINE` | error | 消息连到了非生命线 | 先 `participant X as X` 再连 |
| `MESSAGE_NAME` | warning | 消息没有名称 | 补 `: 文本` |
| `INVALID_USECASE_RELATION` | error | include/extend 连的不是两个用例 | 改成 `用例 ..> 用例: include` |
| `ACTOR_TO_ACTOR` | error | 参与者之间用了关联线 | 改用泛化或在中间加用例 |
| `REALIZATION_TARGET` | warning | 实现关系箭头没指向接口 | 把接口写到左边：`Api <|.. Impl` |
| `LARGE_DIAGRAM` | warning | 节点 > 34 或连线 > 40 | 拆成多张子图，论文里更好排 |
| `EMPTY_LABEL` | warning | 有节点名称为空 | 补显示文字 |

看明细：

```bash
node scripts/ds.mjs check --kind flowchart --file a.dsl
# 节点 4 · 连线 3 · 错误 1 · 建议 4
#   [error] DECISION_BRANCHES 判断节点应至少有两条出口流。（GB/T 1526 / UML Activity）
```
