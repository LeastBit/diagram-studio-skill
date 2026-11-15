# 脏 SQL → 规范 E-R 图

真实毕设库大多是从代码生成器导出的：**没有一条外键、字段名靠拼接、状态用魔法数字**。
直接丢给引擎，出来的 E-R 图会「少一半联系」。这份文档讲怎么在出图前把关系补全。

配套工具：`scripts/sql-audit.mjs`（本地规则，不联网、不消耗积分）。

---

## 1. 先认清引擎的硬边界

引擎从 SQL 反推概念模型时，只认两件事：

| 输入 | 引擎行为 |
| --- | --- |
| `FOREIGN KEY ... REFERENCES` / 字段级 `REFERENCES` | 画成联系 |
| 字段名 `xxx_id`，且 `xxx` / `xxxs` / `xxx` 去掉尾部 s 能对上某张表 | 画成联系（推断） |
| `xxx_id` 但表名对不上（`dept_id` → 表叫 `department`） | **不画** |
| `*_types` / `*_status` / `*_flag` 整型字段 | **不画**，作为普通属性（这是对的，字典不该进概念图） |
| 表名是 `config` / `dictionary` / `token` | 整表排除（框架表） |
| 多态外键（`token.userid` + `tablename` 两列联合定位） | 只按 `userid` 画一条，`tablename` 的语义丢失 |
| **业务上有关联，但字段根本没建** | **永远画不出来** |

还有一条容易踩的：**SQL 反推的模型基数恒为 `1:n`**。需要 `1:1` 或 `m:n` 时，只能在概念 DSL 里手写。

> 所以真正的瓶颈不是渲染，是「库里没写出来的关系」。这类关系只能靠读业务补。

---

## 2. 四类问题，四种处理

| 类别 | 典型症状 | 处理 | 要不要动 SQL |
| --- | --- | --- | --- |
| **T1 可推断** | 外键规范、`xxx_id` 对得上 | 什么都不用做，直接出图 | 否 |
| **T2 可救** | 字段在，但命名让引擎认不出（`dept_id`、`uid`、`type_id`） | 改名，或在概念 DSL 里手写这条联系 | 视交付物而定 |
| **T3 结构缺失** | 业务上必然有联系，库里连字段都没有（审核人、发布者、回复人） | **只能靠业务理解补**，出图时补进 DSL 并声明 | 否（画图）/ 是（交付库） |
| **T4 不该画** | 字典、配置、token、日志表 | 明确排除，别为了「表多」硬塞进概念图 | 否 |

先把 `sql-audit.mjs` 跑一遍，它会把每条问题归到上面四类：

```bash
node scripts/sql-audit.mjs --file schema.sql
```

---

## 3. 三步法

### 第一步：体检（0 成本，不扣积分）

```bash
# 看报告
node scripts/sql-audit.mjs --file schema.sql

# 直接产出概念 E-R DSL 骨架（含待确认项注释）
node scripts/sql-audit.mjs --file schema.sql --emit-dsl er/model.dsl --title "XX 系统 E-R 模型"
```

报告里的 `关系清单` 是引擎**能**画出来的部分；`T2 / T3` 条目是引擎**画不出来**的部分。
后者才是你要动手的地方。

### 第二步：补关系（T3 是重点）

按业务角色逐个查，五处最常见：

| 检查点 | 判断信号 | 缺什么 |
| --- | --- | --- |
| 审核 / 审批表 | 表名含 `shenhe`/`audit`/`approve`，但只有一个用户外键 | 缺**审核人**，一个 `yonghu_id` 同时被当成申请人和审核人 |
| 内容表 | 有正文、有创建时间，但 0 个用户外键 | 缺**发布者**（管理员发的也要画，「管理员 1:n 内容」） |
| 留言 / 评论表 | 有 `reply_text`，但只有一个用户外键 | 缺**回复人**，应是「留言」「回复」两条联系 |
| 操作日志表 | 有 `operator`/`create_by` 但没有外键 | 补联系或整表排除（日志一般不进概念图） |
| 多套用户表 | `users`（管理员）+ `yonghu`（前台）并存 | 先判断**谁是业务主体**，别把两套都画成实体 |

