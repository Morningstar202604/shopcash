# 店收宝 ShopCash — 单机门店收银软件

单店、单台 Windows 电脑、绿色便携包。钱只进商家自己的微信/支付宝直连商户号，本软件**零资金介入**。

## 当前进度（2026-10-14）

W1 部分完成（内核 + 界面 + 首启/角色/状态机；真实 Prisma 迁移与 Tauri 壳待 Windows 实测）、W2/W3 完成、W4 部分完成、W5–W8 未开始。已知偏差清单见 PRD 19.1。

## 唯一真相源

**所有开发规范见 `docs/店收宝-PRD-v1.md`**（数据模型 4 章、权限 3 章、状态机与三层兜底 5.3/16 章、API 8 章、测试用例清单 13.2、陷阱 12 章、上线清单 27 章）。与本文件冲突时以 PRD 为准。

## 技术栈

Tauri 2（Rust 壳）+ Node 22 LTS sidecar + NestJS 11 + Prisma 6 / **SQLite(WAL)** + Vue 3.5 / Vite 6 + Jest 30。**无 Redis、无 Docker、无 Postgres、无大模型依赖。**

## 关键命令

```bash
npm ci                 # prepare 钩子自动编译 packages/shared，勿手动先 build
npm run dev            # 本机界面 + 开发期 mock API（127.0.0.1:5199）
npm run lint           # tsc --noEmit
npm test               # 内核单测（Jest，CI 固定 NODE_ENV=test）
npm run test:cov       # 覆盖率门槛 90%
npm run test:api       # 15 项资金/权限硬规则端到端断言
npm run test:ui        # 18 步界面实跑 + 逐页截图 + 控制台错误采集
npm run verify         # lint + test + build，提交前必跑
npx prisma migrate dev --name <变更名>     # W1 落地后使用；禁止 db push
```

**提交前必须四项全绿**：`lint`、`test`、`test:api`、`test:ui`（截图有新变化时同步更新 `docs/screenshots/`）。

## 目录

`apps/sidecar`（业务后端）· `apps/web`（收银界面）· `apps/shell`（Tauri）· `packages/shared`（DTO/状态机/错误码）· `scripts/`（打包与密钥轮换）

## 开发红线

1. **TDD 强制**：先写失败测试并确认它因"功能缺失"而失败，再写最小实现。资金、状态流转、金额校验、幂等、并发、对账六类**不接受事后补测**。每条测试要能回答"删掉哪段代码它会红"。
2. **金额只允许走** `yuanToFen()` / `fenToYuan()`；DB 一律 `Int` 存分；超过两位小数**拒绝**，不许静默取整。
3. **状态推进一律条件原子更新**：`UPDATE orders SET … WHERE id=? AND status IN (…)`，0 行即冲突。禁止 find 后无条件 `update`。
4. **三条硬规则不得绕过**：金额不符→`EXCEPTION`；已 `CLOSED` 后查到成功→只进 `EXCEPTION` 人工，绝不自动 `PAID`；回调**验签先于**幂等判断。
5. **不做资金业务**：不实现资金归集、余额、充值、提现、转账、分账、代收代付、代商户设置/修改结算账户。多商家集中收款必须先有渠道服务商资质（PRD 28.5）。
6. 时间统一 UTC 存储、枚举全大写、主键策略按 PRD 12.1（业务表 uuid，`audit_logs` 自增），禁止自行"统一"。
7. 不引入 PRD 未列出的第三方依赖；不直接改表结构（必须迁移文件）；不改 `.env` 变量名。
8. 日志/诊断包/接口响应不得输出密码、token、私钥、身份证、银行卡原文；渠道凭据只能以 `enc:v2(...)` 密文入库。
9. 测试必须 hermetic：独立临时 db、固定 env、fake timers；**禁止依赖宿主 `process.env.NODE_ENV` 决定分支行为**。
10. 后端只绑 `127.0.0.1`，任何"监听 0.0.0.0"的改动一律拒绝。

---

内容由 AI 生成
