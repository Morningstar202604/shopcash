# 店收宝 ShopCash — 单机门店收银与收款记账软件
# Claude Code 开发规范文档 v1

**文档版本**: v1.0
**创建日期**: 2026-10-13
**项目代号**: shopcash
**状态**: 需求已确认；W1–W4 代码与界面已落地并通过自检（见 19.1 实现进度对照），W5–W8 待推进，W7 依赖商家商户号开通
**开发工具**: Claude Code / 任意支持 TypeScript 的 AI 编程代理
**PRD Generator 版本**: v4.0

> **本文档是本项目开发的唯一真相源。** 任何与本文档冲突的实现选择，以本文档为准；要改变本文档，先改文档再改代码。

---

## 目录

1. 项目概述与目标
2. 技术架构
3. 权限体系
4. 数据模型
5. 功能模块详细说明
6. AI Prompt 设计（本项目 V1 不涉及）
7. 页面清单与路由
8. API 接口清单
9. 性能与并发方案
10. 安全设计方案
11. 界面适配策略
12. 开发规约与已知陷阱
13. 测试策略（TDD 强制）
14. 构建与分发
15. 架构韧性设计
16. 跨系统状态一致性（资金核心）
17. 第三方服务风险管理
18. 事故响应流程
19. 开发里程碑
20. 环境变量与配置
21. 项目目录结构
22. 第三方依赖清单
23. 运维手册
24. 成本估算
25. 并发承载分析表
26. CLAUDE.md 内容
27. 上线检查清单
28. 附录

---

# 1. 项目概述与目标

## 1.1 项目背景

本项目的代码与设计源自对开源仓库 KeBaiPay（gitcode.com/badhope/KeBaiPay）的安全与合规审查。该审查发现其核心问题：**宣称"资金绝不过平台"，但数据模型是平台级单一渠道商户号、无子商户进件、无结算实现路径**——真实多商家运营即构成监管定义的"二清"。

店收宝是这条问题的**正向解法**：把产品收窄为"卖给单个门店的绿色收银软件"，资金完全走**商家自己申请的微信/支付宝直连商户号**，软件只提供订单信息流，**永不介入资金流**。这样开发者无需支付牌照，商家资金安全由持牌渠道保障。

## 1.2 V1 核心目标

一句话定位：**一家店、一台 Windows 电脑、一个文件夹，把微信/支付宝/现金收款收清楚、记得住、对得上、退得掉。**

量化指标（V1 验收线）：

| 指标 | 目标 |
|---|---|
| 收银一笔从点按钮到出收款码 | ≤ 300ms（mock 渠道） |
| 支付成功到界面翻转"已到账" | ≤ 8s（主动查单轮询命中） |
| 掉单（渠道成功但本地未确认）自动纠正率 | ≥ 99%（剩余进 EXCEPTION 人工） |
| 崩溃/断电后数据丢失 | 0 笔已提交事务 |
| 日对账差异检出 | 三类差异全部可列出并可导出 |
| 装机到能收银（含首启向导） | ≤ 10 分钟，无需技术人员 |
| 单元测试 | 资金状态机与金额校验行覆盖 ≥ 90% |

## 1.3 目标用户

| 角色 | role 值 | 特征 | 核心需求 |
|---|---|---|---|
| 店主 | `OWNER` | 小店老板/个体户，非技术背景，一台电脑自己用或交给店员 | 收到钱、每天对得上、能退款、不怕电脑坏 |
| 店员 | `CASHIER` | 被雇佣，共用同一台电脑，流动性高 | 快速收银、不背别人的账、交接清楚 |

单一租户（一个安装 = 一家店），无多租户、无 SaaS 账号体系。

## 1.4 架构设计要点

- **单进程 + 单机 + 单库**：一个 NestJS 进程、一个 SQLite 文件、仅监听 `127.0.0.1`。
- **无外部中间件**：无 Redis、无 Docker、无对象存储、无云 API（V1 阶段除支付渠道外零外网依赖）。
- **桌面壳与业务分离**：Rust/Tauri 只做窗口、托盘、自启、进程编排与健康看门狗；所有业务规则在 Node 侧。
- **升级钩子**：渠道接口预留服务商模式参数位（`subMchId`、`profitSharing`），分账表结构留骨架不实现，二期拿到服务商资质时不重构。

---

# 2. 技术架构

## 2.1 技术栈（版本锁定）

| 层 | 选型 | 版本 |
|---|---|---|
| 桌面壳 | Tauri | `2.x`（Rust stable `1.8x`，MSVC 工具链） |
| 壳插件 | tauri-plugin-shell / single-instance / autostart / dialog | 与 Tauri 2 主版本配套 |
| 后端运行时 | Node.js | `22.x LTS`（win-x64 官方二进制内嵌） |
| 后端框架 | NestJS | `11.x` |
| ORM | Prisma | `6.x`，provider = `sqlite` |
| 数据库 | SQLite | 系统内置（Prisma 携带），WAL 模式 |
| 前端 | Vue `3.5.x` + Vite `6.x` + TypeScript `5.9.x` | 原生 DOM + 自研组件，不引入重型 UI 库 |
| 前端状态 | Pinia `2.x` | |
| 单元测试 | Jest `30.x` + ts-jest `29.x` | |
| 端到端测试 | Playwright `1.5x` | 仅用于打包产物冒烟 |
| 打包 | PowerShell 7 脚本 + Tauri bundle + `tar` | |
| 目标 OS | Windows 10 21H2+ / Windows 11，仅 `x64` | |

> **版本校验红线**：W1 第 1 步必须用 `npm view <pkg> version` 逐个核对上表版本在 npm registry 真实存在且互相兼容；发现偏差时**先修改本文档 2.1 与 22 章，再动代码**，禁止静默改版本。（源项目 KeBaiPay 因堆到 NestJS 12 / Prisma 7 / Node ≥24.9 这类前沿版本，装机门槛极高，本项目不重犯。）

## 2.2 技术选型理由

- **Tauri 而非 Electron**：包体小（壳约 10MB vs 200MB）、内存低；商家电脑可能是低端二手本机/POS 机。代价（WebView2 依赖）已用启动检测 + 浏览器 kiosk 退化兜底。
- **Node sidecar 而非把业务写进 Rust**：业务逻辑（渠道协议、金额校验、对账解析）在 TS 生态里已有成熟实现与 SDK（`wechatpay-node-v3`、`alipay-sdk`），Rust 重写成本与出错率高。
- **SQLite 而非 Postgres**：单机单店峰值仅 3~5 笔/分钟，SQLite WAL 的写入能力余量充足；嵌入式 PG 会把包体和装机复杂度翻倍。
- **去掉 Redis 分布式锁**：单进程内 Mutex + 数据库条件原子更新 + 唯一约束已经足够，且少一个故障点。
- **保持 money = 整数分**：与源项目一致（这是它做对的地方），杜绝浮点误差。

## 2.3 系统架构图

```
┌─ 商家电脑 Windows 10/11 x64 ─────────────────────────────────┐
│                                                              │
│  ShopCash.exe (Tauri/Rust)                                   │
│   ├─ WebView2 窗口：加载 http://127.0.0.1:<port>/            │
│   ├─ 启动前置检查：WebView2 可用性 → 缺失则装 bootstrapper   │
│   │                 → 失败则用 Edge --kiosk 打开本地页面     │
│   ├─ single-instance 锁（第二实例只唤起主窗口，不起 sidecar）│
│   ├─ spawn runtime\node.exe app\main.js --port <p> --data-dir <d>
│   ├─ 健康看门狗：GET /healthz，崩溃重启 ≤3 次，超限托盘报错 │
│   └─ 退出：kill 自己持有的子进程句柄（不按端口扫杀）        │
│                                                              │
│  NestJS sidecar（唯一业务进程）                              │
│   ├─ 仅绑 127.0.0.1；端口由壳探测空闲后传入                 │
│   ├─ 模块：bootstrap / auth / cashier / channels / orders /  │
│   │        refunds / shifts / reconciliation / staff /       │
│   │        exceptions / audit / backup / diagnostics / setup │
│   ├─ 静态服务：Vue 构建产物                                  │
│   ├─ Scheduler：查单轮询 / 超时关单 / 自动快照 / 日志滚动   │
│   └─ ChannelRegistry：mock | wechat | alipay                 │
│                                                              │
│  data\app.db (SQLite WAL)  keys\master.key  backups\  logs\  │
└──────────────────────────────────────────────────────────────┘
```

## 2.4 服务依赖关系与启动顺序

1. Tauri 壳启动 → single-instance 检查 → 数据目录检查/创建 → 端口探测 → 拉起 sidecar
2. sidecar：加载 env → 打开 SQLite（`journal_mode=WAL`、`busy_timeout=5000`、`foreign_keys=ON`）→ `prisma migrate deploy` → 启动期检查（口令策略、密钥文件、渠道配置完整性）→ 恢复扫描（PAYING/PENDING 订单）→ 注册定时任务 → 监听 HTTP
3. 壳轮询 `/healthz` 至 ready → WebView 加载页面

## 2.5 有状态/无状态组件

| 组件 | 状态性 | 影响 |
|---|---|---|
| SQLite 文件 | 强有状态 | 备份/恢复的核心对象；不可水平扩展（设计即单机，不追求） |
| 进程内 Mutex / 轮询队列 | 有状态但可重建 | 重启后由"恢复扫描"从 DB 重建，无需持久化 |
| `keys\master.key` | 强有状态 | **丢失即渠道凭据不可解密**，必须与备份同存 |
| HTTP 会话 | 有状态（内存 + DB） | 重启后所有会话失效，需重新登录（V1 接受） |

---

# 3. 权限体系

## 3.1 权限矩阵

| 能力 | OWNER | CASHIER | 数据范围（CASHIER） |
|---|---|---|---|
| 收银（新建订单、展示收款码、现金收款入账） | ✅ | ✅ | 本人当班 |
| 查看订单列表/详情 | ✅ 全部 | ✅ 仅本班次 | `shiftId = 当前班次` 且 `createdById = 本人`；历史班次订单需 OWNER 授权 |
| 发起退款 | ✅ | ✅ 需 OWNER 口令确认 | 本班次订单 |
| 审批/执行退款 | ✅ | ❌ | — |
| 处理异常单（EXCEPTION 结案/改状态） | ✅ | ❌ | — |
| 渠道凭据配置与自检 | ✅ | ❌ | — |
| 员工账号增删改、停用 | ✅ | ❌ | — |
| 班次开档（备用金） | ✅ | ✅ | 本人 |
| 班次交班（实点金额、差额） | ✅ | ✅ 仅本人班次 | 本人 |
| 日对账导入/差异处理 | ✅ | ❌ | — |
| 数据导出 CSV | ✅ 全部 | ✅ 仅本班次汇总 | — |
| 备份导出 / 恢复备份 | ✅ / ✅（恢复需二次确认） | ❌ | — |
| 修改店铺信息与运行参数 | ✅ | ❌ | — |
| 查看审计链与完整性校验 | ✅ | ❌ | — |
| 生成诊断信息包 | ✅ | ✅（只读） | — |

