# 开发期接口清单（现状快照）

> 本文件记录**仓库当前实际存在**的接口，全部由 `tools/mock-server.js` 通过 Vite 中间件提供，数据在内存。
> 目标形态（NestJS sidecar + Prisma）的正式契约仍以 `docs/店收宝-PRD-v1.md` 第 8 章为准，两者尚不一致。

统一响应：成功 `{ code: 0, message: "ok", traceId, data }`；失败 `{ code: <业务码>, message, traceId, data: null }`。

## 引导与会话

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bootstrap/state` | 是否已完成首启、店名 |
| POST | `/api/bootstrap/setup` | 首启设置（口令走 `checkPassword()`，重复调用返回 40908） |
| POST | `/api/auth/login` | 登录，返回 `userId/role/username/shiftId`（`shiftId` 由当班班次自动恢复） |
| POST | `/api/auth/logout` | 结束会话，不动班次 |
| GET | `/api/auth/me` | 当前会话 + 当班班次 |

## 班次

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/shifts` | 班次列表；OPEN 班次的应收现金/线上实时计算 |
| POST | `/api/shifts/open` | 开班，已有 OPEN 班次返回 40906 |
| POST | `/api/shifts/{id}/close` | 交班，计算 `expectedCashFen/expectedOnlineFen/diffFen` |

## 收银与订单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/cashier/orders` | 下单（金额正整数分，`clientRequestId` 幂等） |
| GET | `/api/cashier/orders/{orderNo}/status` | 查单（按退避序列推进状态机） |
| POST | `/api/channels/mock/confirm` | 演示渠道确认（`SUCCESS`/`AMOUNT_MISMATCH`/`LATE_SUCCESS`），仅店主 |
| GET | `/api/orders` | 订单列表（店员只看本人当班） |
| GET | `/api/orders/{orderNo}` | 订单详情 + 状态时间线 |
| GET | `/api/exceptions` | 待人工处理列表，仅店主 |
| POST | `/api/exceptions/{orderNo}/resolve` | 结案（`RECORD_IN`/`IGNORE`，必须 `confirmPassword`） |

## 渠道与总览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/channels` | 渠道列表 |
| POST | `/api/channels/{code}/check` | 配置自检 |
| PUT | `/api/channels/{code}/credentials` | 保存凭据（店主口令二次确认，返回掩码） |
| GET | `/api/dashboard/summary` | 汇总；店主看全店当日，店员看本班 |
| GET/PUT | `/api/settings` | 运行参数，仅店主 |
| GET | `/api/users` | 员工列表（不含口令字段），仅店主 |
| POST | `/api/__test/reset` | 仅开发：重置演示数据 |
