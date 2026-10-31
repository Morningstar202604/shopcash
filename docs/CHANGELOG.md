# 更新日志

## v0.5.0（2026-10-31）

**审计修复（阻断级）**
- 会话与班次解耦：登出不再清空班次，重登按用户恢复当班班次（`openShiftOf`）；修复「登出重登后开班 40906 + 收银 40320」死锁
- 班次应收实时计算：`/shifts` 与交班共用 `shiftTotals()`，开班期间 `expectedCashFen` 不再恒为 0；「本班实时」改读 `shiftPaidFen/shiftCashFen/shiftOnlineFen`，换班即清零，不再混入全店当日汇总
- 收银台 `window` keydown 监听在 `onUnmounted` 移除，SPA 往返不再累积 handler；下单加 `busy` 与「上一笔未完成」双闸；新增「停止查单」
- 异常结案改为强制店主口令二次确认（`confirmPassword`，失败 40311），界面统一改为弹层，订单详情跳转到待处理页结案
- CSV 导出统一走 `toCsv()`：引号/逗号/换行转义 + `= + - @` 前缀防护 + UTF-8 BOM
- 口令策略收敛到 `checkPassword()`：长度 / 大小写 / 数字 / 非用户名 / 弱口令表（10 条含子串），首启向导与 `POST /bootstrap/setup` 前后端同一实现

**审计修复（建议级）**
- 查单退避改用 `queryAtMs()`：3s/10s/30s/2min/5min 之后每 5min，按 `orderExpireMinutes`（默认 15 分钟）关单，不再累积求和拖到 17.7 分钟
- 时间显示统一 `formatDateTime()/formatTime()/formatMonthDayMinute()`，UTC 存储按 +08:00 展示，订单列表不再慢 8 小时
- 总览「运行状态」去掉硬编码的磁盘/时钟/对账绿色断言：磁盘读真实可用空间，时钟偏差与每日对账明确标注「开发桩未接入」
- 金额展示全部走 `fenToYuan()`，不再有裸 `(x / 100).toFixed(2)`
- 店员 `/dashboard/summary` 与订单列表同口径过滤，不再泄露全店当日金额与单量
- 渠道凭据保存只回显掩码（`mask()`），保存后清空表单；`/users` 不再返回口令字段
- 修掉 `main.js` 中指向不存在的 `/change-password` 路由导致的白屏
- 修掉 `ui-check.mjs` 的 `delete opt._pw` 写法，浏览器探测逻辑恢复可读

**文档与一致性**
- README 功能现状重写：区分「已实现并通过自动化验证」与「仅开发桩、尚未落地真实后端」，删除审计链/备份/对账等超前表述
- `package.json` license 由 `UNLICENSED` 改为 `MIT`，与 `LICENSE` 一致
- `SECURITY.md` 支持版本对齐 0.4.x，并明确当前实现边界
- 单测 34 → 55（新增口令策略、时间格式化、CSV、查单退避四组），接口自检 16 → 24 项，界面自检 18 → 20 步（补首启向导与弱口令拦截截图）

## v0.4.0（2026-10-18）

**自动化**
- 修掉 CI 必挂的真 bug：GitHub Actions 每个 step 是独立 shell，原先在独立 step 里后台起 vite，到端到端 step 时进程已死 → 服务与两项端到端检查合并到同一 step，并加就绪探测与失败时打印 vite 日志
- `scripts/ui-check.mjs` 改为失败即非 0 退出（控制台有报错、或步数不足 18 步都判失败），CI 才真的拦得住；浏览器按 `CHROME_PATH` → Playwright 内置 → 系统 chrome 通道 → 常见路径依次探测，并打印实际用了哪一个
- CI 补 `npx playwright install --with-deps chromium`，截图作为构建制品归档（`if-no-files-found: error`）

**规范化**
- 新增 `SECURITY.md`（漏洞私下报告流程、48h/7d 响应承诺、项目安全基线：零资金介入、只监听 127.0.0.1、无默认口令、凭据信封加密、金额 fail-closed、不采集顾客个人信息）
- 新增 `.gitattributes`（LF 统一、图片与二进制包标记、lock 文件不参与 diff）
- 依赖归类修正：`playwright/vite/@vitejs/plugin-vue/esbuild` 由 dependencies 移入 devDependencies（便携包不需要它们）
- 文档文件去掉多余可执行位；`engines` 放宽为 `>=22.0.0`
- 提交历史收敛为 6 个语义提交（骨架 / 内核 / 界面 / 自检 / 文档 / CI），标签收敛为单个 `v0.4.0` 指向 HEAD；整理前的完整历史保留在交付 bundle 归档里

## v0.3.0（2026-10-14）

**界面与自检**
- Vue 3 收银界面八屏落地：首启向导 / 登录 / 收银台 / 订单与状态时间线 / 班次与交接班 / 待人工处理 / 渠道配置 / 总览
- 新增 `scripts/ui-check.mjs`：Playwright 驱动本机 Chromium 实跑 18 步主流程、逐页截图、采集控制台错误
- 新增 `scripts/api-rules-check.mjs`：15 项资金与权限硬规则的端到端断言（对着 HTTP 接口跑，不是假数据）
- 7 张实拍截图入库到 `docs/screenshots/`，README 重写并附截图

**修掉的真问题**
- mock 轮询把渠道实付金额写死成订单金额，导致「金额不符」规则被演示代码吃掉 → 改为原样交给状态机
- 店员可读到他人订单、可访问待人工处理与渠道配置接口 → 数据范围过滤与角色闸门落到服务端
- 下单成功未进入 `PAYING` 中间态 → 补齐，禁止从待支付直跳终态
- 服务端补金额校验（必须正整数分、≤ 单笔上限），与前端 `yuanToFen` 同口径
- 新增开发专用 `POST /api/__test/reset`，界面自检可重复运行（此前第二次会因残留班次卡住）
- `package.json` 增加 `prepare` 钩子自动编译内核 ESM，修掉「新机器 clone 后跑不起来」的问题

**文档**
- PRD 里程碑表补状态，新增 19.1 实现进度对照与已知偏差清单
- CLAUDE.md 补当前进度与「提交前四项全绿」要求

## v0.3.1（2026-10-18）

**仓库整理**
- 新增 MIT `LICENSE`、`.editorconfig`、`.github/workflows/ci.yml`：CI 每次构建跑 lint → 单测+覆盖率 → 前端构建 → 15 项资金/权限端到端断言 → 18 步界面实跑，并把截图归档成构建制品
- `scripts/ui-check.mjs` 去掉本机 Chromium 硬编码，改用 `CHROME_PATH` / `SHOTS_DIR` 环境变量，任意机器与 CI 可直接运行
- `package.json`：`engines` 由 `22.x` 放宽为 `>=22.0.0`（node 24 上不再报 EBADENGINE），新增 `npm run check`
- 文件权限修正：`CLAUDE.md`、PRD、设计稿等文档去掉多余可执行位
- README 首屏加实拍大图与自检徽章（单测 34、覆盖率 100%、硬规则 15/15、界面 18 步零报错、零资金介入）

## v0.2.0（2026-10-13）
- 金额换算与订单状态机内核，TDD 先行；34 单测，覆盖率 100%

## v0.1.0（2026-10-13）
- 工程骨架、PRD v1、CLAUDE 开发红线、设计定稿

---

内容由 AI 生成