## 3.2 数据过滤规则（伪代码）

```ts
// 所有订单/班次查询都必须经过此过滤器，禁止在 Controller 里裸查
function applyScope(where: OrderWhere, ctx: AuthContext): OrderWhere {
  if (ctx.role === 'OWNER') return where
  if (!ctx.activeShiftId) return { ...where, id: '__none__' }   // 无当班班次 → 返回空集
  return { ...where, shiftId: ctx.activeShiftId, createdById: ctx.userId }
}
```

## 3.3 关键权限逻辑

- **会话与班次绑定**：登录成功签发不透明 token（32 字节随机，服务端内存 + `sessions` 表存哈希）。`AuthContext` 内含 `userId / role / activeShiftId`。店员未开班次时，`applyScope` 返回空集，界面前置拦截并提示"先上班次"。
- **敏感操作二次确认**：`退款执行`、`异常单结案`、`恢复备份`、`修改渠道凭据`、`删除订单备注`、`停用员工` 六类操作，请求体必须携带 `confirmPassword`（当前操作者口令），服务端用 bcrypt 比对，**失败仅返回 40311，不区分"账号不存在/口令错"**。连续 5 次确认失败锁定该操作 15 分钟。
- **员工停用即时生效**：`user.status=DISABLED` 后会话在下一次请求即失效（Guard 每请求查内存缓存，写操作时失效）。

## 3.4 前端路由守卫

| 路由 | 未登录 | 角色不足 | 未开班次（CASHIER） | 未完成首启 |
|---|---|---|---|---|
| `/setup` | 放行 | — | — | 强制停留 |
| `/login` | 放行 | — | — | 跳转 `/setup` |
| `/cashier` | → `/login` | 放行 | → `/shift-open` | → `/setup` |
| `/orders` `/audit` `/exceptions` `/recon` `/channels` `/staff` `/backup` | → `/login` | 403 页 | 放行（按过滤范围显示） | → `/setup` |

## 3.5 敏感操作二次确认清单

见 3.3；实现方式：统一 `POST` 请求体字段 `confirmPassword`，由 `@RequireOwnerConfirm()` 装饰器守卫处理，禁止各接口自行实现。

---

# 4. 数据模型

## 4.1 ER 关系

```
users 1─┬─* orders (createdById, reviewedById)
        ├─* shifts (userId)
        ├─* sessions (userId)
        ├─* audit_logs (actorId)
        └─* recon_diffs (handledById)

orders 1─* order_events
orders 1─* refunds
recon_batches 1─* recon_diffs *─1 orders(可空)
```

## 4.2 表结构（Prisma/SQLite DDL 语义）

> 所有金额字段类型 `Int`，单位**分**；所有时间字段 `DateTime`，写入一律 UTC（见 12.1）。

```prisma
model User {
  id            String   @id @default(uuid())
  username      String   @unique                 // 4-20 位，字母数字，大小写不敏感唯一
  displayName   String                          // 1-30 字符
  passwordHash  String                          // bcrypt cost=12
  role          String   @default("CASHIER")     // OWNER | CASHIER
  status        String   @default("ACTIVE")      // ACTIVE | DISABLED
  mustChangePwd Boolean  @default(false)         // 首启向导/重置后置 true
  failedCount   Int      @default(0)
  lockedUntil   DateTime?
  createdById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  orders        Order[]    @relation("CreatedOrders")
  reviewedOrders Order[]   @relation("ReviewedOrders")
  shifts        Shift[]
  auditLogs     AuditLog[]
  sessions      Session[]
  diffs         ReconDiff[] @relation("HandledBy")
}

model Order {
  id               String   @id @default(uuid())
  orderNo          String   @unique              // SC+yyyyMMddHHmmss+6位随机，本地生成
  clientRequestId  String   @unique              // 客户端幂等键（uuid），重复提交返回原单
  amountFen        Int                            // >0，≤ 上限见 5.2 业务规则
  status           String   @default("PENDING")  // PENDING|PAYING|PAID|CLOSED|REFUNDING|REFUNDED|EXCEPTION
  codeType         String                          // WECHAT|ALIPAY|CASH|MOCK
  channelCode      String                          // mock|wechat|alipay（CASH 时为 'cash'）
  channelOrderNo   String?                         // 渠道交易号
  payerSnapshot    String?                         // 渠道返回的付款方脱敏标识（不落明文账号）
  subject          String?                         // ≤50 字符
  remark           String?                         // ≤200 字符
  shiftId          String?
  createdById      String
  reviewedById     String?                         // EXCEPTION 结案人 / 退款审批人
  exceptionReason  String?                         // AMOUNT_MISMATCH|LATE_SUCCESS|NO_CALLBACK|PARSE_FAIL|MANUAL|REFUND_FAILED
  idempotencyKey   String?  @unique
  notifyState      String?                         // WAIT|RECEIVED|NONE（CASH 为 NONE）
  amountFenPaid    Int?                            // 渠道确认实付金额，入账时与 amountFen 必须相等
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  paidAt           DateTime?
  closedAt         DateTime?
  nextQueryAt      DateTime?                       // 查单轮询调度时间，null=不再查
  queryAttempt     Int      @default(0)
  archivedAt       DateTime?

  created_by  User    @relation("CreatedOrders", fields: [createdById], references: [id])
  reviewed_by User?   @relation("ReviewedOrders", fields: [reviewedById], references: [id])
  events      OrderEvent[]
  refunds     Refund[]

  @@index([status, nextQueryAt])
  @@index([shiftId, createdAt])
  @@index([createdById, createdAt])
  @@index([createdAt])
}

model OrderEvent {
  id          String   @id @default(uuid())
  orderId     String
  fromStatus  String?
  toStatus    String
  source      String    // UI|CALLBACK|QUERY|SCHEDULER|MANUAL|IMPORT
  actorId     String?
  rawData     String    // JSON 文本，渠道原始返回，敏感字段入库前脱敏
  createdAt   DateTime  @default(now())
  order       Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, createdAt])
}

model Refund {
  id              String   @id @default(uuid())
  refundNo        String   @unique
  orderId         String
  amountFen       Int
  status          String   @default("PENDING") // PENDING|APPROVED|PROCESSING|SUCCESS|FAILED
  reason          String                        // 必填 1-100 字符
  initiatedById   String
  approvedById    String?
  channelRefundNo String?
  approvalJson    String   @map("approval_data") // JSON 文本；approvalById 为保留字，物理列名 approval_data
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  order           Order    @relation(fields: [orderId], references: [id], onDelete: Restrict)
  @@index([orderId, status])
}

model Shift {
  id                String   @id @default(uuid())
  userId            String
  openAt            DateTime @default(now())
  closeAt           DateTime?
  floatCashFen      Int      @default(0)          // 备用金
  expectedCashFen   Int      @default(0)          // 系统算：现金订单应收
  expectedOnlineFen Int      @default(0)          // 系统算：线上已到账
  countedCashFen    Int?                          // 实点现金
  diffFen           Int?                          // 实点+备用金 - 应收
  note              String?
  status            String   @default("OPEN")     // OPEN|CLOSED
  orders            Order[]  @relation("ShiftOrders")
  user              User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  @@index([userId, status])
  @@index([openAt])
}

model AuditLog {
  id         Integer  @id @autoincrement
  ts         DateTime @default(now())
  actorId    String?
  actorRole  String?
  action     String                              // 大写下划线，如 REFUND_APPROVE
  targetType String                              // ORDER|REFUND|USER|CHANNEL|BACKUP|SHIFT|SETTING
  targetId   String?
  beforeJson String?
  afterJson  String?
  amountFen  Int?
  ip         String?                              // 恒为 127.0.0.1，保留字段
  prevHash   String?
  hash       String?
  @@index([ts])
  @@index([targetType, targetId])
}

model ChannelConfig {
  id          String   @id @default(uuid())
  code        String   @unique                   // mock|wechat|alipay
  mode        String   @default("DIRECT")        // DIRECT | SERVICE_PROVIDER（V1 仅 DIRECT）
  enabled     Boolean  @default(false)
  cipherText  String?                             // enc:v2(base64(iv|ct|tag))，AES-256-GCM
  keyVersion  String                              // master.key 指纹前 12 位，用于校验密钥一致性
  certPath    String?                             // 指向 keys\ 下的商户证书文件，不存内容
  lastCheckAt DateTime?
  lastCheckOk Boolean?
  lastCheckMsg String?
  updatedAt   DateTime @updatedAt
}

model ReconBatch {
  id          String   @id @default(uuid())
  billDate    String                              // YYYY-MM-DD（本地收单日，按商家时区）
  channelCode String
  source      String                              // PASTE|FILE
  rowsTotal   Int      @default(0)
  matched     Int      @default(0)
  diffCount   Int      @default(0)
  createdAt   DateTime @default(now())
  diffs       ReconDiff[]
  @@unique([billDate, channelCode])
}

model ReconDiff {
  id          String   @id @default(uuid())
  batchId     String
  orderId     String?
  kind        String                              // LOCAL_ONLY|CHANNEL_ONLY|AMOUNT_MISMATCH|STATUS_MISMATCH
  billAmountFen   Int?
  localAmountFen  Int?
  channelOrderNo  String?
  status        String   @default("OPEN")         // OPEN|RESOLVED|IGNORED
  resolveNote   String?
  handledById   String?
  createdAt     DateTime @default(now())
  batch         ReconBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  handled_by    User?    @relation("HandledBy", fields: [handledById], references: [id])
  @@index([batchId, status])
}

model Session {
  id         String   @id @default(uuid())
  userId     String
  tokenHash  String   @unique                     // sha256(token)
  shiftId    String?
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
  expiresAt  DateTime
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AppMeta {
  key   String @id                                  // setupDone|lastBackupAt|dbFingerprint|schemaVersion
  value String
}
```

## 4.3 JSON 字段结构示例

`ChannelConfig.cipherText` 解密后的明文对象：

```json
{
  "wechat": {
    "appid": "wx1234567890abcdef",
    "mchid": "1900000109",
    "serialNo": "5157F05EF9459535147F3708D2E0A4EBCE846BF5",
    "apiV3Key": "****（32 位）",
    "privateKeyPem": "----（PEM 全文）",
    "platformCertPem": "----（PEM 全文）",
    "notifyUrl": ""
  },
  "alipay": {
    "appId": "2021000000000000",
    "privateKeyPem": "----",
    "publicKey": "----",
    "signType": "RSA2",
    "notifyUrl": ""
  }
}
```

