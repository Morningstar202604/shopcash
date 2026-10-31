/**
 * Mock API 服务 —— 仅用于本地开发与 Playwright 自测，不进入商家便携包。
 * 业务规则复用 @shopcash/shared 的 decidePayment（与前端、后端同一份实现，避免两套逻辑）。
 *
 * 覆盖 PRD 第 8 章的核心契约：首启 / 登录 / 班次 / 收银 / 查单兜底 / 订单 / 异常 / 渠道。
 */
import { decidePayment, queryAtMs, checkPassword } from '@shopcash/shared'
import { statfsSync } from 'node:fs'

const CASHIER_PWD = 'Staff2026test'
const OWNER_PWD = 'Shop2026test'
const EXCEPTION_REASONS = ['AMOUNT_MISMATCH', 'LATE_SUCCESS', 'PARSE_FAIL', 'NO_CALLBACK', 'MANUAL', 'REFUND_FAILED']

export function createSeed() {
  return {
    setupDone: true,
    storeName: '示例便利店（演示数据）',
    seed: true,
    users: [
      { id: 'u_owner', username: 'owner', displayName: '店主', role: 'OWNER', status: 'ACTIVE', pwd: OWNER_PWD },
      { id: 'u_staff1', username: 'staff', displayName: '小王', role: 'CASHIER', status: 'ACTIVE', pwd: CASHIER_PWD },
      { id: 'u_staff2', username: 'xiaoli', displayName: '小李', role: 'CASHIER', status: 'DISABLED', pwd: CASHIER_PWD },
    ],
    orders: [],
    events: [],
    shifts: [],
    channels: [
      { code: 'mock', name: '模拟渠道', mode: 'DIRECT', enabled: true, configured: true, lastCheckAt: new Date().toISOString(), lastCheckOk: true, lastCheckMsg: 'OK' },
      { code: 'wechat', name: '微信支付', mode: 'DIRECT', enabled: false, configured: false, lastCheckAt: null, lastCheckOk: null, lastCheckMsg: '未填写商户号与证书' },
      { code: 'alipay', name: '支付宝', mode: 'DIRECT', enabled: false, configured: false, lastCheckAt: null, lastCheckOk: null, lastCheckMsg: '未填写应用私钥与公钥' },
    ],
    settings: {
      singleMaxFen: 50000000,
      orderExpireMinutes: 15,
      queryBackoffMs: [3000, 10000, 30000, 120000, 300000],
      snapshotIntervalMin: 30,
      soundEnabled: true,
      timezone: 'Asia/Shanghai',
    },
    session: { userId: 'u_owner', role: 'OWNER', username: 'owner', shiftId: null, mustChangePwd: false },
    seq: 1,
  }
}

function pad(n, l = 2) {
  return String(n).padStart(l, '0')
}

function formatNo(iso, seq) {
  const d = new Date(iso)
  return `SC${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(seq, 6)}`
}

function event(db, orderId, from, to, source, note) {
  db.events.push({ id: `ev_${db.events.length + 1}`, orderId, fromStatus: from, toStatus: to, source, note, createdAt: new Date().toISOString() })
}

/** 渠道返回结果 → 目标态；changed=true 才落库（真实实现里这里是条件原子 UPDATE） */
function applyResult(db, order, result, source) {
  const decision = decidePayment({ status: order.status, amountFen: order.amountFen }, result)
  if (decision.changed) {
    event(db, order.id, order.status, decision.to, source, decision.note)
    order.prevStatus = order.status
    order.status = decision.to
    if (decision.to === 'PAID') order.paidAt = new Date().toISOString()
    if (decision.to === 'CLOSED') order.closedAt = new Date().toISOString()
    if (decision.exceptionReason) order.exceptionReason = decision.exceptionReason
  }
  return decision
}

function nextQueryAt(createdAt, attempt, backoff) {
  return new Date(queryAtMs(new Date(createdAt).getTime(), attempt, backoff)).toISOString()
}

function openShiftOf(db, userId) {
  return db.shifts.find((s) => s.status === 'OPEN' && s.userId === userId) || null
}