补的时候不要凭空造字段，先在 `备注` 里写清楚判断依据：

```sql
-- 原表：chongwulingyangshenhe（宠物领养审核）
--   yonghu_id  COMMENT '领养用户'   ← 语义含糊：申请人还是审核人？
-- 业务上「申请」和「审核」是两个动作、两个主体，应拆：
ALTER TABLE chongwulingyangshenhe
  ADD COLUMN shenhe_user_id INT DEFAULT NULL COMMENT '审核人（管理员）';
```

概念图里对应两条联系（`between` 后面必须写**英文别名**，不能写中文实体名）：

```
relationship 领养申请 as Apply  between T_yonghu, T_shenhe cardinality 1:n
relationship 领养审核 as Review between T_users,  T_shenhe cardinality 1:n
```

### 第三步：定名与基数

**联系名必须是动作，不能是角色名或实体名。**

| 外键 COMMENT | 直接照搬（错） | 正确 |
| --- | --- | --- |
| `领养用户` | 领养用户 | 领养 |
| `宠物领养` | 宠物领养（= 实体名，重名） | 申请 / 审核 |
| `视频` | 视频 | 收藏 / 留言 |

**基数按结构判定，别凭感觉：**

| 结构特征 | 基数 |
| --- | --- |
| 子表外键普通索引 | `1:n` |
| 子表外键带 `UNIQUE` | `1:1` |
| 子表外键是联合主键的一部分（标识性联系） | `1:1` / 弱实体 |
| 中介表（两个外键 + 状态/时间） | `m:n`，状态挂在菱形上 |
| 外键允许 `NULL` | `0..n`（可选参与），论文里通常仍写 `1:n` |

**命名冲突要处理**：两张审核表都去前缀后都叫「审核」，总图里就是两个同名菱形。
不能靠加长限定词解决——**chen-er 的菱形是定宽的**，超过 4 个字会撑出图形。
用「区分性前缀」：`宠物领养` / `宠物认领` 的公共前缀是「宠物」，剩 2 个字，得到
`领养审核` / `认领审核`，长度刚好。

---

## 4. 八种典型病症

### 4.1 一条外键都没有

```sql
-- 现状：全靠约定
CREATE TABLE `order` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL COMMENT '下单用户',
  PRIMARY KEY (`id`)
);
```

引擎能按 `user_id` 推断出 `用户 1:n 订单`，**不用改**。
真正的问题是推断不出来的那些字段 —— 看下一条。

### 4.2 外键命名不可推断（T2，最常被忽略）

```sql
-- 引擎认不出：dept_id 找不到叫 dept 的表（表名是 department）
`dept_id` int(11) DEFAULT NULL COMMENT '所属部门',
-- 引擎认不出：uid 的 base 是 u
`uid` int(11) DEFAULT NULL COMMENT '创建人',
-- 引擎认不出：type_id 没有叫 type 的表
`type_id` int(11) DEFAULT NULL COMMENT '分类',
```

三种修法，按侵入性排序：

```sql
-- ① 改名（最干净，但要动库）
`department_id` int(11) DEFAULT NULL COMMENT '所属部门',

-- ② 补外键约束，引擎优先认约束
ALTER TABLE t ADD CONSTRAINT fk_t_dept FOREIGN KEY (`dept_id`) REFERENCES `department`(`id`);

-- ③ 不动库，直接在概念 DSL 里手写（只要图时推荐）
```

### 4.3 字典枚举被误当实体

```sql
`sex_types` int(11) DEFAULT NULL COMMENT '性别',
`news_types` int(11) DEFAULT NULL COMMENT '公告类型',
```

**不要**给它们建「用户 —属于→ 字典」的联系。字典/枚举在概念层是**属性值域**，不是实体。
正确做法：概念图里当普通属性，并确保 COMMENT 写的是中文含义（`性别`），而不是 `sex_types`。

> 例外：如果确实是业务实体（如「商品分类」有层级、有独立维护页面），
> 那它就该有自己的表名 `category`，而不是塞进通用 `dictionary`。