`OrderEvent.rawData`：

```json
{ "traceId": "b3f1...", "channel": "mock", "source": "QUERY",
  "resp": { "trade_state": "SUCCESS", "amount": { "total": 1280, "payer_total": 1280 },
            "transaction_id": "MOCK20261013165500", "time_expire": "2026-10-13T09:10:00Z" } }
```

## 4.4 索引清单

见 4.2 中 `@@index`。补充执行计划要求：`GET /orders` 的分页查询必须命中 `[shiftId, createdAt]` 或 `[createdAt]`，W6 用 `EXPLAIN QUERY PLAN` 断言不出现 `SCAN orders`（10 万行基准表）。

## 4.5 迁移策略

Prisma Migrate，迁移文件入库（`prisma/migrations/`）。**禁止 `prisma db push` 用于任何商家环境**。启动时自动 `migrate deploy`；迁移失败 → 进程拒绝就绪并在诊断页显示原因，界面停在"维护中"提示页。商家数据升级前自动触发一次备份（备份失败则中止迁移）。

## 4.6 大表演练

SQLite 单表超过 50 万行后 `ALTER TABLE` 会整表重写（可达数十秒，期间收银阻塞）。因此：**任何 schema 变更必须在 PRD 中标注是否需要重建表；需要重建的，走"新表 + 双写 + 切换 + 旧表归档"四步，禁止直接 ALTER 大表。** 满 12 个月的订单先导出 CSV 归档再从主表删除（保留按日汇总行）。

## 4.7 数据增长预估

| 表 | 假设 | 年增长 | 归档策略 |
|---|---|---|---|
| orders | 300 笔/天 | ≈ 11 万 | 12 个月归档 |
| order_events | 每笔 3~5 条 | ≈ 45 万 | 随订单归档（Cascade） |
| audit_logs | 每店每天 30~80 条 | ≈ 2.5 万 | 24 个月归档 |
| recon_batches/diffs | 每天 2 渠道 | < 1 万 | 24 个月 |

---

# 5. 功能模块详细说明

> 每个模块含：功能描述 / 业务规则 / 正常流程 / 异常处理 / 异步任务 / 数据流向 / 幂等设计 / 并发控制。

## 5.1 首启向导（bootstrap）

**功能**：首次运行创建店铺与店主账号。
**业务规则**：
- 未初始化（`AppMeta.setupDone != true`）时，除 `/bootstrap/*` 与 `/healthz` 外全部接口返回 42801，前端强制跳转 `/setup`。
- 店主口令强度：≥10 位，含大写+小写+数字，不得等于用户名，不得命中内置弱口令字典（含 `ChangeAdmin2026`、`Admin@2026` 等——**源项目把这类口令印在 README 且能通过校验，本项目必须把它们列入禁用表**）。
- 创建成功后 `mustChangePwd=false`（首启即为本人设定），渠道模式默认 `mock`。
- 初始化时生成 `keys\master.key`（32 字节随机，base64），权限尽力设为仅当前用户可读（Windows 用 `icacls` 收紧，失败记警告但不阻塞）。
**正常流程**：欢迎页 → 店名+营业时间+收款上限 → 店主用户名/昵称/口令 → 初始化 → 进入收银台。
**异常处理**：`master.key` 已存在但数据库缺失 → 提示"检测到旧数据目录，是否恢复备份"；口令不合格 → 内联错误，不提交。
**幂等**：`setupDone=true` 后再次调用返回 40901。
**数据流**：`SetupView.vue → POST /bootstrap/setup → BootstrapService → 写 users/app_meta/channel_configs(mock) + 建 master.key → 审计 BOOTSTRAP_DONE`。

## 5.2 收银台（cashier）

**功能**：输入金额生成订单并展示收款方式；支持现金直接入账。
**业务规则**：
- 金额：`0.01 ≤ amountFen ≤ 单笔上限（默认 50000000 分＝50 万元，可在 /setup/settings 调）`；输入以元为单位，用 `yuanToFen()` 归一，**超过两位小数直接拒绝**（不做 `Math.round` 静默补全——源项目此处只做模糊归整，本项目改为 fail-closed 校验）。
- 订单有效期默认 15 分钟（可配 5/10/15/30）。
- 每笔订单必须绑定 `shiftId`：CASHIER 未开班次时禁止创建（40320）；OWNER 未开班次时归入一条 `虚拟班次 "OWNER_DEFAULT"`，便于日报口径统一。
- `clientRequestId` 由前端 `crypto.randomUUID()` 生成，同一次点击会话内复用。
- 现金收款：`codeType=CASH` → 直接置 `PAID`，`channelCode='cash'`，`notifyState=NONE`，不进查单队列。
**正常流程**：输金额 →（可选备注）→ 点"微信" → 出二维码 + 轮询状态 → 到账翻绿 + 提示音 → 自动回到空白收银页。
**异常处理**：
| 情况 | 界面表现 |
|---|---|
| 渠道下单失败（网络/凭据） | 红色 Toast"渠道下单失败：{简述}"，订单进 `EXCEPTION(NO_CALLBACK)`，提供"重试/作废"按钮 |
| 二维码加载失败 | 显示"重试"占位，不清空订单 |
| 等待中网络/渠道超时 | 界面显示"仍在确认中，最长等到 15:00"倒计时；超时后自动进 `CLOSED` 并提示"若顾客称已付款，请到异常工作台核对" |
| 无当班班次 | 弹出引导开班次面板 |
**异步任务**：查单轮询（见 5.3）、超时关单（5.3）。
**数据流**：`CashierView → POST /cashier/orders → CashierService →(TX) insert orders(PENDING) → Channel.createOrder → update(PAYING, nextQueryAt) → 返回 codePayload`。
**幂等**：`clientRequestId` 唯一约束；命中则直接返回既有订单，不重复向渠道下单。
**并发控制**：同一 `shiftId` 允许并发创建（一笔一进程内串行化在渠道调用上，用 `Mutex('order:'+id)` 防止同一订单被并发推进）。

## 5.3 到账确认三层兜底（payment-confirm）

**功能**：把渠道真实支付结果落到本地状态。
**业务规则（三条硬规则，实现必须有测试覆盖）**：
1. **金额强校验**：`channelResult.amountFen === order.amountFen` 才允许 `→PAID`；不相等 → `→EXCEPTION(AMOUNT_MISMATCH)`，写 `OrderEvent(rawData)`，界面异常工作台红色标记。
2. **迟到的成功**：订单已 `CLOSED` 后，任何来源（回调/查单/对账）查到支付成功 → 只允许 `→EXCEPTION(LATE_SUCCESS)`，**绝不自动置 PAID**；由 OWNER 人工结案（结案动作可选"确认收款并补录"或"退回顾客"）。
3. **条件原子更新**：所有状态推进一律
   ```sql
   UPDATE orders SET status=?, ... WHERE id=? AND status IN (?,?)
   ```
   影响行数 0 视为并发冲突，记录并放弃，不重试覆盖。
**三层**：
- L1 回调（可选）：`POST /webhooks/channel/:code`，**验签先于幂等判断**，未配 `notifyUrl` 时该路由返回 50301 并记审计。
- L2 主动查单：`Scheduler` 每 2 秒取 `nextQueryAt <= now AND status IN (PAYING,PENDING)` 批量 ≤20 条；退避序列 `3s,10s,30s,120s,300s`，第 5 次后每 300s 再查至 15 分钟，仍无结果 → `CLOSED`。
- L3 日对账：账单导入把 L1/L2 都漏掉的差异暴露出来（5.8）。
**异步任务**：单实例互斥（`AppMeta` 里 `queryLoopRunning` 标志 + 进程内 guard），每轮完成更新 `queryAttempt`。
**幂等**：`OrderEvent` 允许重复探测记录，但状态推进靠条件原子更新 + 已 PAID 短路返回。
**并发控制**：`Mutex('order:'+orderId)` 保证回调与轮询不交叉。

## 5.4 订单簿与导出（orders）

列表筛选（日期区间/状态/收款方式/班次/关键字 orderNo|渠道号|备注）、详情（含完整事件时间线）、CSV 导出（UTF-8 BOM，Excel 可直接打开；字段公式注入防护：以 `=+-@` 开头的单元格前置单引号）。CASHIER 导出仅本班次。删除备注（软操作，写审计，保留 `OrderEvent`）。

## 5.5 退款（refunds）

**规则**：仅 `PAID` 或 `PARTIAL`（通过 `refundedFen` 累计）可退；`refundAmountFen + 已退 ≤ amountFen`；理由必填。流程 `PENDING（店员/店主发起）→ APPROVED（店主口令确认）→ PROCESSING（调渠道）→ SUCCESS | FAILED`。`FAILED` → 订单进 `EXCEPTION(REFUND_FAILED)`，必须人工处理（可重试）。全额退成功后订单 `→REFUNDED`，部分退保持 `PAID` 并累加已退金额。
**幂等**：`refundNo` 唯一 + `idempotencyKey`；渠道退款请求携带 `out_request_no = refundNo`。
**并发**：`Mutex('refund:'+orderNo)` + `UPDATE orders SET ... WHERE id=? AND amountFen >= 已退+本次` 守卫防超退。

## 5.6 班次与交接班（shifts）

**规则**：一个用户同时最多一个 `OPEN` 班次。开档填备用金（≥0）。交班时系统计算：
```
应收现金 expectedCashFen = Σ(codeType=CASH 且 status=PAID 且非退款成功) - Σ现金退款
应收线上 expectedOnlineFen = Σ(线上渠道 status=PAID) - Σ(status=REFUNDED 的已退)
实点差额 diffFen = (countedCashFen + floatCashFen) - (expectedCashFen + floatCashFen)
                 = countedCashFen - expectedCashFen
```
交班后班次 `CLOSED`，数据只读（不可改，只能由 OWNER 追加更正说明）。异常单不计入应收，在交接单上单独列出提醒。
**幂等**：重复交班请求返回已有结果（`status=CLOSED` 短路）。

## 5.7 员工管理（staff）

OWNER 增删改 CASHIER；用户名大小写不敏感唯一；重置口令后 `mustChangePwd=true`，首次登录强制改密（拦截除改密/登出外所有接口，返回 42802）。停用即时踢会话。不允许删除最后一个 OWNER、不允许把自己降为 CASHIER。

## 5.8 日对账（reconciliation）