function shiftTotals(db, shiftId) {
  const mine = db.orders.filter((o) => o.shiftId === shiftId)
  const paidOn = (o) => o.status === 'PAID' || o.status === 'REFUNDING' || o.status === 'REFUNDED'
  const paid = mine.filter(paidOn)
  const sum = (arr) => arr.reduce((a, o) => a + o.amountFen, 0)
  return {
    paidCount: paid.length,
    paidFen: sum(paid),
    cashFen: sum(paid.filter((o) => o.codeType === 'CASH')),
    onlineFen: sum(paid.filter((o) => o.codeType !== 'CASH')),
    cashCount: paid.filter((o) => o.codeType === 'CASH').length,
    exceptionCount: mine.filter((o) => o.status === 'EXCEPTION').length,
  }
}

function diskFreeMb() {
  try {
    const s = statfsSync(process.cwd())
    return Math.floor((Number(s.bavail) * Number(s.bsize)) / 1024 / 1024)
  } catch {
    return null
  }
}

function mask(value) {
  const text = String(value || '')
  if (text.length <= 6) return '*'.repeat(text.length)
  return `${text.slice(0, 3)}${'*'.repeat(Math.min(12, text.length - 6))}${text.slice(-3)}`
}


function buildPayload(order) {
  if (order.codeType === 'CASH') return { kind: 'NONE' }
  const value = `shopcash://mock/pay/${encodeURIComponent(order.orderNo)}?amt=${order.amountFen}`
  return { kind: 'QRCODE_URL', value, qrText: value }
}

function summary(db) {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 1, 0)
  const isOwner = db.session.role === 'OWNER'
  // 数据范围：店员只看本班，店主看全店当日（PRD 3.2）
  const scope = isOwner
    ? db.orders
    : db.orders.filter((o) => o.createdById === db.session.userId && o.shiftId === db.session.shiftId)
  const today = scope.filter((o) => new Date(o.createdAt) >= dayStart)
  const paid = today.filter((o) => o.status === 'PAID' || o.status === 'REFUNDING' || o.status === 'REFUNDED')
  const sum = (arr) => arr.reduce((a, o) => a + o.amountFen, 0)
  const shift = openShiftOf(db, db.session.userId)
  const shiftView = shift ? shiftTotals(db, shift.id) : null
  const free = diskFreeMb()
  return {
    todayCount: today.length,
    paidCount: paid.length,
    paidFen: sum(paid),
    cashFen: sum(paid.filter((o) => o.codeType === 'CASH')),
    onlineFen: sum(paid.filter((o) => o.codeType !== 'CASH')),
    refundFen: sum(today.filter((o) => o.status === 'REFUNDED')),
    exceptionCount: isOwner ? db.orders.filter((o) => o.status === 'EXCEPTION').length : scope.filter((o) => o.status === 'EXCEPTION').length,
    unpaidCount: today.filter((o) => o.status === 'PENDING' || o.status === 'PAYING').length,
    shiftOpen: Boolean(shift),
    shiftId: shift?.id || null,
    shiftPaidCount: shiftView?.paidCount ?? 0,
    shiftPaidFen: shiftView?.paidFen ?? 0,
    shiftCashFen: shiftView?.cashFen ?? 0,
    shiftOnlineFen: shiftView?.onlineFen ?? 0,
    diskFreeMb: free,
    clockDriftMin: 0,
    diffCount: 0,
    storeName: db.storeName,
    seed: db.seed,
    setupDone: db.setupDone,
  }
}