### 4.4 多对多被拆成实体

```sql
CREATE TABLE `course_selection` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `student_id` int(11) DEFAULT NULL,
  `course_id` int(11) DEFAULT NULL,
  `score` decimal(5,2) DEFAULT NULL COMMENT '成绩',
  PRIMARY KEY (`id`)
);
```

引擎会把它画成**独立实体**，但概念模型里它是 `学生 m:n 课程` 的联系，「成绩」是**联系属性**：

```
relationship 选修 as Enroll between T_student, T_course cardinality m:n {
  attribute 成绩
}
```

判断标准：两个外键 + 只剩状态/时间/一个说明性字段 → 中介表。
如果这张表有独立生命周期（可多次申请、可撤销、有审批流），才保留为实体。

### 4.5 一个外键担两个角色

```sql
-- 审核表只有一个 yonghu_id，COMMENT 写「领养用户」
-- 但「谁申请的」和「谁审的」是两件事
`yonghu_id` int(11) DEFAULT NULL COMMENT '领养用户',
```

这是**语义缺失**，不是命名问题。SQL 里改不出来，只能在概念图里补第二条联系（见 3.2）。

### 4.6 复制粘贴导致前缀错位

```sql
CREATE TABLE `chongwurenling` (       -- 宠物认领
  `chongwulingyang_types` int(11) ...  -- ← 用了「宠物领养」表的前缀
);
```

后果：概念图里「宠物认领」的属性叫「类型」，但含义其实是认领类型，跟领养的「类型」撞名。
修法：改成 `chongwurenling_types`，或至少在 COMMENT 里写清「认领类型」。

### 4.7 同名异义

```sql
-- 两张表都有 jieshu_types，但含义不同
`jieshu_types` int(11) COMMENT '是否被认领'    -- 在 chongwulingyang
`jieshu_types` int(11) COMMENT '是否找到主人'  -- 在 chongwurenling
```

概念图里两个「是否被认领 / 是否找到主人」属性并列，读图人能分清；
但如果 COMMENT 都写成「状态」，就必须改名区分。

### 4.8 主键 / 唯一约束缺失

没有主键 → 实体无法唯一标识 → `1:n` 退化成 `m:n`，图画出来是错的。
业务键（`username`、`phone`、`id_card`）没有 `UNIQUE` → 概念图里说不清哪个是标识属性。

```sql
`username` varchar(200) DEFAULT NULL COMMENT '账户',   -- 应该 UNIQUE
```

---

## 5. 改 SQL 还是只写概念 DSL？

**先问一句再动手**，别默认重写用户的库：

| 用户要什么 | 做什么 | 动不动 SQL |
| --- | --- | --- |
| 只要论文插图 | `--emit-dsl` 出骨架 → 补联系 → 出图 | 不动 |
| 要能跑的库 | 输出修正 `ALTER TABLE` + 迁移清单，逐条说明为什么 | 动，但要列清单 |
| 要「物理模型」（表结构图） | 出 `erd` 图（crow's foot），保留原字段名 | 不动 |
| 要「概念模型」（E-R 图） | 出 `chen-er`，中文实体名、动作联系名、不出现表/主键/外键字样 | 不动 |

概念层不出现物理术语：`表` → 实体，`字段` → 属性，`外键` → 联系。
把 `chongwulingyang_id` 这种物理名画进概念图，是不规范的。

---

## 6. 交付话术（必须声明推断）

不要假装图是从库里原样读出来的。固定模板：

> 原始建表脚本未声明外键约束。图中 **N 条联系**按 `xxx_id` 命名推断；
> 另有 **M 条业务联系**（审核人、发布者）在库中无对应字段，按业务语义补入，已在图中标注。
> 字典类字段（性别、类型、状态）作为属性处理，未建联系。

这句话既交代了来源，也解释了为什么图比库「多出」几条线。

---

## 7. 完整案例：宠物领养系统

真实毕设库（`samples/complex/pet-adoption.sql`）：14 张表、0 条外键、字段中文 COMMENT 齐全。