**规则**：按 `(billDate, channelCode)` 唯一（重复导入即覆盖并清空未处理差异，需 OWNER 确认）。解析器：微信 V4/V3 账单 CSV、支付宝对账单 CSV（表头映射 + 金额元→分）、mock 账单。逐笔按 `channelOrderNo` 匹配本地订单，差异落 `ReconDiff`：
- `LOCAL_ONLY`（本地有 PAID，渠道无）
- `CHANNEL_ONLY`（渠道有成功，本地无对应订单或本地非 PAID）
- `AMOUNT_MISMATCH` / `STATUS_MISMATCH`
差异处理：OWNER 可"补录/标记异常/忽略并说明"，补录走 5.3 规则 2 的人工结案通道。差异数 > 0 时在总览页顶部常驻黄色横幅。
**注意**：V1 不做自动拉单（渠道账单 API 有 T+1 与配额限制），只提供复制粘贴 + 文件导入，与源项目一致但把差异分类做实。

## 5.9 备份与恢复（backup）

- 自动快照：每 30 分钟，用 SQLite `VACUUM INTO 'backups/app-YYYYMMDD-HHmm.db'`（在线一致快照，不阻塞读），保留最近 7 天 + 每天最后一份保留 30 天。
- 手动"导出全量备份"：zip（db 快照 + `keys\master.key` + `channel_configs` 密文随 db + `meta.json` 版本与校验和）到用户指定目录。
- 恢复：校验 zip 内 `master.key` 与当前 `ChannelConfig.keyVersion` 指纹；不一致时提示"该备份使用另一台机器的密钥，将一并恢复密钥文件"，二次确认后覆盖。恢复流程 = 停调度 → 备份当前 db → 替换 → `PRAGMA integrity_check` → 迁移 → 启动扫描。
**审计**：`BACKUP_EXPORT` / `BACKUP_RESTORE` 必须记哈希链前后状态。

## 5.10 审计哈希链（audit）

写入：`hash = sha256(prevHash + canonicalJson(fields))`，`canonicalJson` 键按字典序稳定序列化。SQLite 单写进程内串行化（写入走同一条队列，天然无分叉）；`链校验` 接口顺序遍历重算，报告首个断链点。字段纳入哈希：`id, ts, actorId, action, targetType, targetId, amountFen, before/after 摘要`。**不承诺抗"整段删除尾部"篡改**（本地单机物理可控），UI 明示该边界，防止误当法律级存证。

## 5.11 异常工作台（exceptions）

`EXCEPTION` 订单列表（按原因分组、按账龄排序）+ 结案表单（处理结论、动作、备注、店主口令）。提供"补录为已收款""退回顾客""作废"三种结论，全部写 `OrderEvent(source=MANUAL)` 与审计。超过 24 小时未处理的异常单，总览页红色计数 + 声音提醒一次/小时。

## 5.12 诊断（diagnostics）

一键生成 `logs\diag-*.zip`：最近 7 天日志 + `app_meta` + db `integrity_check` + 磁盘剩余 + 时区偏差 + 渠道自检结果摘要（**不含任何密钥/口令/身份证**）。供商家发给技术支持。

---

# 6. AI Prompt 设计

V1 不涉及 AI 能力（AI 查账助手已推至 V2）。**禁止在 V1 引入任何大模型依赖或外网 AI 调用。**

---

# 7. 页面清单与路由

## 7.1 页面表

| 页面 | 路由 | 角色 | 说明 |
|---|---|---|---|
| 首启向导 | `/setup` | 未初始化时全员 | 4 步 |
| 登录 | `/login` | 全员 | 用户名+口令 |
| 总览 | `/dashboard` | OWNER | 今日笔数/金额/退款/异常/差异、磁盘与时钟告警位 |
| 收银台 | `/cashier` | 全员 | 主操作页，键盘优先（金额输入框常驻焦点，F2 微信/F3 支付宝/F4 现金/F8 交班） |
| 订单列表 | `/orders` | 全员（CASHIER 限本班） | 筛选+分页 |
| 订单详情 | `/orders/:orderNo` | 同上 | 状态时间线、渠道号、退款记录 |
| 退款 | `/orders/:orderNo/refund` | 全员发起 | 需 OWNER 确认 |
| 异常工作台 | `/exceptions` | OWNER | 分组+结案 |
| 日对账 | `/reconciliation` | OWNER | 导入+差异表 |
| 班次 | `/shifts` | 全员 | 开班/交班/历史 |
| 员工 | `/staff` | OWNER | 增删改 |
| 渠道配置 | `/channels` | OWNER | 三张卡片 + 自检按钮 |
| 备份 | `/backup` | OWNER | 快照列表/手动导出/恢复 |
| 设置 | `/settings` | OWNER | 店名、单笔上限、订单有效期、查单与快照间隔、声音 |
| 审计 | `/audit` | OWNER | 链列表 + 完整性校验 |
| 诊断 | `/diagnostics` | 全员 | 生成诊断包 |
| 强制改密 | `/change-password` | 全员 | `mustChangePwd=true` 时拦截 |

## 7.2 列表页规范
默认按 `createdAt desc`；分页 `pageSize=20`（可选 20/50/100）；关键字搜索命中 `orderNo|channelOrderNo|remark`；日期区间默认"今天"。空状态文案要给出下一步动作（如"今天还没有订单，按 F2 开始收款"）。

## 7.3 核心流程图（店员一天）
```
开机 → 登录 → 开班（备用金 200）→ 连续收银（微信/支付宝/现金）
     → 遇到"顾客说付了但没变绿"→ 继续收款，异常单下班前找店主
     → 交班（实点现金 1230，系统算 1240，差额 -10 + 备注）→ 登出
```

## 7.4 前端守卫逻辑
见 3.4；未初始化优先级最高（→`/setup`），其次 `mustChangePwd`（→`/change-password`），再次登录态与角色。

## 7.5 弱网/本地兜底
本机回环不依赖外网即可收银（现金/生成订单）；渠道下单失败时前端保留金额与备注草稿（`sessionStorage`），重试不重录；所有写请求带 `X-Request-Id`（= clientRequestId），失败可安全重发。

---

# 8. API 接口清单

约定：BaseURL `http://127.0.0.1:<port>`；除 `/healthz`、`/bootstrap/*` 外均需 `Authorization: Bearer <token>`；响应统一信封
```json
{ "code": 0, "message": "ok", "traceId": "…", "data": { } }
```
错误码见 10.3。**所有 POST/PUT 请求体必须过 class-validator 白名单校验，`forbidNonWhitelisted=true`。**

## 8.1 清单（按模块，共 47 个）

| 方法 | 路径 | 说明 | 角色 |
|---|---|---|---|
| GET | `/healthz` | 存活+就绪 | 无 |
| GET | `/bootstrap/state` | 是否已初始化 | 无 |
| POST | `/bootstrap/setup` | 首启初始化 | 无 |
| POST | `/auth/login` | 登录 | 无 |
| POST | `/auth/logout` | 登出 | 登录 |
| GET | `/auth/me` | 当前身份+当班班次 | 登录 |
| POST | `/auth/change-password` | 修改口令 | 登录 |
| POST | `/cashier/orders` | 创建订单 | 全员 |
| GET | `/cashier/orders/:orderNo/status` | 轮询状态 | 全员 |
| POST | `/cashier/orders/:orderNo/confirm-cash` | 现金入账 | 全员 |
| POST | `/cashier/orders/:orderNo/void` | 作废（未支付前关单） | 全员 |
| GET | `/orders` | 列表（筛选/分页） | 全员（范围过滤） |
| GET | `/orders/:orderNo` | 详情+事件时间线 | 同上 |
| PATCH | `/orders/:orderNo/remark` | 改备注 | 同上 |
| DELETE | `/orders/:orderNo/remark` | 删备注（需确认） | OWNER |
| GET | `/orders/export` | CSV 导出 | 全员（范围过滤） |
| POST | `/refunds` | 发起退款 | 全员 |
| POST | `/refunds/:id/approve` | 审批并执行（需口令） | OWNER |
| GET | `/refunds` | 退款列表 | 全员（范围过滤） |
| POST | `/channels/mock/confirm` | 模拟支付成功 | 仅 NODE_ENV≠production 且渠道=mock |
| GET | `/channels` | 渠道状态列表 | OWNER |
| PUT | `/channels/:code/credentials` | 保存凭据（需口令） | OWNER |
| POST | `/channels/:code/check` | 配置自检 | OWNER |
| PUT | `/channels/:code/enabled` | 启停渠道 | OWNER |
| POST | `/shifts/open` | 开班 | 全员 |
| POST | `/shifts/:id/close` | 交班 | 本人/OWNER |
| GET | `/shifts` | 班次列表 | 全员（CASHIER 仅本人） |
| GET | `/shifts/:id` | 班次汇总+订单 | 范围过滤 |
| GET | `/shifts/:id/handover` | 交接单数据（可导出） | 范围过滤 |
| POST | `/reconciliation/import` | 导入账单 | OWNER |
| GET | `/reconciliation/batches` | 批次列表 | OWNER |
| GET | `/reconciliation/diffs?batchId=` | 差异列表 | OWNER |
| POST | `/reconciliation/diffs/:id/resolve` | 处理差异 | OWNER |
| GET | `/reconciliation/export?batchId=` | 差异导出 | OWNER |
| GET | `/staff` | 员工列表 | OWNER |
| POST | `/staff` | 新增员工 | OWNER |
| PATCH | `/staff/:id` | 改名/角色/状态 | OWNER |
| POST | `/staff/:id/reset-password` | 重置口令 | OWNER |
| DELETE | `/staff/:id` | 删除（无业务数据时） | OWNER |
| GET | `/exceptions` | 异常单列表 | OWNER |
| POST | `/exceptions/:orderId/resolve` | 结案（需口令） | OWNER |
| GET | `/audit` | 审计查询 | OWNER |
| POST | `/audit/verify` | 哈希链校验 | OWNER |
| GET | `/backup/list` | 快照列表 | OWNER |
| POST | `/backup/export` | 手动导出 | OWNER |
| POST | `/backup/restore` | 恢复（需口令） | OWNER |
| GET | `/settings` | 运行参数 | 登录 |
| PUT | `/settings` | 改运行参数 | OWNER |
| POST | `/diagnostics/bundle` | 生成诊断包 | 登录 |
| GET | `/dashboard/summary` | 总览指标 | OWNER |
| POST | `/webhooks/channel/:code` | 渠道回调（可选启用） | 无（验签） |

## 8.2 关键 Schema（节选，其余按同一标准在实现时补入 `docs/api-schema.md`，由 Swagger 导出）

### POST /cashier/orders
请求
```json
{ "amountYuan": "12.80", "codeType": "WECHAT", "clientRequestId": "3f2c…uuid",
  "subject": "早餐", "remark": "堂食" }
```
| 字段 | 类型 | 必填 | 校验 |
|---|---|---|---|
| amountYuan | string | 是 | `^\d{1,7}(\.\d{1,2})?$`，转分后 1 ≤ fen ≤ 上限 |
| codeType | enum | 是 | WECHAT/ALIPAY/CASH/MOCK |
| clientRequestId | uuid string | 是 | 唯一幂等键 |
| subject | string | 否 | ≤50 |
| remark | string | 否 | ≤200，过滤控制字符 |

