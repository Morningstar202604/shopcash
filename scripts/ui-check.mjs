/**
 * 界面自检脚本：用本机 Chromium 打开开发服务，走完主流程并逐页截图。
 * 目的：让实现者（我）能真的看到界面并按视觉问题调整，而不是凭空猜样式。
 * 用法：node scripts/ui-check.mjs
 */
import { chromium } from 'playwright'
import fs, { existsSync } from 'node:fs'

// 浏览器定位顺序：CHROME_PATH → Playwright 自带 Chromium → 系统 chrome 通道 → 常见安装路径
const CANDIDATES = []
if (process.env.CHROME_PATH) CANDIDATES.push({ label: 'CHROME_PATH', opt: { executablePath: process.env.CHROME_PATH } })
CANDIDATES.push({ label: 'playwright 内置 chromium', opt: {} })
CANDIDATES.push({ label: '系统 chrome 通道', opt: { channel: 'chrome' } })
for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
  if (existsSync(p)) CANDIDATES.push({ label: p, opt: { executablePath: p } })
}
const { isolatedTarget } = await import('./test-target.mjs')
const BASE = await isolatedTarget()
const OUT = process.env.SHOTS_DIR || '/tmp/shots'
fs.mkdirSync(OUT, { recursive: true })

const errors = []
const shots = []

async function shot(page, name) {
  const file = `${OUT}/${name}.png`
  await page.screenshot({ path: file, fullPage: true })
  shots.push(name)
}

async function launchBrowser() {
  let last
  for (const c of CANDIDATES) {
    try {
      const b = await chromium.launch({ args: ['--no-sandbox'], ...c.opt })
      console.log(`浏览器：${c.label}`)
      return b
    } catch (e) {
      last = e
    }
  }
  throw last
}