export function reseedOrders(db) {
  const seedOrders = [
    { codeType: 'WECHAT', amountFen: 1280, ago: 6, status: 'PAID' },
    { codeType: 'ALIPAY', amountFen: 2500, ago: 5, status: 'PAID' },
    { codeType: 'CASH', amountFen: 800, ago: 4, status: 'PAID' },
    { codeType: 'WECHAT', amountFen: 1580, ago: 3, status: 'PAYING' },
    { codeType: 'ALIPAY', amountFen: 990, ago: 2, status: 'EXCEPTION', reason: 'AMOUNT_MISMATCH', paid: 989 },
    { codeType: 'WECHAT', amountFen: 6000, ago: 1, status: 'EXCEPTION', reason: 'LATE_SUCCESS' },
  ]
  let seq = 1
  for (const s of seedOrders) {
    const createdAt = new Date(Date.now() - s.ago * 3600 * 1000).toISOString()
    const o = {
      id: `o_${seq}`,
      orderNo: formatNo(createdAt, seq),
      clientRequestId: `seed_req_${seq}`,
      amountFen: s.amountFen,
      status: s.status,
      codeType: s.codeType,
      channelCode: s.codeType === 'CASH' ? 'cash' : 'mock',
      channelOrderNo: s.status === 'PAID' ? `MOCK${seq}${createdAt.slice(11, 19).replace(/:/g, '')}` : null,
      subject: '',
      remark: s.codeType === 'CASH' ? '堂食' : '',
      shiftId: 'sh_seed',
      createdById: 'u_owner',
      createdAt,
      paidAt: s.status === 'PAID' ? createdAt : null,
      closedAt: null,
      exceptionReason: s.reason || null,
      amountFenPaid: s.paid ?? null,
      prevStatus: s.reason === 'LATE_SUCCESS' ? 'CLOSED' : null,
      attempt: 2,
      nextQueryAt: s.status === 'PAYING' ? new Date().toISOString() : null,
    }
    db.orders.unshift(o)
    db.events.push({ id: `ev_s_${seq}`, orderId: o.id, fromStatus: null, toStatus: s.status, source: 'IMPORT', note: '演示数据', createdAt })
    seq += 1
  }
  db.shifts.push({
    id: 'sh_seed', userId: 'u_owner',
    openAt: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    closeAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    status: 'CLOSED', floatCashFen: 20000, expectedCashFen: 800, expectedOnlineFen: 3780,
    countedCashFen: 700, diffFen: -100, note: '演示：少 1 元，找零争议', paidCount: 3, cashCount: 1, exceptionCount: 0,
  })
  db.seq = seq
}