响应 `201`
```json
{ "code": 0, "data": { "orderNo": "SC20261013165500123456", "status": "PAYING",
  "amountFen": 1280, "codePayload": { "kind": "QRCODE_URL", "value": "weixin://…" },
  "expireAt": "2026-10-13T09:10:00Z", "pollIntervalMs": 3000 } }
```
错误：`40320` 未开班次、`40012` 金额非法、`42901` 超单笔上限、`40902` 渠道下单失败（订单已进 EXCEPTION，可重试）。
幂等：同 `clientRequestId` 返回首次结果（`200` 而非 `201`）。超时阈值：本地 800ms，含渠道调用 5s。

### GET /cashier/orders/:orderNo/status
响应 `{ "status": "PAID", "paidAt": "…", "amountFen": 1280 }`；状态枚举同 4.2。CASHIER 访问非本班订单返回 `40312`。

### POST /refunds
```json
{ "orderNo": "SC…", "amountYuan": "12.80", "reason": "顾客不要了" }
```
响应 `201 { "id": "…", "refundNo": "RF…", "status": "PENDING", "needOwnerConfirm": true }`
错误：`40013` 金额超可退、`40313` 无权限、`40903` 已存在进行中退款。

### POST /refunds/:id/approve
```json
{ "confirmPassword": "店主口令" }
```
`200 { "status": "SUCCESS", "channelRefundNo": "…" }` / `202 { "status": "PROCESSING" }`（渠道受理但未终态，后续由退款查单推进）/ `40311` 口令错误。

### POST /shifts/open ｜ /shifts/:id/close
```json
{ "floatCashYuan": "200.00" }
{ "countedCashYuan": "1230.00", "note": "少 10 元，顾客现金找零争议" }
```
close 响应含 `expectedCashFen / expectedOnlineFen / diffFen / pendingExceptionCount`。

### POST /reconciliation/import
```json
{ "billDate": "2026-10-12", "channelCode": "wechat", "source": "PASTE", "csvText": "…" }
```
响应 `{ "batchId": "…", "rowsTotal": 88, "matched": 86, "diffCount": 2 }`
错误：`40014` 表头无法识别、`40904` 该日期该渠道已导入（需带 `overwrite:true` + 口令）。

## 8.3 API 总数：47（其中资金相关 12 个）

---

# 9. 性能与并发方案

## 9.1 峰值流量估算
单店：300 笔/天，集中在午/晚 4 小时 → 平均 1.25 笔/分钟；爆峰值（节假日排队）按 30 笔/分钟 = 0.5 QPS 下单。收银页状态轮询每单 1 请求/3 秒，同时 1 单 → 0.33 QPS。界面操作（列表/详情）按店主每 10 秒一次点击 → 0.1 QPS。**合计峰值 < 2 QPS**，SQLite WAL（读并发 + 单写）可承载约 500~1000 写/秒，余量 300 倍以上。

**结论**：瓶颈不在数据库，在渠道 API 往返与打印机（V2）。任何"性能优化"提案若不能指出 >2 QPS 的真实场景，一律拒绝（防过度设计）。

## 9.2 并发承载分析
| 操作 | 同时数 | 处理 | 响应时间目标 | 结论 |
|---|---|---|---|---|
| 创建订单 | 1（单机一人收银） | 进程内串行 + 渠道调用 5s 超时 | ≤300ms（不含渠道） | 安全 |
| 状态轮询 | ≤20 条批量 | 队列批量查单，单轮 ≤10s | ≤100ms（本地读） | 安全 |
| 订单列表（10 万行） | 1~2 | 覆盖索引 + keyset 分页 | ≤300ms | 达标需 4.4 索引命中 |
| 日对账（导入 1000 行） | 1 | 分批事务（每 200 行一事务），不阻塞收银读 | ≤5s，界面显示进度 | 安全 |
| 自动快照 | 1 | `VACUUM INTO` 后台执行 | 200MB db ≤3s | 低峰期执行，失败仅记警告 |

## 9.3~9.4 缓存
本机无网络往返，缓存收益极低。**V1 不引入任何缓存层**（无 Redis、无内存 LRU），只对"渠道配置解密结果"做进程内缓存（随写操作失效）。无穿透/击穿/雪崩问题，明确不写这些机制以免堆砌。

## 9.5 异步任务配置
| 任务 | 间隔 | 批量 | 超时 | 重试 |
|---|---|---|---|---|
| 查单轮询 | 2s tick | ≤20 单/轮 | 单渠道调用 5s | 按 5.3 退避序列 |
| 超时关单 | 60s | ≤100 单 | 关单前强制查单 | 幂等（条件更新） |
| 自动快照 | 30min | — | 30s | 连续 3 次失败 → 红色告警 |
| 日志滚动 | 每日 03:00 | — | — | 保留 14 天 |

## 9.6 数据库连接
Prisma SQLite 单连接池 `connection_limit=1`（写）+ 只读走同一连接（SQLite 无独立读连接池概念，WAL 允许读并发）。必须设置 `PRAGMA busy_timeout=5000`，否则并发写直接 `SQLITE_BUSY`。

## 9.7 限流
本机回环，不做用户级限流；仅对 `/auth/login` 做 5 次失败锁 15 分钟（口令级）+ 对 `/webhooks/*` 做 30 req/min 的异常速率保护（超限 42902，防误配到公网后被刷）。

## 9.8~9.9 锁与幂等
悲观锁：进程内 `Mutex`（key 粒度 order/refund/shift）。乐观锁：**不需要 version 字段**（单进程，条件原子更新已足够；写进代码只会增加复杂度）。幂等机制清单：
| 接口 | 机制 |
|---|---|
| POST /cashier/orders | `clientRequestId` 唯一约束 |
| POST /refunds | `refundNo` + `idempotencyKey` |
| 渠道回调 | 验签后按 `(channelCode, channelOrderNo, status)` 短路 |
| 班次交班 | `status=CLOSED` 短路返回 |
| 对账导入 | `(billDate, channelCode)` 唯一 |

---

# 10. 安全设计方案