const browser = await launchBrowser()
try {
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

// 0. 重置演示数据，保证脚本可重复运行
await fetch(`${BASE}/api/__test/reset?setup=0`, { method: 'POST' })

// 0a. 首启向导（空态 + 弱口令被拦）
await page.goto(`${BASE}/setup`, { waitUntil: 'networkidle' })
await shot(page, '00-setup-empty')
await page.fill('input[placeholder*="河南路"]', '示例便利店')
await page.fill('input >> nth=2', 'ChangeAdmin2026')
await page.fill('input >> nth=3', 'ChangeAdmin2026')
await page.waitForTimeout(300)
await shot(page, '00b-setup-weak-rejected')

// 0b. 恢复正常演示数据
await fetch(`${BASE}/api/__test/reset`, { method: 'POST' })

// 1. 登录页
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await shot(page, '01-login')

// 2. 店主登录 → 收银台（未开班态）
await page.fill('input >> nth=0', 'owner')
await page.fill('input[type=password]', 'Shop2026test')
await page.click('button:has-text("登录")')
await page.waitForURL('**/cashier')
await page.waitForTimeout(500)
await shot(page, '02-cashier-no-shift')

// 3. 开班
await page.click('a[href="/shifts"]')
await page.waitForTimeout(500)
const needsOpen = await page.locator('input[placeholder*="200.00"]').count()
if (needsOpen) {
  await page.fill('input[placeholder*="200.00"]', '200')
  await page.click('button:has-text("开班")')
  await page.waitForTimeout(800)
} else {
  console.log('已存在进行中班次，跳过开班')
}
await shot(page, '03-shift-open')

// 4. 收银台：键盘录入 12.80 → 微信收款 → 等待态
await page.click('a[href="/cashier"]')
await page.waitForTimeout(400)
for (const k of ['1', '2', '.', '8', '0']) await page.click(`.keypad button:has-text("${k}")`)
await shot(page, '04-cashier-amount')

await page.click('button:has-text("微信收款")')
await page.waitForTimeout(900)
await shot(page, '05-cashier-qrcode-waiting')

// 5. 模拟渠道正常付款 → 应翻绿
await page.click('button:has-text("模拟：正常付款")')
await page.waitForTimeout(2500)
await shot(page, '06-cashier-after-paid')

// 6. 金额不符场景：录入 9.90 → 支付宝 → 模拟少付 1 分
await page.click('.keypad button:has-text("C")')
for (const k of ['9', '.', '9', '0']) await page.click(`.keypad button:has-text("${k}")`)
await page.click('button:has-text("支付宝收款")')
await page.waitForTimeout(600)
await page.click('button:has-text("模拟：少付 1 分")')
await page.waitForTimeout(3200)
await shot(page, '07-cashier-amount-mismatch')

// 7. 非法金额 fail-closed：0 元直接被拒
await page.click('.keypad button:has-text("C")')
await page.click('.keypad button:has-text("0")')
await page.click('button:has-text("现金收款")')
await page.waitForTimeout(700)
await shot(page, '08-cashier-invalid-amount')

// 8. 订单列表 + 详情
await page.click('a[href="/orders"]')
await page.waitForTimeout(800)
await shot(page, '09-orders')
await page.click('tbody tr >> nth=0')
await page.waitForTimeout(700)
await shot(page, '10-order-detail')

// 9. 待人工处理 + 结案弹层（店主口令二次确认）
await page.click('a[href="/exceptions"]')
await page.waitForTimeout(800)
await shot(page, '11-exceptions')
await page.click('tbody tr >> nth=0 >> button:has-text("作废")')
await page.waitForTimeout(400)
await shot(page, '11b-exceptions-confirm-step2')
await page.click('button:has-text("取消")')

// 10. 交班（应收现金为 0，数出 0.01 演示差额）
await page.click('a[href="/shifts"]')
await page.waitForTimeout(700)
await page.fill('input[placeholder*="数出来的现金"]', '0.01')
await page.fill('input[placeholder*="少 10 元"]', '演示差额 0.01 元')
await page.click('button:has-text("交班结算")')
await page.waitForTimeout(900)
await shot(page, '12-shift-close')

// 11. 总览
await page.click('a[href="/dashboard"]')
await page.waitForTimeout(800)
await shot(page, '13-dashboard')

// 12. 渠道配置 + 自检提示
await page.click('a[href="/channels"]')
await page.waitForTimeout(800)
await shot(page, '14-channels')
await page.click('button:has-text("配置自检") >> nth=1')
await page.waitForTimeout(700)
await shot(page, '15-channel-check-toast')

// 13. 店员权限边界
const p2 = await ctx.newPage()
p2.on('pageerror', (e) => errors.push(`staff pageerror: ${e.message}`))
p2.on('console', (m) => {
  if (m.type() === 'error') errors.push(`staff console: ${m.text()}`)
})
await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await p2.fill('input >> nth=0', 'staff')
await p2.fill('input[type=password]', 'Staff2026test')
await p2.click('button:has-text("登录")')
await p2.waitForURL('**/cashier')
await p2.waitForTimeout(600)
await shot(p2, '16-cashier-staff')
await p2.goto(`${BASE}/exceptions`)
await p2.waitForTimeout(800)
await shot(p2, '17-staff-redirect')

} finally {
 await browser.close()
}

console.log('shots:', shots.length, shots.join(','))
console.log('errors:', errors.length ? errors.join('\n') : 'none')

// 判定：控制台零报错 + 截图张数达标，否则以非 0 退出，让 CI 真正拦得住
const EXPECTED_SHOTS = 20
if (errors.length) {
  console.error(`界面自检失败：${errors.length} 条控制台报错`)
  process.exit(1)
}
if (shots.length < EXPECTED_SHOTS) {
  console.error(`界面自检失败：只跑到 ${shots.length}/${EXPECTED_SHOTS} 步`)
  process.exit(1)
}
console.log(`界面自检通过：${shots.length} 步、0 控制台报错`)
