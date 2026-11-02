/**
 * 资金硬规则端到端自检（对着真实 HTTP 接口跑，不是单元测试里的假数据）
 * 用法：npm run test:api
 * 覆盖 PRD 5.3 三条硬规则 + PRD 3.1/3.2 角色与数据范围 + 金额 fail-closed + 会话/班次一致性
 */
import { isolatedTarget } from './test-target.mjs'
const BASE = await isolatedTarget()

const call = async (path, opt) => {
  const res = await fetch(BASE + path, {
    method: opt?.method || 'GET',
    headers: opt?.body ? { 'content-type': 'application/json' } : undefined,
    body: opt?.body ? JSON.stringify(opt.body) : undefined,
  })
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, pass, detail) => {
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' ｜ ' + detail : ''}`)
  if (!pass) failed += 1
}

const OWNER = { username: 'owner', password: 'Shop2026test' }
const STAFF = { username: 'staff', password: 'Staff2026test' }

async function login(who) {
  return call('/api/auth/login', { method: 'POST', body: who })
}

async function main() {
  await call('/api/__test/reset', { method: 'POST' })

  // 店主登录并开班
  let r = await login(OWNER)
  check('店主登录', r.code === 0)
  await call('/api/shifts/open', { method: 'POST', body: { floatCashFen: 20000 } })

  // 硬规则 1：渠道实付金额与订单金额不符 → EXCEPTION，不入账
  r = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 990, codeType: 'WECHAT', clientRequestId: 'rule1' } })
  const o1 = r.data.orderNo
  check('下单进入 PAYING 中间态', r.data.status === 'PAYING', r.data.status)
  await call('/api/channels/mock/confirm', { method: 'POST', body: { orderNo: o1, kind: 'AMOUNT_MISMATCH' } })
  await sleep(4200)
  r = await call(`/api/cashier/orders/${o1}/status`)
  check('硬规则1 金额少 1 分 → EXCEPTION(AMOUNT_MISMATCH)，不置 PAID', r.data.status === 'EXCEPTION' && r.data.exceptionReason === 'AMOUNT_MISMATCH', `${r.data.status}/${r.data.exceptionReason}`)

  // 硬规则 2：已关单后渠道才支付成功 → EXCEPTION(LATE_SUCCESS)，绝不自动入账
  r = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 5000, codeType: 'WECHAT', clientRequestId: 'rule2' } })
  const o2 = r.data.orderNo
  await call('/api/channels/mock/confirm', { method: 'POST', body: { orderNo: o2, kind: 'LATE_SUCCESS' } })
  await sleep(4200)
  r = await call(`/api/cashier/orders/${o2}/status`)
  check('硬规则2 迟到成功 → EXCEPTION(LATE_SUCCESS)', r.data.status === 'EXCEPTION' && r.data.exceptionReason === 'LATE_SUCCESS', `${r.data.status}/${r.data.exceptionReason}`)

  // 正常到账：金额一致才 PAID
  r = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 1280, codeType: 'ALIPAY', clientRequestId: 'rule3' } })
  const o3 = r.data.orderNo
  await call('/api/channels/mock/confirm', { method: 'POST', body: { orderNo: o3, kind: 'SUCCESS' } })
  await sleep(4200)
  r = await call(`/api/cashier/orders/${o3}/status`)
  check('金额一致 → PAID', r.data.status === 'PAID', r.data.status)

  // 幂等：同一 clientRequestId 重复提交只有一笔
  const a = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 300, codeType: 'CASH', clientRequestId: 'idem' } })
  const b = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 300, codeType: 'CASH', clientRequestId: 'idem' } })
  check('幂等：重复提交返回同一笔订单', a.data.orderNo === b.data.orderNo, a.data.orderNo)

  // 金额 fail-closed：三位小数被拒绝
  const bad = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 12.805, codeType: 'CASH', clientRequestId: 'bad1' } })
  check('三位小数金额被拒绝', bad.code !== 0, bad.message)
  const zero = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 0, codeType: 'CASH', clientRequestId: 'bad2' } })
  check('0 元订单被拒绝', zero.code !== 0, zero.message)

  // 本班实时：必须只统计本班，不混入今日已交班的班次
  const summary = await call('/api/dashboard/summary')
  check('本班实时现金口径 = 本班现金订单', summary.data.shiftCashFen === a.data.amountFen, `shiftCashFen=${summary.data.shiftCashFen}`)
  const shifts = await call('/api/shifts')
  const openShift = shifts.data.find((s) => s.status === 'OPEN')
  check('未交班班次的应收现金实时可见', openShift.expectedCashFen === a.data.amountFen, `expectedCashFen=${openShift.expectedCashFen}`)

  // 会话/班次一致性：登出再登录不能丢班次，也不能重复开班
  await call('/api/auth/logout', { method: 'POST' })
  r = await login(OWNER)
  check('重新登录恢复当班班次', r.data.shiftId === openShift.id, `shiftId=${r.data.shiftId}`)
  const reopen = await call('/api/shifts/open', { method: 'POST', body: { floatCashFen: 0 } })
  check('重复开班仍被 40906 拦住', reopen.code === 40906, reopen.message)

  // 角色与数据范围
  await call('/api/auth/logout', { method: 'POST' })
  await login(STAFF)
  const noShift = await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 660, codeType: 'CASH', clientRequestId: 'staff1' } })
  check('店员未开班禁止收银', noShift.code === 40320, noShift.message)
  await call('/api/shifts/open', { method: 'POST', body: { floatCashFen: 0 } })
  await call('/api/cashier/orders', { method: 'POST', body: { amountFen: 660, codeType: 'CASH', clientRequestId: 'staff2' } })
  const mine = await call('/api/orders')
  const foreign = (mine.data.rows || []).filter((o) => o.createdById !== 'u_staff1')
  check('店员只看得到本人当班订单', foreign.length === 0, `可见 ${mine.data.total} 笔，越权 ${foreign.length} 笔`)
  const staffSummary = await call('/api/dashboard/summary')
  check('店员总览不泄露全店当日金额', staffSummary.data.todayCount === 1 && staffSummary.data.cashFen === 660, `todayCount=${staffSummary.data.todayCount} cashFen=${staffSummary.data.cashFen}`)
  const denyExc = await call('/api/exceptions')
  check('店员禁止访问待人工处理', denyExc.code === 40313, denyExc.message)
  const denyCfg = await call('/api/channels/wechat/credentials', { method: 'PUT', body: { appid: 'wx', mchid: '1', privateKeyPem: 'k', apiV3Key: 'v', confirmPassword: 'whatever' } })
  check('店员禁止配置渠道凭据', denyCfg.code === 40313, denyCfg.message)

  // 店主二次确认
  await login(OWNER)
  const wrongPwd = await call('/api/channels/wechat/credentials', { method: 'PUT', body: { appid: 'wx', mchid: '1', privateKeyPem: 'k', apiV3Key: 'v', confirmPassword: 'wrong' } })
  check('店主口令错误 → 40311', wrongPwd.code === 40311, wrongPwd.message)
  const incomplete = await call('/api/channels/alipay/credentials', { method: 'PUT', body: { appid: '2021x', mchid: '', privateKeyPem: '', apiV3Key: '', confirmPassword: 'Shop2026test' } })
  check('凭据不完整 → 40001', incomplete.code === 40001, incomplete.message)

  // 异常单结案必须二次确认口令
  const noPwd = await call(`/api/exceptions/${o1}/resolve`, { method: 'POST', body: { action: 'IGNORE', note: '无口令' } })
  check('异常结案缺口令被拒绝', noPwd.code === 40002, noPwd.message)
  const badPwd = await call(`/api/exceptions/${o1}/resolve`, { method: 'POST', body: { action: 'IGNORE', note: '错口令', confirmPassword: 'wrong' } })
  check('异常结案口令错误 → 40311', badPwd.code === 40311, badPwd.message)
  const resolved = await call(`/api/exceptions/${o1}/resolve`, { method: 'POST', body: { action: 'IGNORE', note: '核对渠道无此交易，作废', confirmPassword: 'Shop2026test' } })
  check('异常单可人工结案', resolved.code === 0, resolved.message)
  const after = await call(`/api/orders?kw=${o1}`)
  check('结案后状态不再停留 EXCEPTION', after.data.rows[0].status !== 'EXCEPTION', after.data.rows[0].status)

  // 渠道凭据落库后不回显明文
  const saved = await call('/api/channels/wechat/credentials', { method: 'PUT', body: { appid: 'wx1234567890', mchid: '1900000109', privateKeyPem: 'k', apiV3Key: 'v', confirmPassword: 'Shop2026test' } })
  check('渠道凭据保存成功且仅回显掩码', saved.code === 0 && String(saved.data.masked?.appid || '').includes('*') && !JSON.stringify(saved.data).includes('wx1234567890'), JSON.stringify(saved.data.masked || {}))

  console.log(failed ? `\n✗ ${failed} 项未通过` : '\n全部通过')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('自检异常：', e.message)
  process.exit(1)
})