## 10.1 五层防护
| 层 | 措施 |
|---|---|
| 网络 | 后端**只绑 127.0.0.1**（写死，配置项不可改）；无公网监听端口；CSP `default-src 'self'`；不提供服务端渲染外的任何远程入口 |
| 应用 | 全局 `ValidationPipe(whitelist, forbidNonWhitelisted, transform)`；角色守卫 + 3.2 数据过滤；所有资金推进走条件原子更新；CSRF 不需（Bearer 头，非 Cookie 鉴权）；会话 token 存 `sessionStorage`（非 localStorage 长期驻留），8 小时过期 |
| 数据 | 口令 bcrypt cost=12；渠道凭据 AES-256-GCM（随机 12 字节 IV，密文格式 `enc:v2(base64(iv|ct|tag))`）；付款方标识只存渠道脱敏快照，**不采集不存储顾客个人信息**；CSV 公式注入转义；日志脱敏 |
| 密钥生命周期 | `master.key` 与库分离存放；`ChannelConfig.keyVersion` 存密钥指纹（sha256 前 12 位），启动时比对不一致即告警"凭据不可解密，请从备份恢复密钥"；备份包必须同时含密钥；**支持轮换：实现时提供"用新密钥重加密全量凭据"的一次性脚本**（源项目固定 salt + 无版本，是它踩过的坑） |
| 运维 | 诊断包白名单字段导出，禁止打包 `keys\`；便携目录安装位置提示不要放公共可读路径；软件更新前强制备份 |

## 10.2 关键实现参数
- KDF：`scrypt(masterKeyFileBytes, salt=<项目固定但每安装随机生成的盐文件>, 32)`，盐与密钥同目录 `keys\salt`；AES-256-GCM，`authTagLength=16`，解密失败抛 `DECRYPT_FAIL` 并审计。
- bcrypt：`hash(password, 12)`；登录比对失败也走一次假比对（时序一致）。
- 时间：所有 JWT-free 会话用随机 token + 服务端过期时间，无签名密钥管理负担。

## 10.3 错误码表
```
0        成功
40001    参数校验失败
40012    金额非法（格式/超两位小数）
42901    金额超单笔上限
40013    退款金额超可退
40014    账单格式无法识别
40301    未登录/会话失效
40311    二次确认口令错误
40312    数据范围越权
40313    角色权限不足
40320    未开班次
40321    强制改密未完成
40401    资源不存在
40901    已完成初始化，拒绝重复
40902    渠道下单失败（已进 EXCEPTION）
40903    存在进行中的退款
40904    账单已导入（需显式覆盖）
40905    并发状态冲突（请重试）
42801    未完成首启
42802    需修改初始口令
42902    回调速率异常
50301    回调未启用（未配 notifyUrl）
50001    内部错误（返回 traceId，不返回堆栈）
50002    数据库不可用/迁移失败
```

## 10.4 日志规范
结构化 JSON：`{ts, level, traceId, module, msg, ...字段}`。traceId 由中间件生成并透传到响应。脱敏规则：字段名命中 `password|secret|privateKey|apiV3Key|token|idCard|bankCard|payer` → 值替换为 `***`（长度>8 保留前 2 后 2）。禁止 `console.log`，统一 Nest Logger 包装。级别：`error` 仅用于需要人介入的故障；掉单补偿成功记 `warn`；轮询常规不记 `info`（防刷屏）。

## 10.5 敏感数据清单
| 数据 | 处理 |
|---|---|
| 店主/店员口令 | bcrypt，永不出库不日志 |
| 渠道私钥/APIv3Key | AES-256-GCM 密文 + master.key |
| 顾客付款信息 | 仅渠道交易号与脱敏标识；无姓名/手机号/身份证 |
| 结算账户 | **不存储**（提现由渠道侧自动完成，本项目不做结算账户设置功能——源项目 `Merchant.settleAccount` 的存储与外包代改结算是监管明令禁止的外包行为，本项目直接砍掉） |

---

# 11. 界面适配策略
V1 目标分辨率：1366×768 及以上（覆盖低端收银本）与 1920×1080。收银台在 ≥1024px 用左右分栏，<1024px 退化为上下堆叠 + 大号金额按钮（POS 竖屏 768×1366 可用）。触屏可点，键盘可全操作（不依赖鼠标）。**不支持手机/微信内打开**（V1 明确排除，避免无谓适配成本）。渲染：WebView2（Chromium）；退化路径为 Edge/Chrome `--kiosk`。

---

# 12. 开发规约与已知陷阱（动手前必读）

## 12.1 类型统一规约
- **时间**：DB 列 `DateTime`，**一律 UTC**；代码内统一 `Date` 对象，序列化统一 `toISOString()`；禁止 `new Date().toString()` 入库。商家显示用 `Asia/Shanghai`（从 `/settings` 读取，默认北京时间）转换，转换只在前端与报表层做。启动时校验系统时间与单调时钟偏差 >2 分钟 → 告警。
- **主键**：业务表 `String uuid()`；`audit_logs` 用 `Integer autoincrement`（哈希链需要严格递增序号）——两种并存是刻意选择，已在文档标注，禁止自行"统一"。
- **业务单号**：`orderNo`/`refundNo` 独立可读唯一列，UI 与外呼一律用单号，内部 id 不出 API。
- **金额**：`*Fen: Int`（分）为唯一真相；`*Yuan` **只出现在 API 出入参与界面输入**，转换只允许走 `yuanToFen()`/`fenToYuan()` 两个函数，禁止散落的 `*100`。
- **枚举**：全大写（`PAID`、`OWNER`），前后端一致，禁止小写混用。
- **空值**：DB `NULL` ↔ TS `null` ↔ JSON `null`；禁止用空字符串表示"无"。

## 12.2 框架组合兼容性验证
**W1 第一天必须跑通的最小闭环（顺序不可颠倒）**：
1. `prisma init`（sqlite）+ 迁移 + 一条读写测试通过（验证 `@prisma/adapter-better-sqlite3` 与 `migrate deploy` 在 win-x64 打包后仍能工作 —— Prisma 引擎 DLL 路径解析是本类项目最高频坑）
2. NestJS 启动 + `GET /healthz` + 一个 Jest 单测（验证 `node --experimental-vm-modules` 与 ts-jest ESM 组合）
3. Tauri sidecar 拉起 node、动态端口握手、健康检查、退出回收子进程
4. 前端构建产物由 Nest 静态服务在壳内正常渲染
任一环节失败，**先解决再继续**，不许"先写着以后再说"。
已知需警惕：Tauri `externalBin` 要求 sidecar 文件名带 target triple 后缀（`node-x86_64-pc-windows-msvc.exe`）；`shell:allow-spawn` 权限需在 capabilities 显式声明；WebView2 未安装时白屏不报错（必须前置检测）；Prisma `approval` 之类字段名会撞保留字（本项目已改名 `approval_data`）。

## 12.3 外键与操作顺序
依赖拓扑：`users → (orders, shifts, sessions, audit_logs) → order_events / refunds → recon_batches → recon_diffs`
- 种子/初始化插入顺序：`app_meta → users → channel_configs`
- 测试清理逆序：`recon_diffs → recon_batches → order_events → refunds → orders → sessions → shifts → audit_logs → users`
- 级联策略：`order_events` CASCADE（事件随订单归档消失）；`refunds→orders` RESTRICT（有退款的订单禁止物理删除）；`sessions→users` CASCADE；`shifts→users` RESTRICT；`recon_diffs→batch` CASCADE。**禁止对 orders 做物理删除**，只允许归档。

## 12.4 全局副作用清单与测试隔离
| 副作用 | 测试处理 |
|---|---|
| SQLite 文件 | 每个测试文件用独立临时目录 db（`tmp/`+uuid），`afterEach` 删文件 |
| `keys\master.key`/`salt` | 测试用固定 32 字节常量写入临时目录 |
| Scheduler 定时器 | 用 Jest fake timers，测试内显式 tick；生产代码里所有 `setInterval` 必须可注入 `enabled:false` |
| 环境变量 | `setup-env.ts` 集中设置并在 `afterAll` 恢复；**测试严禁读取宿主 `process.env.NODE_ENV` 决定分支行为**（源项目的 5 个失败用例正是这个病） |
| 文件日志 | 测试期日志级别 `silent`，或写入临时目录 |
所有 fixture 在写第一个测试之前建好。

## 12.5 本地与生产差异对照
| 维度 | 开发（macOS/Linux） | 生产（Windows） | 常见坑 |
|---|---|---|---|
| 路径分隔 | `/` | `\` | 一律用 `path.join`，禁止硬编码 `./data/app.db` |
| 数据目录 | 项目内 `tmp/` | 便携目录 `data\`（可含中文/空格） | 含空格路径必须加引号；用户目录权限差异 |
| 大小写 | 敏感 | 不敏感 | 文件名统一小写连字符 |
| 时区 | 开发者本地 | 机器可能错设 | 强制 UTC 存储 + 启动校验 |
| 换行 | LF | CRLF | 账单粘贴含 CRLF，解析前统一 `\r\n→\n` |
| Node | nvm 版本 | 内嵌 `node.exe` | 内嵌版本与开发版本必须一致（22.x） |
| Prisma 引擎 | 本地 node_modules | 打包进 `app\`，需带 `.dll` | 忘记拷贝 DLL → 装机即崩 |
| WebView2 | 有 | 老机器无 | 启动检测 + kiosk 退化 |

## 12.6 数据库注意事项
启动时执行 `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;` 三件套并断言成功。事务边界：创建订单（insert + 状态推进）、退款审批（状态推进 + 订单累计）、交班（班次计算 + 状态）**必须单事务**。`$transaction` 失败一律回滚且不自动重试资金写。迁移：单开发者场景仍要求 `migrate deploy`，禁止 `db push`。

---

# 13. 测试策略（TDD 强制）

> **铁律：没有先失败过的测试，就不算有测试。** 每个资金/状态/幂等/校验相关的实现，必须先有一个可运行且因"功能缺失"而失败（不是报错）的测试，再写最小实现使其通过；确认失败原因正确后才算 RED。禁止"先写实现再补测试"（源项目那套 749 用例里含大量 mock 断言，无法证明真并发行为，本项目不重蹈）。

## 13.1 测试基础设施（第 1 天完成）
- Jest + ts-jest（CJS 模式，避免 ESM 组合坑）；`test/setup-env.ts` 注入固定 env；每个测试独立 SQLite 临时文件。
- 一个 smoke 测试：迁移 + 插入 + 查询 + 条件原子更新，验证 Prisma/SQLite/Jest 三者组合可用。
- 测试数据工厂：`makeUser() / makeOrder(status) / makeShift()`，按 12.3 逆序清理。

## 13.2 必须存在的用例清单（按优先级，实现前逐条列出）
**状态机与金额（P0，覆盖 ≥90%）**
1. 金额不符的支付成功结果 → 订单进 `EXCEPTION(AMOUNT_MISMATCH)`，不置 PAID
2. 渠道未返回金额 → 同样进 EXCEPTION（fail-closed）
3. `CLOSED` 后查单查到成功 → 进 `EXCEPTION(LATE_SUCCESS)`，绝不自动 PAID
4. 回调与轮询并发命中同一单 → 只有一次状态推进生效（条件更新返回 0 行）
5. `PAID` 幂等：重复成功结果不重复写事件计数外的金额
6. `yuanToFen("12.805")` 抛错（两位小数上限）；`"0.00"` 拒绝；`"1e9"` 拒绝
7. 超退拦截：累计退款金额 > 订单金额时拒绝
8. 部分退款后订单仍 `PAID` 且可退余额正确；全额退款后 `REFUNDED`
9. 退款 `FAILED` → 订单进 `EXCEPTION(REFUND_FAILED)`
10. 查单退避序列按 `3s,10s,30s,120s,300s` 推进，15 分钟仍无结果 → `CLOSED`，且关单前有一次最终查单

**幂等与并发（P0）**
11. 同 `clientRequestId` 二次提交返回同一订单且不重复调用渠道
12. 同一用户重复开班 → 拒绝；重复交班 → 返回首次结果
13. 两人同时给同一订单发起退款 → 仅一个 `PENDING`

**权限（P1）**
14. CASHIER 访问非本班订单 → 40312；未开班收银 → 40320
15. 无 `confirmPassword` 或口令错误的退款审批 → 40311 且状态不变
16. `mustChangePwd=true` 时其他接口 → 42802
17. 停用员工后会话立即失效

**对账（P1）**
18. 三类差异各命中一次（本地有渠道无 / 渠道有本地无 / 金额不符）
19. 重复导入同日期同渠道 → 40904；带 overwrite+口令成功且旧差异清空
20. CRLF、GBK/UTF-8 混编、金额 `12.8`/`¥12.80`/千分位 `1,280.00` 解析正确

**备份恢复与韧性（P1）**
21. 恢复备份后渠道凭据可解密（keyVersion 一致路径）
22. keyVersion 不一致 → 明确报错而非静默失败
23. 进程在 `PAYING` 状态被强杀 → 重启后自动恢复扫描并最终收敛到正确终态（用 mock 渠道驱动）
24. 磁盘剩余 < 200MB → 禁止新建订单并返回可识别错误码

**壳与打包（P2，Playwright）**
25. 便携目录在含空格/中文路径下可启动、可收银、可导出
26. WebView2 缺失路径 → 退化浏览器 kiosk 可收银

## 13.3 后端 / 13.4 前端验收
后端覆盖 13.2 全部；前端验收：收银台键盘全流程 3 笔不碰鼠标；异常工作台有"下一步做什么"的文案；所有异步态有加载/失败/空状态（禁裸 0 条空白页）。

## 13.5 压力测试
基准脚本：造 10 万订单 + 50 万事件，跑列表分页/详情/导出/对账匹配，断言 P95 ≤300ms、`EXPLAIN QUERY PLAN` 无全表 SCAN。工具：自写 Node 脚本 + `better-sqlite3` 计时。

---

# 14. 构建与分发

## 14.1 仓库结构
单仓 monorepo（`apps/sidecar`、`apps/web`、`apps/shell`、`packages/shared`）。

## 14.2 构建流程（无 Docker，Windows CI 主机或本地构建）
```powershell
npm ci --include=dev
npx prisma generate && npx prisma migrate deploy --schema=apps/sidecar/prisma/schema.prisma  # 校验迁移
npm run test           # 全绿才允许打包（CI 固定 NODE_ENV=test，禁止依赖宿主变量）
npm run build:web      # → apps/web/dist
npm run build:sidecar  # nest build → dist + 拷贝 prisma/migrations + query engine dll
npm run build:shell    # tauri build（含 sidecar 注入）
npm run package:portable  # 组装 ShopCash-portable 目录 → tar.zip
```
产物目录：
```
ShopCash\
 ├─ ShopCash.exe
 ├─ runtime\node.exe (v22 LTS win-x64)
 ├─ app\ (main.js + node_modules + prisma\)
 ├─ web\ (前端静态)
 ├─ data\  keys\  backups\  logs\   （首启创建）
 ├─ VERSION.txt   （git sha + 版本号 + 构建日期）
 └─ 使用说明.txt
