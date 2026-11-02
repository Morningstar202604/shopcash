# 店收宝 ShopCash

**门店收银与记账项目（开发与实验阶段）**。界面使用内存 mock API；另有独立的 Node.js + SQLite 实验后端，尚未确认与前端联调，均不可用于生产或真实收款。

目标是商户直接使用自己的支付渠道，软件不持有、不归集、不转发资金；真实微信/支付宝支付与 Windows便携包尚未接入或交付。

`TypeScript` · `Vue3.5` · `Node.js` · `SQLite（实验后端）`

[![CI](https://github.com/badhope/shopcash/actions/workflows/ci.yml/badge.svg)](https://github.com/badhope/shopcash/actions/workflows/ci.yml)
> 中文 · [English below](#english-overview)

<p align="center">
  <img src="docs/screenshots/05-cashier-qrcode-waiting.png" width="860" alt="收银台：等待顾客付款，系统按 3s/10s/30s/2min/5min 主动查单">
</p>

## 为什么是"单机版"

本项目源自对开源仓库 KeBaiPay（原址 `gitcode.com/badhope/KeBaiPay`，2026-10-31 核查该地址已 404，溯源以本文档与 PRD 1.1 为准）的安全与合规审查。那次审查发现一个结构性问题：
它宣称"资金绝不过平台"，但数据模型是**平台级单一商户号 + 无子商户进件 + 无结算实现路径**——真拿去给多个商家收款，
正好落在央行定义的"二清"上（以平台对接或"大商户"模式接入持证机构，留存商户结算资金并自行开展商户资金清算）。

店收宝把这条线彻底划清：**一家店、一个商户号、一份本地账本**。软件只做订单信息流和记账，资金链路由商家与持牌渠道直接完成。

## 界面实拍

以下为仓库中已有的开发期截图，不代表当前版本已经验证或具备真实收款能力。截图展示：首启向导空态与弱口令拦截、小键盘录入、收款码等待、到账翻转、金额不符、0 元拒绝、订单簿与状态时间线、异常结案二次确认、班次交接、总览、渠道自检、店员权限边界。

| 首启向导（弱口令被拦） | 收银台·金额录入 | 等待顾客付款 | 订单簿 |
|---|---|---|---|
| ![首启](docs/screenshots/00b-setup-weak-rejected.png) | ![收银台](docs/screenshots/04-cashier-amount.png) | ![等待付款](docs/screenshots/05-cashier-qrcode-waiting.png) | ![订单](docs/screenshots/09-orders.png) |

| 待人工处理（作废需二次确认） | 班次交接 | 总览 | 渠道配置 |
|---|---|---|---|
| ![待处理](docs/screenshots/11b-exceptions-confirm-step2.png) | ![交接](docs/screenshots/12-shift-close.png) | ![总览](docs/screenshots/13-dashboard.png) | ![渠道](docs/screenshots/14-channels.png) |

## 功能现状

**开发期界面与内存 mock 的功能（不代表生产能力）**

- 首启向导：初始化时使用 `checkPassword()` 统一校验长度 / 大小写 / 数字 / 非用户名 / 弱口令表（`ChangeAdmin2026`、`Admin@2026` 等 10 条，含子串变体）
- 收银台：小键盘录入、`F2` 微信 / `F3` 支付宝 / `F4` 现金、到账状态实时翻转与提示音、待付款时禁止重复下单、可停止查单
- 订单状态机 `PENDING → PAYING → PAID → REFUNDING → REFUNDED`，另有 `CLOSED` 与 `EXCEPTION`
- 主动查单退避：3s/10s/30s/2min/5min，之后每 5min 一次，到 `orderExpireMinutes`（默认 15 分钟）关单
- 订单簿与状态时间线（UTC 存储、按 +08:00 展示）、CSV 导出（UTF-8 BOM、引号转义、公式前缀防护）
- 班次与交接班：备用金、本班应收现金/线上（实时计算）、实点现金、差额与交接说明；登出重登自动恢复当班班次
- 员工分账号与权限分级（店主 / 店员），订单、总览、异常、渠道的数据范围过滤全在服务端
- 待人工处理工作台：金额不符、迟到成功等异常必须店主输入口令二次确认后才可补录 / 作废
- 渠道配置中心：mock / 微信 / 支付宝三套凭据表单 + 配置自检 + 店主口令二次确认 + 只回显掩码
- 提供开发期 mock 接口与界面自检脚本；测试范围和当前结果见下文

**独立实验后端**：`server/` 使用 Node.js 内置 HTTP 与 `node:sqlite`，包含 SQLite 持久化、会话、门店、订单、班次、退款申请、审批入口及审计链等实验接口；退款申请创建、审批和结算不可用；已有退款记录不会被清理，真实支付渠道未接入。它不是 NestJS/Prisma 实现，也未确认与前端联调。

**未交付生产能力**：NestJS sidecar、Prisma迁移、Tauri 壳、真实渠道、真实退款结算、备份恢复、诊断信息包及每日对账。mock 数据保存在内存中，重启后重置。

**尚未实现（V2 路线）**：商品库与扫码枪、小票打印、生产级多门店集中管理、生产级对外开放 API、AI 查账助手、服务商进件与分账。

## 三条不能绕过的资金硬规则

写在 `packages/shared/src/order-state.ts`，前两条由纯函数表达；第三条是持久化层的设计要求，前后端与 mock 复用同一份实现：

1. **金额强校验**：渠道实付金额必须与订单金额完全相等才允许置 `PAID`；不等或渠道未返回金额 → `EXCEPTION(AMOUNT_MISMATCH)`
2. **迟到的成功只进人工**：已 `CLOSED` 的订单事后查到支付成功 → `EXCEPTION(LATE_SUCCESS)`，绝不自动入账
3. **条件原子更新（设计要求）**：状态推进应使用带原状态条件的更新，并处理并发冲突；现有实验实现不应视为已全面验证此要求

金额口径同样锁死：全链路以「分」为整数存储，元只在出入参与界面出现；超过两位小数**直接拒绝**，不做四舍五入。

## 快速开始

```bash
npm ci            # prepare 钩子会自动编译 packages/shared 产出 ESM，无需手动 build
npm run verify # lint、模板绑定、单测、隔离及安全回归、前端构建
npm run dev       # 本机界面 + 开发期 mock API：http://127.0.0.1:5199
```

### 独立实验后端（仅本地开发）

在仓库根目录先执行 `npm ci`，其 `prepare` 会编译 `@shopcash/shared`。实验后端使用 `node:sqlite`，需要支持该内置模块的 Node.js版本（Node22.5.0及以上）；部分 Node版本可能发出实验性提示。确保默认端口5400 未被占用，数据库目录可写，然后执行：

```bash
node server/index.mjs
```

默认监听 `127.0.0.1:5400`，SQLite 文件为相对于当前工作目录的 `data/shopcash.db`，启动时自动建表。可用环境变量 `HOST`、`PORT`、`DB_FILE` 覆盖；不要把服务暴露到公网，不要存放真实凭据或生产数据。默认不导入演示数据；设置 `SEED_DEMO=1` 时仅在数据库尚无机构时导入演示账号。未启用种子时需通过初始化接口创建机构与店主。

该服务仅提供 API，不托管界面；`npm run dev`仍使用 Vite 内存 mock，而非此后端。实验后端没有完成真实支付或退款结算，渠道凭据只记录掩码、不保存实际凭据；审计链和其他实验功能不等于生产安全保障。`.env.example` 中的 `SHOPCASH_*`变量不是此入口使用的配置。

自检命令（改资金逻辑必须以下全绿才算完成）：

```bash
npm run test:cov      # 内核单测 + 覆盖率门槛 90%
npm run test:api      # 24 项资金/权限/会话硬规则端到端检查
npm run test:ui       # 20 步界面实跑 + 逐页截图 + 控制台错误采集
npm run lint          # tsc --noEmit（覆盖 packages/**/*.ts）
npm run check:vue     # .vue 模板绑定自检（tsc 不覆盖 .vue，漏 import 会静默空态）
```

`verify` 不包含 `test:api`、`test:ui`、`test:cov` 或 `server/*.test.mjs`；后端测试可单独运行 `node --test server/*.test.mjs`，它们覆盖部分路由与 HTTP 流程，不证明生产安全或前后端联调。API/UI 自检各自启动并关闭随机端口上的独立内存 mock 服务，不使用既有5199 服务；设置 `BASE` 或内部目标变量会被入口拒绝，不能指定既有服务。请使用上述 npm入口，勿直接运行测试脚本。`npm run test:ui:build`先构建再使用隔离预览服务；截图可用 `SHOTS_DIR` 指定目录。`npm run test:isolation` 检查隔离目标守卫。

普通 mock 启动不启用重置接口，返回404；隔离测试进程设置 `SHOPCASH_ISOLATION_TOKEN` 时才开放，`?setup=0` 清空 mock 数据并恢复未初始化状态。该开关是进程环境变量，不是请求鉴权，不应视为安全边界。实验 SQLite 后端没有重置接口。

演示口令（开发期 mock 服务；实验后端仅在显式启用演示种子时使用）：店主 `owner / Shop2026test`，店员 `staff / Staff2026test`。

## 目录结构

```
packages/shared/   金额换算 + 订单状态机 + 口令策略 + 时间格式化 + CSV + 查单退避（唯一真相源，编译出 ESM 给前端与 mock 复用）
server/            独立实验 HTTP + SQLite 后端，非生产、未确认前后端联调
web/               Vue 3 收银界面
tools/             mock-server.js —— 仅开发期使用的接口桩
scripts/           ui-check.mjs（界面实跑）、api-rules-check.mjs（规则端到端）、vue-bindings-check.mjs（模板绑定）、push-remotes.sh
docs/              店收宝-PRD-v1.md、设计定稿、api-schema.md（当前开发桩接口）、screenshots/
```

## 架构要点

- **当前可运行形态**：Vite 开发服务器把 `tools/mock-server.js` 挂成 `/api` 中间件，界面与接口同源，数据在内存
- **独立实验后端**：Node.js HTTP + `node:sqlite`，不由 Vite代理，不能据此认定已与界面联调
- **生产目标形态（未实现）**：Tauri(Rust) 壳 → NestJS sidecar（仅听 127.0.0.1）→ Prisma + SQLite(WAL)
- **默认监听**：开发界面和实验后端默认绑定 `127.0.0.1`；实验后端的 `HOST` 可覆盖，勿暴露到公网
- **目标并发控制设计（非完整实现承诺）**：进程内 Mutex（订单号粒度）→ SQLite 事务 → 条件原子更新 → 唯一约束幂等
- **金额口径**：全链路整数分；元↔分只走 `yuanToFen()` / `fenToYuan()`，超出两位小数直接拒绝
- **凭据处理**：界面只回显掩码；真实 AES-256-GCM 落库随真实后端交付

## English Overview

ShopCash is an experimental POS and ledger project, not production-ready and not connected to real payment providers. The Vue development UI uses an in-memory mock API. A separate Node.js HTTP + SQLite experimental backend exists; frontend integration has not been established. A Windows/Tauri package, real payment and refund settlement remain future work.

## 开发与交付约束

所有开发规范见 [`docs/店收宝-PRD-v1.md`](docs/店收宝-PRD-v1.md)（唯一真相源），AI 编程工具的红线见 [`CLAUDE.md`](CLAUDE.md)。

## 合规声明

本软件为门店自用收银与记账工具，不持有、不归集、不转发任何资金，不为任何第三方完成资金结算，不提供余额 / 充值 /
提现 / 转账 / 分账功能，也不代商户设置或修改结算账户。若需开展多商家集中收款，应先行取得微信 / 支付宝**服务商资质**，
通过特约商户进件（`sub_mchid`）与官方分账能力处理资金；开展收单外包服务（含聚合支付技术服务）前须按中国支付清算协会
要求完成备案（"先备案后展业"）。详见 PRD 第 17 章与第 28.5 章。

## 许可

MIT

---

内容由 AI 生成