### 体检结果

```
14 张表 / 显式外键 0 条 / 命名推断 11 条 / 概念图排除 3 张（config、dictionary、token）
能画进概念 E-R 图的联系：10 条
```

### 高优先级发现

| 代码 | 位置 | 问题 |
| --- | --- | --- |
| `MISSING_AUDITOR` | `chongwulingyangshenhe` | 只有一个 `yonghu_id`，缺审核人 → 「谁审的」这条联系不存在 |
| `MISSING_AUDITOR` | `chongwurenlingshenhe` | 同上 |
| `SAME_NAME_DIFF_MEANING` | `yonghu_id` | 在 6 张表里分别是「领养用户 / 认领用户 / 发布用户 / 用户」，一个字段担多角色 |
| `NAME_PREFIX_MISMATCH` | `chongwurenling.chongwulingyang_types` | 认领表里用了领养表的前缀 |
| `NAME_PREFIX_MISMATCH` | `chongwulingyangshenhe.chongwurenlingshenhe_text` | 领养审核表里存着「认领凭据」的字段名 |

### 中优先级发现

- `M2M_JUNCTION`：两张审核表 + 视频收藏，都是「两外键 + 状态」，概念层应是 `m:n`
- `MISSING_AUTHOR`：宠物领养、教学视频、公告都有正文但无发布者
- `MISSING_REPLIER`：视频留言有 `reply_text`，但没记「谁回复的」
- `REL_NAME_DUPLICATE`：`发布` / `收藏` / `留言` 各出现两次（同父实体，无法用短前缀区分）

### 出图

```bash
node scripts/sql-audit.mjs --file pet-adoption.sql \
  --emit-dsl er/pet.dsl --title "宠物领养系统 E-R 模型"

node scripts/ds.mjs er --file er/pet.dsl --outdir figures/er
```

`--emit-dsl` 会生成 11 个实体 + 10 条联系，并把上表的待确认项写成文件末尾的注释，
逐条处理完再删注释即可。

生成的骨架里：

- 主键属性显示为「编号」（`主键` 是生成器口径，不是概念层用词）
- 联系名已去角色化：`领养用户` → `领养`
- 重名的两张审核联系自动变成 `领养审核` / `认领审核`
- 外键字段不出现在属性列表里（改由联系表达）

---

## 8. 自检清单

出图前过一遍：

- [ ] 跑过 `sql-audit.mjs`，`T2` / `T3` 条目都读过了
- [ ] 每张审核/审批表都问过「审核人是谁」
- [ ] 每张内容表都问过「谁发布的」
- [ ] 有 `reply_*` 的表都问过「谁回复的」
- [ ] 字典枚举没有变成实体
- [ ] 中介表还原成了 `m:n`（或说明了为何保留为实体）
- [ ] 联系名是动作，不是角色名、不等于实体名
- [ ] 概念图里没有「表 / 字段 / 主键 / 外键」这些物理词
- [ ] 没有主键的表已补主键
- [ ] 交付时声明了哪些联系是推断的、哪些是补的

---

## 9. 两个易踩的语法坑

**① `chen-er` 的 DSL 和 `/api/v1/er/views` 的概念 DSL 不是一套语法。**

| | `render --kind chen-er` | `POST /api/v1/er/views` |
| --- | --- | --- |
| 实体 | `entity 学生 as Student`（无花括号） | `entity 学生 as Student {` … `}` |
| 属性 | `attribute 学号 as Sno of Student`（**必须带 `of`**） | 花括号内 `key 学号` / `attribute 姓名` |
| 联系 | `relationship 选修 as Enroll` + `Student(1) -- Enroll -- (n) Course` | `relationship 选修 as Enroll between Student, Course cardinality m:n` |

`--emit-dsl` 生成的是**后者**（配套 `ds.mjs er`）。塞给 `render --kind chen-er` 会报
「第 3 行：Chen ER 语句格式不正确」。

**② SQL 反推的模型基数恒为 `1:n`。**
需要 `1:1` / `m:n` / 联系属性，必须手写概念 DSL，SQL 里读不出来。