```

## 14.3 分发与更新
便携 zip 通过网盘/U 盘交付（约 200MB，微信传输受限属预期）。更新 = ①软件内"导出全量备份" ②关闭程序 ③解压新目录 ④把 `data\ keys\` 拷入新目录 ⑤启动，程序自动 `migrate deploy`。**更新前若无当日备份，程序弹强提示并可一键中止。** 不写注册表、不请求管理员；开机自启仅在用户勾选时由 `tauri-plugin-autostart` 写入用户 Startup（非注册表 HKLM）。

## 14.4 本地开发命令
`npm run dev`（并行起 web 的 Vite + sidecar 的 nest，浏览器访问，不依赖 Tauri）；`npm run dev:shell`（Tauri 调试）。

## 14.5 环境差异
`dev`（mock 渠道，`/channels/mock/confirm` 可用，日志 pretty）/ `prod`（便携包，mock 确认接口按"渠道=mock"而非 NODE_ENV 判定可用性 —— 与源项目 env 泄漏坑区分开）。

---

# 15. 架构韧性设计

## 15.1 单点故障
| 组件 | 是否单点 | 影响 | V1 缓解 |
|---|---|---|---|
| 这台电脑 | 是 | 全部 | 备份 + 换机恢复流程（≤30min） |
| SQLite 文件 | 是 | 全部数据 | 30min 快照 + 手动导出到 U 盘/网盘 |
| sidecar 进程 | 是 | 收银中断 | 壳看门狗重启 ≤3 次；失败托盘红标 |
| 渠道 API | 是 | 线上收款中断 | 现金收款仍可用；界面黄色横幅"渠道暂不可用，可用现金收款" |
| master.key | 是 | 凭据不可解密 | 与备份同存；丢失可重新录入凭据（引导流程） |

## 15.2 故障影响矩阵
| 故障 | 收银(现金) | 收银(线上) | 查询 | 对账 | 退款 |
|---|---|---|---|---|---|
| 断网 | ✅ | ❌（提示） | ✅ | ❌（导入失败可稍后） | ❌（排队重试） |
| 渠道 API 5xx | ✅ | ❌ | ✅ | 差异暴露 | ❌ 排队 |
| DB 只读（磁盘满） | ❌ 禁止写入并告警 | ❌ | ✅ | ❌ | ❌ |
| 进程崩溃 | ❌ 秒级 | ❌ | ❌ | ❌ | ❌（重启后自动收敛） |

## 15.3 RTO/RPO
RTO ≈30 分钟（换机 + 恢复备份）；RPO ≤30 分钟（自动快照间隔），手动导出可做到 0。

## 15.4 熔断
对渠道调用做轻量熔断：连续 5 次失败 → 打开 60 秒（期间下单直接返回 40902 并提示改用现金），半开探测 1 次成功即关闭。参数进 `/settings` 可调。

## 15.5 自动恢复
进程重启后必做"恢复扫描"：`status IN (PENDING,PAYING)` → 重新排入查单队列；`EXCEPTION` 不自动处理；快照/日志任务重建。SQLite `integrity_check` 失败 → 进入只读维护模式，界面提示"数据文件异常，请从备份恢复"，禁止一切写入。

## 15.6 降级层级
L0 全功能 → L1 渠道不可用（禁线上收款，现金+记账可用）→ L2 DB 只读（可查可导，禁写）→ L3 后端不可用（壳显示故障页 + "打开诊断" + 应急手记纸质模板下载）→ L4 整机不可用（引导走线下纸质记账，恢复后补录）。

## 15.7 超时分级
本地读 200ms / 本地写 500ms / 渠道调用 5s / 账单解析 15s / 备份 30s。超时即给可操作提示，不允许无限 loading。

## 15.8 默认值清单
订单有效期 15min；查单序列见 5.3；快照 30min 保留 7 天；单笔上限 50 万元；熔断阈值 5 次/60s；时区 Asia/Shanghai。任一外部数据取不到时使用上述默认值并在 `/settings` 显示"当前为默认值"。

---

# 16. 跨系统状态一致性（资金核心）

状态机见设计定稿第 4 节与 5.3。**三层保障 = 回调（可选）+ 主动查单轮询 + 每日对账**；不一致处理 = `EXCEPTION` 人工队列 + 对账差异队列，两条队列都必须有"未处理数量"常驻显示与超 24 小时提醒。任何自动补偿动作都不得跳过金额强校验与"迟到成功只进人工"的规则。

退款一致性：`PROCESSING` 状态由退款查单任务推进；渠道未受理成功不得累加订单已退金额。

---

# 17. 第三方服务风险管理

| 服务 | 配额/限制 | 费用 | 冷启动风险 | V1 应对 |
|---|---|---|---|---|
| 微信支付（直连商户） | Native 下单/查单/退款有频率限制；新商户号有限额与风控观察期 | 渠道向商家收手续费，常见 0.38%~0.6%（按行业） | **新开通商户号首周交易受限、单笔/单日限额低**；`2026-04-10` 起入驻流程按反洗钱要求调整（企业主体需补 UBO） | 一期不启用；W7 接真号时先小额自测 3 天；文档写明"首日只测 0.01 元" |
| 支付宝（开放平台） | 接口有 QPS 限制，签约产品需审核 | 同上量级 | 应用需上线审核，密钥证书需配置 | 同上 |
| 微信/支付宝账单 | 账单 T+1 生成，需人工从商户平台下载 | 免费 | 格式随渠道调整（历史上有版本变更） | 解析器按表头识别 + 无法识别时报 40014 并保留原文供诊断 |
| WebView2 Runtime | 系统组件 | 免费 | 老 POS 机/精简系统缺失 | 启动检测 + bootstrapper + kiosk 退化 |
| 大模型 API | — | — | — | **V1 禁止引入** |

**合规红线（写进代码注释与 README）**：本软件是门店自用收银记账工具，不持有、不归集、不转发任何资金；不提供结算账户设置/修改、不为任何第三方完成资金清算。若未来要做"多商家集中收款再分配"，必须先取得微信/支付宝**服务商资质**，走特约商户进件（`sub_mchid`）与官方分账能力（下单带 `profit_sharing=true`，需商户授权分账比例），否则即构成央行定义的"二清"，涉嫌《刑法》225 条非法经营罪（非法经营数额 500 万元以上或违法所得 10 万元以上即达入罪标准）。

---

# 18. 事故响应流程（面向"你 + 商家"）

| 级别 | 定义 | 响应 |
|---|---|---|
| P0 | 数据损坏/丢失、钱收了没记录、无法退款 | 立即指导商家**停止写入**（用备份恢复页的只读模式）→ 2 小时内给恢复步骤 |
| P1 | 线上收款不可用（渠道正常） | 当天修复，先用现金/另一渠道顶上 |
| P2 | 对账/导出异常、单个功能不可用 | 3 个工作日 |
| P3 | 体验问题 | 版本迭代 |

升级路径：商家 → 你（技术）→ 需要时找渠道客服（95017 / 支付宝商家服务）。
人工应急：纸质/Excel 记账模板（随包附带 `使用说明.txt` 附录）+ 恢复后补录为 `CASH` 订单并备注，全部留审计。
用户沟通：软件内公告条（`AppMeta.notice`，用于你远程告知商家升级/故障原因）。

---

# 19. 开发里程碑

| 周 | 交付物 | 验收标准 |
|---|---|---|
| W1 | 仓库骨架 + 内核 + 首启向导 + 登录/角色（**部分完成**：迁移与 Tauri 需 Windows 实测） | 34 单测绿、覆盖率 100%、tsc 0 错误 |
| W2 | 收银主流程 + mock 渠道 + 状态机 + 收款码页（**已完成**） | 界面 18 步实跑 0 控制台报错；规则 1/2/3 端到端绿 |
| W3 | 三层兜底 + 超时关单 + 异常工作台（**已完成**，回调层随 W7 补） | `npm run test:api` 15 项断言全绿 |
| W4 | 班次与交接班 + 审计哈希链（**部分完成**：哈希链真实落库随 W1 迁移补） | 备用金/实点/差额可复算，界面已实拍 |
| W5 | 退款全流程 + 日对账（**未开始**） | 依赖真实渠道，与 W7 同期 |
| W6 | 备份/恢复 + 诊断包 + 便携打包 + 自启 + 归档（**未开始**） | 需 Windows 环境验证 Prisma DLL 与路径 |
| W7 | 微信/支付宝真实渠道 + 契约测试（**未开始**，等商户号开通） | 契约测试对 mock 全绿；真号小额自测 3 天 |
| W8 | 2~3 家试点 + 商家手册 + 修正（**未开始**） | 试点连续 7 天无 P0/P1 |

推荐开发模式：**单 Agent 顺序推进**（W1–W6），W7 起可由你并行做资质与硬件适配。

## 19.1 实现进度对照（2026-10-14）

| 自检命令 | 内容 | 当前结果 |
|---|---|---|
| `npm run lint` | `tsc --noEmit` | 0 错误 |
| `npm test` / `test:cov` | 内核单测（金额 + 状态机 + 包入口） | 34 通过，覆盖率 100% |
| `npm run test:api` | 15 项资金/权限硬规则端到端断言 | 全部通过 |
| `npm run test:ui` | 18 步界面实跑 + 逐页截图 + 控制台错误采集 | 18 张截图、0 报错 |
| `npm run build` | 前端产物构建 | 通过 |

与本文档的偏差（已知，需在下轮补齐）：

1. `order_events`、`audit_logs`、`recon_*` 目前只在开发接口桩里存在，真实 Prisma 迁移与建表属 W1 剩余项
2. 分布式锁改进程内 Mutex 的落地在真实后端（`apps/sidecar`）里完成，开发桩以单进程串行等价
3. 备份恢复、诊断包属 W6，尚未实现
4. 渠道凭据加密在开发桩里只标记状态，真实 AES-256-GCM 落库随 W1 一起交付

---

# 20. 环境变量与配置

`.env`（sidecar 读取，由壳生成，不入代码库）：
```ini
NODE_ENV=production
SHOPCASH_DATA_DIR=D:\ShopCash\data          # 由壳注入
SHOPCASH_KEY_DIR=D:\ShopCash\keys           # 由壳注入
SHOPCASH_PORT=0                             # 0=由壳探测空闲端口后传入实际端口
SHOPCASH_TIMEZONE=Asia/Shanghai
ORDER_EXPIRE_MINUTES=15
SINGLE_ORDER_MAX_FEN=50000000
SNAPSHOT_INTERVAL_MIN=30
QUERY_BACKOFF_MS=3000,10000,30000,120000,300000
CB_FAILURE_THRESHOLD=5
CB_OPEN_SECONDS=60
LOG_RETAIN_DAYS=14
```
运行期可调（`/settings`，无需重启）：单笔上限、订单有效期、查单退避、快照间隔、声音开关、时区、熔断阈值。
特性开关：`FF_CHANNEL_WECHAT`、`FF_CHANNEL_ALIPAY`（默认 false，W7 完成且自检通过才开）、`FF_CALLBACK`。

---

# 21. 项目目录结构（到文件级）

```
shopcash/
├─ apps/
│  ├─ sidecar/
│  │  ├─ src/
│  │  │  ├─ main.ts                      # 启动、PRAGMA、优雅停机
│  │  │  ├─ app.module.ts
│  │  │  ├─ common/                       # yuanToFen/条件更新工具/Mutex/错误码/日志脱敏
│  │  │  ├─ bootstrap/  auth/  cashier/  orders/  refunds/
│  │  │  ├─ shifts/  reconciliation/  staff/  exceptions/
│  │  │  ├─ audit/  backup/  diagnostics/  settings/
│  │  │  └─ channels/
│  │  │     ├─ channel.interface.ts       # createOrder/queryOrder/refund/queryRefund/parseBill/verifyCallback
│  │  │     ├─ channel.registry.ts        # 按 code 路由 + 熔断 + 启用位
│  │  │     ├─ mock.channel.ts  wechat.channel.ts  alipay.channel.ts  cash.channel.ts
│  │  │     └─ channel.contract.spec.ts   # 四实现共用契约测试
│  │  ├─ prisma/{schema.prisma,migrations/}
│  │  └─ test/  (setup-env.ts, factories.ts, *.spec.ts)
│  ├─ web/    (Vite + Vue：views/, components/, router/, stores/, api/)
│  └─ shell/  (Tauri：src-tauri/{tauri.conf.json,src/main.rs,capabilities/,binaries/})
├─ packages/shared/  (DTO 类型、状态机定义、错误码常量，前后端共用)
├─ scripts/{package-portable.ps1,version-check.mjs,rotate-master-key.ts}
├─ docs/{店收宝-PRD-v1.md,api-schema.md,商家手册.md}
├─ CLAUDE.md
├─ .env.example
└─ package.json
```

---

# 22. 第三方依赖清单（锁定版本）

`apps/sidecar/package.json`（节选，W1 校验后回填精确补丁号）
```json
{
  "@nestjs/common": "11.0.11", "@nestjs/core": "11.0.11",
  "@nestjs/config": "4.0.2", "@nestjs/schedule": "5.0.1",
  "@prisma/client": "6.5.0", "prisma": "6.5.0", "@prisma/adapter-better-sqlite3": "6.5.0",
  "better-sqlite3": "11.9.1",
  "bcrypt": "5.1.1", "class-validator": "0.14.1", "class-transformer": "0.5.1",
  "wechatpay-node-v3": "2.2.1", "alipay-sdk": "4.14.0",
  "helmet": "8.1.0", "reflect-metadata": "0.2.2", "rxjs": "7.8.2"
}
devDependencies: { "typescript": "5.9.2", "jest": "30.0.0", "ts-jest": "29.3.4", "@types/node": "22.x", "@types/bcrypt": "5.0.2", "@types/better-sqlite3": "7.6.12" }
```
`apps/web`：`vue 3.5.13`、`vite 6.3.5`、`pinia 2.3.0`、`@vitejs/plugin-vue 5.2.4`。
`apps/shell`：`@tauri-apps/api 2.x`、`@tauri-apps/plugin-shell 2.x`、`tauri-cli 2.x`。
明确禁止引入：Redis/ioredis、Postgres/pg、@nestjs/swagger 之外的额外 UI 库、任何大模型 SDK。
**EOL 关注**：Node 22 LTS 安全维护至 2027-04；bcrypt（原生模块）需随 Node 升级重编译 —— 若原生模块成为装机痛点，备选 `@node-rs/argon2`（决策记入本文档，不许悄悄换）。

---

# 23. 运维手册（面向商家 + 你）

日常：软件里"备份"页导出到 U 盘（建议每天打烊后一次）。查日志：`logs\app-YYYY-MM-DD.log`（或诊断包）。重启：托盘退出→双击 `ShopCash.exe`。
故障排查表：
| 现象 | 首查 | 处置 |
|---|---|---|
| 双击没窗口 | `logs` 是否有 sidecar 启动记录 | 看门狗 3 次未起 → 导出诊断包 |
| 界面白屏 | WebView2 是否存在 | 走 bootstrapper；仍失败→自动 kiosk 模式 |
| 收款码不出 | 渠道自检按钮 | 凭据/证书问题或渠道熔断，先用现金 |
| 顾客付了没变绿 | 异常工作台 | ≤15min 自动纠正；超时按"迟到成功"人工结案 |
| 提示数据文件异常 | 磁盘空间 / `integrity_check` | 清磁盘或从最近备份恢复 |
数据恢复：备份 zip → 恢复向导 → `integrity_check` → 完成，全程 ≤30 分钟。
版本维护：`VERSION.txt` 记录 sha；性能基线（列表 P95、创建订单 P95）在 W6 测一次并写入本文档附录，后续版本对比防退化。

---

# 24. 成本估算

| 项 | 一次性 | 月度 |
|---|---|---|
| 开发（自研/AI 辅助） | — | — |
| 服务器/域名 | 0 | 0（单机版无云依赖） |
| 代码签名证书（可选，规避 SmartScreen） | 0（不签，靠"更多信息→仍要运行"引导） | 若签：约 ¥500–3000/年 |
| 商家侧渠道手续费 | — | 渠道向商家收，与软件无关 |
| 商家侧硬件 | 已有电脑 0 | 0 |
**V1 总投入 ≈ 0 元现金支出**，成本全在你的开发时间。

---

# 25. 并发承载分析表（汇总）
见 9.1/9.2。一句话结论：真实峰值 <2 QPS，SQLite WAL + 单写进程模型余量 >300 倍；**性能不是本项目的设计约束，正确性与断电恢复才是**。

---

# 26. CLAUDE.md
见随本 PRD 一同交付的 `CLAUDE.md` 文件（内容一致，不重复粘贴）。

---

# 27. 上线检查清单

发布前（打第一个真实商家）：
- [ ] `npm test` 在 `NODE_ENV=test` 固定环境下全绿（禁止依赖宿主变量）
- [ ] 13.2 中 P0 用例逐条存在且可指出"删掉哪段实现它就失败"
- [ ] 便携包在含空格/中文路径的干净 Win10 虚拟机装通并完整收银（现金 + mock）
- [ ] 无默认口令：禁用字典含 `ChangeAdmin2026`、`Admin@2026`；首启强制设定口令
- [ ] 只监听 127.0.0.1（用 `netstat` 验证）
- [ ] 备份→换目录恢复→凭据可解密，全流程演练通过
- [ ] 断网/杀进程/磁盘满 三个演练通过
- [ ] `prisma migrate deploy` 在两个连续版本间演练通过
- [ ] VERSION.txt 与 CHANGELOG 一致
- [ ] 使用说明含 SmartScreen 绕过图示

灰度：先自装（自测收 0.01 元 × 3 天）→ 1 家试点 → 3 家。
快速回滚触发条件：任一试点出现 P0（钱/账不一致）→ 立即撤回该版本并要求恢复上一便携包 + 当日备份。
Smoke Test（每次装机后必跑）：现金收款 1 笔、mock 线上 1 笔、退款 1 笔、导出 CSV、生成诊断包。

---

# 28. 附录

## 28.1 种子数据
初始化仅写入：`app_meta`、OWNER 账号（用户设定）、三条 `channel_configs`（mock enabled，其余 disabled）。**不写任何演示订单**（避免商家把测试数据当真实账）。

## 28.2 UI 默认方案
主色 `#0FA968`（取自源项目，绿=到账语义清晰）；金额展示 24px 加粗等宽数字；危险操作红色 + 二次确认；状态色：PENDING 灰 / PAYING 蓝 / PAID 绿 / CLOSED 深灰 / REFUNDED 青 / EXCEPTION 红。