export function handle(db, method, rawUrl, body) {
  const url = new URL(rawUrl, 'http://mock')
  const p = url.pathname.replace(/^\/api/, '') || '/'
  const seg = p.split('/').filter(Boolean)
  const iso = () => new Date().toISOString()
  const J = (code, data) => ({ status: code, body: { code: 0, message: 'ok', traceId: `t_${Math.random().toString(36).slice(2, 10)}`, data } })
  const E = (http, errCode, message) => ({ status: http, body: { code: errCode, message, traceId: `t_${Math.random().toString(36).slice(2, 10)}`, data: null } })

  // 引导
  if (p === '/bootstrap/state') return J(200, { setupDone: db.setupDone, storeName: db.storeName })
  // 仅开发用：把演示数据重置回初始状态，让界面自检可重复跑（生产不暴露此路由）
  if (method === 'POST' && p === '/__test/reset') {
    Object.assign(db, createSeed())
    reseedOrders(db)
    // ?setup=0 用于截首启向导：清空用户并标记未初始化
    if (url.searchParams.get('setup') === '0') {
      db.setupDone = false
      db.storeName = ''
      db.users = []
      db.orders = []
      db.events = []
      db.shifts = []
    }
    return J(200, { ok: true, setupDone: db.setupDone })
  }
  if (method === 'POST' && p === '/bootstrap/setup') {
    if (db.setupDone) return E(409, 40908, '已完成初始化，不能重复设置')
    const username = String(body.username || '').trim() || 'owner'
    const pwd = String(body.password || '')
    const verdict = checkPassword(pwd, username)
    if (!verdict.ok) return E(400, 40011, `口令不符合要求：${verdict.failed.join('、')}`)
    db.setupDone = true
    db.storeName = body.storeName
    db.users = [{ id: 'u_owner', username, displayName: '店主', role: 'OWNER', status: 'ACTIVE', pwd }]
    return J(200, { ok: true })
  }

  // 认证
  if (method === 'POST' && p === '/auth/login') {
    const u = db.users.find((x) => x.username === body.username)
    if (!u || body.password !== u.pwd) return E(401, 40301, '用户名或口令错误')
    if (u.status === 'DISABLED') return E(403, 40302, '账号已停用，请联系店主')
    const open = openShiftOf(db, u.id)
    db.session = { userId: u.id, role: u.role, username: u.username, shiftId: open?.id || null, mustChangePwd: false }
    return J(200, db.session)
  }
  if (method === 'POST' && p === '/auth/logout') {
    // 只结束会话，不结束班次：班次是业务事实，重登后由 openShiftOf 自动恢复
    db.session = { userId: null, role: null, username: null, shiftId: null, mustChangePwd: false }
    return J(200, { ok: true })
  }
  if (p === '/auth/me') {
    if (!db.session.userId) return E(401, 40101, '未登录')
    const open = openShiftOf(db, db.session.userId)
    db.session.shiftId = open?.id || null
    return J(200, { ...db.session, user: db.users.find((u) => u.id === db.session.userId) })
  }

  // 班次
  if (p === '/shifts' && method === 'GET') {
    return J(200, db.shifts.map((s) => {
      const live = s.status === 'OPEN' ? shiftTotals(db, s.id) : null
      return {
        ...s,
        ...(live ? { expectedCashFen: live.cashFen, expectedOnlineFen: live.onlineFen, paidCount: live.paidCount, cashCount: live.cashCount, exceptionCount: live.exceptionCount } : {}),
        userName: db.users.find((u) => u.id === s.userId)?.displayName || s.userId,
      }
    }))
  }
  if (method === 'POST' && p === '/shifts/open') {
    if (!db.session.userId) return E(401, 40101, '未登录')
    const open = openShiftOf(db, db.session.userId)
    if (open) return E(409, 40906, '已有进行中的班次')
    const now = iso()
    const shift = {
      id: `sh_${db.shifts.length + 1}`,
      userId: db.session.userId,
      openAt: now,
      floatCashFen: body.floatCashFen ?? 0,
      status: 'OPEN',
      expectedCashFen: 0,
      expectedOnlineFen: 0,
      paidCount: 0,
      exceptionCount: 0,
      cashCount: 0,
    }
    db.shifts.push(shift)
    db.session.shiftId = shift.id
    return J(201, shift)
  }
  const closeMatch = p.match(/^\/shifts\/([^/]+)\/close$/)
  if (method === 'POST' && closeMatch) {
    const shift = db.shifts.find((s) => s.id === closeMatch[1])
    if (!shift) return E(404, 40401, '班次不存在')
    if (db.session.role !== 'OWNER' && shift.userId !== db.session.userId) return E(403, 40313, '只能交自己的班')
    if (shift.status === 'CLOSED') return J(200, shift)
    const totals = shiftTotals(db, shift.id)
    shift.expectedCashFen = totals.cashFen
    shift.expectedOnlineFen = totals.onlineFen
    shift.paidCount = totals.paidCount
    shift.cashCount = totals.cashCount
    shift.exceptionCount = totals.exceptionCount
    shift.countedCashFen = body.countedCashFen ?? null
    shift.diffFen = shift.countedCashFen === null ? null : shift.countedCashFen - shift.expectedCashFen
    shift.note = body.note || ''
    shift.status = 'CLOSED'
    shift.closeAt = iso()
    db.session.shiftId = null
    return J(200, shift)
  }

  // 收银
  if (method === 'POST' && p === '/cashier/orders') {
    if (!db.session.userId) return E(401, 40101, '未登录')
    if (!db.session.shiftId) return E(403, 40320, '未开班次')
    // 与生产 DTO 同口径：金额必须是正整数分且 ≤ 单笔上限（前端已用 yuanToFen 拦一次，服务端必须再拦）
    if (!Number.isInteger(body.amountFen) || body.amountFen <= 0) {
      return E(400, 40012, '金额非法：必须为正整数分（超过两位小数一律拒绝）')
    }
    if (body.amountFen > db.settings.singleMaxFen) return E(400, 42901, '金额超出单笔上限')
    if (body.clientRequestId && db.orders.some((o) => o.clientRequestId === body.clientRequestId)) {
      const existed = db.orders.find((o) => o.clientRequestId === body.clientRequestId)
      return J(200, { ...existed, idempotent: true, payload: buildPayload(existed) })
    }
    const now = iso()
    const order = {
      id: `o_${db.seq}`,
      orderNo: formatNo(now, db.seq),
      clientRequestId: body.clientRequestId || `auto_${db.seq}`,
      amountFen: body.amountFen,
      status: 'PENDING',
      codeType: body.codeType || 'MOCK',
      channelCode: body.codeType === 'CASH' ? 'cash' : 'mock',
      channelOrderNo: null,
      subject: body.subject || '',
      remark: body.remark || '',
      shiftId: db.session.shiftId,
      createdById: db.session.userId,
      createdAt: now,
      paidAt: null,
      closedAt: null,
      exceptionReason: null,
      prevStatus: null,
      attempt: 0,
      nextQueryAt: body.codeType === 'CASH' ? null : new Date(Date.now() + db.settings.queryBackoffMs[0]).toISOString(),
      events: [],
    }
    db.seq += 1
    db.orders.unshift(order)
    event(db, order.id, null, 'PENDING', 'UI', '订单创建')
    if (order.codeType === 'CASH') {
      applyResult(db, order, { status: 'SUCCESS', amountFen: order.amountFen }, 'UI')
    } else {
      // 渠道下单成功 → 进入中间态 PAYING（PRD 16 章：禁止从 PENDING 直接跳终态）
      event(db, order.id, order.status, 'PAYING', 'UI', '渠道下单成功，等待顾客付款')
      order.status = 'PAYING'
    }
    return J(201, { ...order, payload: buildPayload(order), pollIntervalMs: 3000, expireAt: new Date(Date.now() + db.settings.orderExpireMinutes * 60000).toISOString() })
  }

  const statusMatch = p.match(/^\/cashier\/orders\/([^/]+)\/status$/)
  if (method === 'GET' && statusMatch) {
    const o = db.orders.find((x) => x.orderNo === statusMatch[1])
    if (!o) return E(404, 40401, '订单不存在')
    const due = o.nextQueryAt && new Date(o.nextQueryAt) <= new Date()
    const open = o.status === 'PENDING' || o.status === 'PAYING'
    // 迟到成功探测：已关单但渠道后又付了，必须还能被查到并进人工（PRD 硬规则 2）
    const lateProbe = o.status === 'CLOSED' && o.mockPaidAt && !o.lateChecked
    if ((due && open) || lateProbe) {
      o.attempt += 1
      if (lateProbe) o.lateChecked = true
      const paid = o.mockPaidAt && new Date(o.mockPaidAt) <= new Date()
      const expired = Date.now() - new Date(o.createdAt).getTime() >= db.settings.orderExpireMinutes * 60000
      if (paid) {
        // 必须把渠道实付金额原样交给状态机，否则「金额不符」这条规则会被演示代码悄悄吃掉
        applyResult(db, o, { status: 'SUCCESS', amountFen: o.amountFenPaid ?? o.amountFen }, 'QUERY')
      } else if (expired) {
        applyResult(db, o, { status: 'UNKNOWN', amountFen: null }, 'SCHEDULER')
        if (o.status !== 'CLOSED') {
          event(db, o.id, o.status, 'CLOSED', 'SCHEDULER', `超时 ${db.settings.orderExpireMinutes} 分钟关单`)
          o.prevStatus = o.status
          o.status = 'CLOSED'
          o.closedAt = iso()
        }
      }
      o.nextQueryAt = o.status === 'PENDING' || o.status === 'PAYING' && !expired
        ? nextQueryAt(o.createdAt, o.attempt, db.settings.queryBackoffMs)
        : null
    }
    return J(200, { orderNo: o.orderNo, status: o.status, amountFen: o.amountFen, paidAt: o.paidAt, exceptionReason: o.exceptionReason, nextQueryAt: o.nextQueryAt, attempt: o.attempt })
  }

  // 渠道模拟（仅 mock 渠道可用，等价于 PRD 的 /channels/mock/confirm）
  if (method === 'POST' && p === '/channels/mock/confirm') {
    if (db.session.role !== 'OWNER') return E(403, 40313, '演示确认仅店主可用')
    const o = db.orders.find((x) => x.orderNo === body.orderNo)
    if (!o) return E(404, 40401, '订单不存在')
    if (body.kind === 'AMOUNT_MISMATCH') {
      o.mockPaidAt = iso()
      o.amountFenPaid = body.amountFen ?? o.amountFen - 1
      o.nextQueryAt = iso()
      const d = decidePayment({ status: o.status, amountFen: o.amountFen }, { status: 'SUCCESS', amountFen: o.amountFenPaid })
      return J(200, { orderNo: o.orderNo, wouldGoTo: d.to, exceptionReason: d.exceptionReason, note: d.note })
    }
    if (body.kind === 'LATE_SUCCESS') {
      // 演示快捷：先按超时关单，再让渠道报成功，用来验证「迟到成功只进人工」
      if (o.status === 'PENDING' || o.status === 'PAYING') {
        event(db, o.id, o.status, 'CLOSED', 'SCHEDULER', '演示：模拟超时关单')
        o.prevStatus = o.status
        o.status = 'CLOSED'
        o.closedAt = iso()
      }
      o.mockPaidAt = iso()
      o.amountFenPaid = o.amountFen
      o.lateChecked = false
      return J(200, { orderNo: o.orderNo, note: '已模拟超时关单，下一轮查单将按迟到成功进待人工处理' })
    }
    o.mockPaidAt = iso()
    return J(200, { orderNo: o.orderNo, note: '已置为待查单命中' })
  }

  // 角色闸门：以下接口只有店主可用（前端隐藏入口不算数，服务端必须自己拦）
  // 总览指标供全站横幅使用，店员也要能读，故不列入店主专属；仅「补录/作废结案」这类处置动作走角色校验
  const OWNER_ONLY = ['/exceptions', '/channels', '/users', '/settings']
  const isOwnerOnly = OWNER_ONLY.some((pre) => p === pre || p.startsWith(pre + '/'))
  if (isOwnerOnly && db.session.role !== 'OWNER') return E(403, 40313, '只有店主可访问该功能')

  // 订单
  if (p === '/orders' && method === 'GET') {
    let rows = db.orders.slice()
    // 数据范围：店员只看得到「本人 + 当班班次」的订单（PRD 3.2）
    if (db.session.role !== 'OWNER') {
      rows = rows.filter((o) => o.createdById === db.session.userId && o.shiftId === db.session.shiftId)
    }
    const q = url.searchParams
    if (q.get('status')) rows = rows.filter((o) => o.status === q.get('status'))
    if (q.get('shiftId')) rows = rows.filter((o) => o.shiftId === q.get('shiftId'))
    if (q.get('kw')) {
      const kw = q.get('kw').toLowerCase()
      rows = rows.filter((o) => [o.orderNo, o.channelOrderNo, o.remark, o.subject].filter(Boolean).some((f) => String(f).toLowerCase().includes(kw)))
    }
    const page = Number(q.get('page') || 1)
    const size = Number(q.get('pageSize') || 20)
    return J(200, { total: rows.length, page, pageSize: size, rows: rows.slice((page - 1) * size, page * size) })
  }
  const detailMatch = p.match(/^\/orders\/([^/]+)$/)
  if (method === 'GET' && detailMatch) {
    const o = db.orders.find((x) => x.orderNo === detailMatch[1])
    if (!o) return E(404, 40401, '订单不存在')
    if (db.session.role !== 'OWNER' && !(o.createdById === db.session.userId && o.shiftId === db.session.shiftId)) {
      return E(403, 40312, '只能查看本人当班的订单')
    }
    return J(200, { ...o, events: db.events.filter((e) => e.orderId === o.id) })
  }

  // 异常工作台：迟到成功在这里人工结案
  const resolveMatch = p.match(/^\/exceptions\/([^/]+)\/resolve$/)
  if (method === 'POST' && resolveMatch) {
    if (db.session.role !== 'OWNER') return E(403, 40313, '只有店主可处理待处理订单')
    const o = db.orders.find((x) => x.orderNo === resolveMatch[1])
    if (!o) return E(404, 40401, '订单不存在')
    if (o.status !== 'EXCEPTION') return E(409, 40907, '该订单不在异常态')
    // PRD 199：异常结案属敏感操作，必须店主口令二次确认，失败只回 40311
    if (!body.confirmPassword) return E(400, 40002, '异常单结案需要店主口令二次确认')
    const owner = db.users.find((u) => u.id === db.session.userId)
    if (!owner || body.confirmPassword !== owner.pwd) return E(403, 40311, '二次确认口令错误')
    if (body.action === 'RECORD_IN') {
      event(db, o.id, 'EXCEPTION', 'PAID', 'MANUAL', `店主人工补录：${body.note || ''}`)
      o.status = 'PAID'
      o.paidAt = iso()
      o.exceptionReason = null
    } else if (body.action === 'IGNORE') {
      event(db, o.id, 'EXCEPTION', 'CLOSED', 'MANUAL', `店主作废并说明：${body.note || ''}`)
      o.status = 'CLOSED'
      o.exceptionReason = null
    } else {
      return E(400, 40001, '未知处理动作')
    }
    return J(200, { orderNo: o.orderNo, status: o.status })
  }
  if (p === '/exceptions' && method === 'GET') {
    const rows = db.orders.filter((o) => o.status === 'EXCEPTION').map((o) => ({ ...o, amountFenPaid: o.amountFenPaid ?? null }))
    return J(200, { total: rows.length, reasons: EXCEPTION_REASONS, rows })
  }

  // 渠道 / 设置 / 总览
  if (p === '/channels') return J(200, db.channels)
  if (method === 'POST' && p.match(/^\/channels\/([^/]+)\/check$/)) {
    const ch = db.channels.find((c) => c.code === p.split('/')[2])
    if (!ch) return E(404, 40401, '渠道不存在')
    ch.lastCheckAt = iso()
    ch.lastCheckOk = ch.configured
    ch.lastCheckMsg = ch.configured ? '自检通过：证书可加载、appid 与商户号匹配' : '自检未通过：凭据未填写完整'
    return J(200, ch)
  }
  if (method === 'PUT' && p.match(/^\/channels\/([^/]+)\/credentials$/)) {
    const ch = db.channels.find((c) => c.code === p.split('/')[2])
    if (!ch) return E(404, 40401, '渠道不存在')
    if (db.session.role !== 'OWNER') return E(403, 40313, '只有店主可配置渠道')
    const owner = db.users.find((u) => u.id === db.session.userId)
    if (!owner || body.confirmPassword !== owner.pwd) return E(403, 40311, '二次确认口令错误')
    const missing = ['appid', 'mchid', 'privateKeyPem', 'apiV3Key'].filter((k) => !String(body[k] || '').trim())
    if (missing.length) return E(400, 40001, `凭据不完整：缺少 ${missing.join(' / ')}`)
    ch.configured = true
    ch.lastCheckAt = iso()
    ch.lastCheckOk = true
    ch.lastCheckMsg = '凭据已加密保存（演示：仅标记状态，不落真实密文）'
    return J(200, { ...ch, masked: { appid: mask(body.appid), mchid: mask(body.mchid) } })
  }
  if (p === '/settings') return method === 'GET' ? J(200, db.settings) : J(200, { ...db.settings, ...body })
  if (p === '/users') return J(200, db.users.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status })))
  if (p === '/dashboard/summary') return J(200, summary(db))

  return E(404, 40401, '接口不存在')
}
