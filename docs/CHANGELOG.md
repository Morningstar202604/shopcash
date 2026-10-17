# 更新日志

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

## v0.2.0（2026-10-13）
- 金额换算与订单状态机内核，TDD 先行；34 单测，覆盖率 100%

## v0.1.0（2026-10-13）
- 工程骨架、PRD v1、CLAUDE 开发红线、设计定稿

---

内容由 AI 生成

## v0.3.1（2026-10-18）

**仓库整理**
- 新增 MIT `LICENSE`、`.editorconfig`、`.github/workflows/ci.yml`：CI 每次构建跑 lint → 单测+覆盖率 → 前端构建 → 15 项资金/权限端到端断言 → 18 步界面实跑，并把截图归档成构建制品
- `scripts/ui-check.mjs` 去掉本机 Chromium 硬编码，改用 `CHROME_PATH` / `SHOTS_DIR` 环境变量，任意机器与 CI 可直接运行
- `package.json`：`engines` 由 `22.x` 放宽为 `>=22.0.0`（node 24 上不再报 EBADENGINE），新增 `npm run check`
- 文件权限修正：`CLAUDE.md`、PRD、设计稿等文档去掉多余可执行位
- README 首屏加实拍大图与自检徽章（单测 34、覆盖率 100%、硬规则 15/15、界面 18 步零报错、零资金介入）