## 28.3 告警规则
异常单超 24h、对账差异 >0、快照连续 3 次失败、磁盘 <200MB、时钟偏差 >2min、渠道熔断打开 —— 全部在总览页常驻横幅 + 声音（可在设置关）。

## 28.4 V2 规划（P2，V1 不碰）
商品库与扫码枪、小票打印（ESC/POS）、多门店集中管理、对外开放 API（HMAC，代码骨架 V1 预留）、AI 查账助手、**服务商模式：特约商户进件 + 子商户下单（`subMchid`）+ 官方分账抽佣**、安卓收银机适配。

## 28.5 合规声明（必须原文放进 README 与商家手册）
本软件为门店自用收银与记账工具，不持有、不归集、不转发任何资金，不为任何第三方完成资金结算。软件运营方不得代收代付商户结算资金、不得代商户设置或修改结算账户——依据央行《关于进一步加强无证经营支付业务整治工作的通知》，此类"大商户模式留存商户结算资金并自行清算"属"二清"，涉嫌无证从事支付结算业务。若需开展多商家集中收款，应先行取得微信/支付宝服务商资质并通过特约商户进件与官方分账能力完成资金处理；开展收单外包服务（含聚合支付技术服务）前，须按中国支付清算协会要求完成备案（"先备案后展业"）。

## 28.6 交接要点
密钥文件位置与丢失后果、`master.key` 轮换脚本用法、渠道契约测试运行方式、备份存放约定、性能基线数字。

## 28.7 数据合规说明
V1 不采集任何顾客个人信息（仅渠道交易号与脱敏标识），因此不触发《个人信息保护法》下的敏感个人信息处理义务；商家员工数据仅存用户名/昵称/bcrypt 哈希，属最小必要。数据全部本地留存，软件不联网上报任何业务数据。

## 28.8 参考文献
《非银行支付机构监督管理条例》（国务院令 768 号）；《非银行支付机构监督管理条例实施细则》（人行令〔2024〕4 号）；《关于进一步加强无证经营支付业务整治工作的通知》；《银行卡收单业务管理办法》；银发〔2021〕259 号；中国支付清算协会《收单外包服务机构备案管理规范》《收单外包服务评价管理规范》（2025）；微信支付《特约商户进件》《服务商分账》《平台收付通》官方文档；两高《关于办理非法从事资金支付结算业务、非法买卖外汇刑事案件适用法律若干问题的解释》。

## 28.9 变更记录
| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-13 | 首版，用户批准全部设计决策 |
| v1.1 | 2026-10-14 | 里程碑表补状态；新增 19.1 进度对照与已知偏差；开发接口补服务端金额正整数校验、角色与数据范围闸门、`/__test/reset`；界面截图入库；README 重写 |

## 28.10 性能基线（W6 回填）
待实测：创建订单 P50/P95、订单列表 P95（10 万行）、对账 1000 行 P95、备份耗时。

---

内容由 AI 生成
