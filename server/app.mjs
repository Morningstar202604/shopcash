import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { appendAudit, newId, nowIso, verifyAuditChain } from './db.mjs'
import {
  decidePayment,
  queryAtMs,
  checkPassword,
  yuanToFen,
  fenToYuan,
  toCsv,
} from '@shopcash/shared'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const MAX_LOGIN_FAILURES = 5
const LOCK_MINUTES = 10

const DEFAULT_SETTINGS = {
  singleMaxFen: 50000000,
  orderExpireMinutes: 15,
  queryBackoffMs: [3000, 10000, 30000, 120000, 300000],
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
  }
}

function settingsOf(db, storeId) {
  const rows = db.prepare('SELECT key, value FROM settings WHERE storeId = ?').all(storeId)
  const out = { ...DEFAULT_SETTINGS }
  for (const r of rows) out[r.key] = JSON.parse(r.value)
  return out
}

export function saveSettings(db, storeId, patch, actor) {
  const allowed = ['singleMaxFen', 'orderExpireMinutes']
  const before = settingsOf(db, storeId)
  for (const key of allowed) {
    if (patch[key] === undefined) continue
    if (!Number.isInteger(patch[key]) || patch[key] <= 0) {
      throw new HttpError(400, 40013, `${key} 必须是正整数`)
    }
    db.prepare(
      'INSERT INTO settings(storeId, key, value) VALUES(?, ?, ?) ON CONFLICT(storeId, key) DO UPDATE SET value = excluded.value',
    ).run(storeId, key, JSON.stringify(patch[key]))
  }
  const after = settingsOf(db, storeId)
  appendAudit(db, {
    ts: nowIso(),
    orgId: actor.orgId,
    storeId,
    actorId: actor.id,
    actorRole: actor.role,
    action: 'SETTINGS_UPDATE',
    targetType: 'SETTING',
    targetId: storeId,
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
  })
  return after
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex')
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(
    'INSERT INTO sessions(token, userId, activeStoreId, createdAt, expiresAt) VALUES(?, ?, NULL, ?, ?)',
  ).run(token, userId, createdAt, expiresAt)
  return token
}

export function resolveSession(db, token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT s.token, s.expiresAt, s.activeStoreId, u.*
       FROM sessions s JOIN users u ON u.id = s.userId
       WHERE s.token = ?`,
    )
    .get(token)
  if (!row) return null
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  if (row.status !== 'ACTIVE') return null
  const stores = db
    .prepare(
      `SELECT st.id, st.name, st.code FROM stores st
       JOIN store_members m ON m.storeId = st.id
       WHERE m.userId = ? AND st.status = 'ACTIVE'
       ORDER BY st.name`,
    )
    .all(row.id)
  const activeStoreId = row.activeStoreId && stores.some((s) => s.id === row.activeStoreId)
    ? row.activeStoreId
    : stores[0]?.id ?? null
  if (activeStoreId !== row.activeStoreId) {
    db.prepare('UPDATE sessions SET activeStoreId = ? WHERE token = ?').run(activeStoreId, token)
  }
  return {
    token,
    user: row,
    orgId: row.orgId,
    stores,
    storeId: activeStoreId,
  }
}

function requireStore(ctx) {
  if (!ctx.storeId) throw new HttpError(403, 40330, '当前账号未分配门店')
  return ctx.storeId
}

function canManageStore(user) {
  return user.role === 'OWNER' || user.role === 'MANAGER'
}

function requireManager(ctx) {
  if (!canManageStore(ctx.user)) throw new HttpError(403, 40313, '需要门店管理权限')
}

function orderRow(db, storeId, orderNo) {
  return db
    .prepare('SELECT * FROM orders WHERE storeId = ? AND orderNo = ?')
    .get(storeId, orderNo)
}

function addEvent(db, orderId, fromStatus, toStatus, source, actorId, note) {
  db.prepare(
    `INSERT INTO order_events(id, orderId, fromStatus, toStatus, source, actorId, note, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId('ev'), orderId, fromStatus, toStatus, source, actorId, note || '', nowIso())
}

function shiftTotals(db, shiftId) {
  const rows = db
    .prepare('SELECT codeType, amountFen FROM orders WHERE shiftId = ? AND status IN (?, ?, ?)')
    .all(shiftId, 'PAID', 'REFUNDING', 'REFUNDED')
  const sum = (arr) => arr.reduce((a, r) => a + r.amountFen, 0)
  const cash = rows.filter((r) => r.codeType === 'CASH')
  return {
    paidCount: rows.length,
    cashFen: sum(cash),
    onlineFen: sum(rows.filter((r) => r.codeType !== 'CASH')),
    cashCount: cash.length,
  }
}

function openShiftOf(db, userId) {
  return db.prepare("SELECT * FROM shifts WHERE userId = ? AND status = 'OPEN'").get(userId)
}

function refreshShiftTotals(db, shift) {
  const totals = shiftTotals(db, shift.id)
  db.prepare(
    'UPDATE shifts SET expectedCashFen = ?, expectedOnlineFen = ?, status = status WHERE id = ?',
  ).run(totals.cashFen, totals.onlineFen, shift.id)
  return totals
}

function orderView(row) {
  return {
    orderNo: row.orderNo,
    amountFen: row.amountFen,
    status: row.status,
    codeType: row.codeType,
    channelOrderNo: row.channelOrderNo,
    remark: row.remark,
    subject: row.subject,
    createdById: row.createdById,
    exceptionReason: row.exceptionReason,
    amountFenPaid: row.amountFenPaid,
    paidAt: row.paidAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    nextQueryAt: row.nextQueryAt,
    attempt: row.attempt,
  }
}

export function sweepExpiredOrders(db) {
  const rows = db
    .prepare("SELECT * FROM orders WHERE status IN ('PENDING', 'PAYING') AND nextQueryAt IS NOT NULL")
    .all()
  let changed = 0
  for (const row of rows) {
    const expireAt = new Date(row.createdAt).getTime() + settingsOf(db, row.storeId).orderExpireMinutes * 60000
    if (Date.now() < expireAt) continue
    if (row.status === 'PENDING' || row.status === 'PAYING') {
      const result = decidePayment(
        { status: row.status, amountFen: row.amountFen },
        { status: 'UNKNOWN', amountFen: null },
      )
      if (!result.changed) {
        db.prepare("UPDATE orders SET status = 'CLOSED', closedAt = ?, nextQueryAt = NULL WHERE id = ? AND status IN ('PENDING','PAYING')").run(
          nowIso(),
          row.id,
        )
        addEvent(db, row.id, row.status, 'CLOSED', 'SCHEDULER', null, '超过订单有效期，自动关单')
        changed += 1
      }
    }
  }
  return changed
}

function channelMockPayload(row) {
  const value = `shopcash://mock/pay/${encodeURIComponent(row.orderNo)}?amt=${row.amountFen}`
  return { kind: 'QRCODE_URL', value, qrText: value }
}

function applyChannelResult(db, ctx, row, result, source) {
  const decision = decidePayment({ status: row.status, amountFen: row.amountFen }, result)
  if (!decision.changed) return decision
  const updated = db
    .prepare(
      'UPDATE orders SET status = ?, exceptionReason = ?, paidAt = ?, closedAt = ?, channelOrderNo = COALESCE(?, channelOrderNo) WHERE id = ? AND status = ?',
    )
    .run(
      decision.to,
      decision.exceptionReason ?? null,
      decision.to === 'PAID' ? nowIso() : row.paidAt,
      decision.to === 'CLOSED' ? nowIso() : row.closedAt,
      result.channelOrderNo ?? null,
      row.id,
      row.status,
    )
  if (updated.changes === 0) throw new HttpError(409, 40910, '订单状态已被其他请求改变，请刷新')
  addEvent(db, row.id, row.status, decision.to, source, ctx?.user?.id ?? null, decision.note)
  appendAudit(db, {
    ts: nowIso(),
    orgId: ctx?.orgId ?? row.orgId,
    storeId: row.storeId,
    actorId: ctx?.user?.id ?? null,
    actorRole: 'SYSTEM',
    action: 'ORDER_STATUS_CHANGE',
    targetType: 'ORDER',
    targetId: row.orderNo,
    beforeJson: row.status,
    afterJson: decision.to,
    amountFen: row.amountFen,
  })
  return decision
}

function listStores(db, ctx) {
  return db
    .prepare(
      `SELECT st.id, st.name, st.code, st.status,
              (SELECT COUNT(*) FROM orders o WHERE o.storeId = st.id) AS orderCount
       FROM stores st JOIN store_members m ON m.storeId = st.id
       WHERE m.userId = ? AND st.orgId = ? ORDER BY st.name`,
    )
    .all(ctx.user.id, ctx.orgId)
}

function platformSummary(db, ctx) {
  if (!canManageStore(ctx.user)) throw new HttpError(403, 40313, '需要门店管理权限')
  const since = new Date()
  since.setHours(0, 0, 1, 0)
  const rows = db
    .prepare(
      `SELECT o.storeId, st.name, COUNT(*) AS total,
              SUM(CASE WHEN o.status IN ('PAID','REFUNDING','REFUNDED') THEN 1 ELSE 0 END) AS paidCount,
              SUM(CASE WHEN o.status IN ('PAID','REFUNDING','REFUNDED') THEN o.amountFen ELSE 0 END) AS paidFen,
              SUM(CASE WHEN o.status = 'EXCEPTION' THEN 1 ELSE 0 END) AS exceptionCount
       FROM orders o JOIN stores st ON st.id = o.storeId
       WHERE o.storeId IN (SELECT storeId FROM store_members WHERE userId = ?) AND o.createdAt >= ?
       GROUP BY o.storeId ORDER BY st.name`,
    )
    .all(ctx.user.id, since.toISOString())
  const stores = listStores(db, ctx).map((s) => {
    const stat = rows.find((r) => r.storeId === s.id) || {}
    return {
      ...s,
      todayCount: stat.total ?? 0,
      paidCount: stat.paidCount ?? 0,
      paidFen: stat.paidFen ?? 0,
      exceptionCount: stat.exceptionCount ?? 0,
    }
  })
  return {
    stores,
    totals: stores.reduce(
      (acc, s) => ({
        todayCount: acc.todayCount + s.todayCount,
        paidCount: acc.paidCount + s.paidCount,
        paidFen: acc.paidFen + s.paidFen,
        exceptionCount: acc.exceptionCount + s.exceptionCount,
      }),
      { todayCount: 0, paidCount: 0, paidFen: 0, exceptionCount: 0 },
    ),
  }
}

function storeSummary(db, ctx) {
  const storeId = requireStore(ctx)
  const since = new Date()
  since.setHours(0, 0, 1, 0)
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId)
 const candidate = openShiftOf(db, ctx.user.id)
 const open = candidate?.storeId === storeId ? candidate : null
 const totals = open ? refreshShiftTotals(db, open) : null
  const scopeSql = ctx.user.role === 'CASHIER'
    ? 'SELECT * FROM orders WHERE storeId = ? AND createdById = ?'
    : 'SELECT * FROM orders WHERE storeId = ?'
  const scopeParams = ctx.user.role === 'CASHIER' ? [storeId, ctx.user.id] : [storeId]
  const all = db.prepare(`${scopeSql} AND createdAt >= ?`).all(...scopeParams, since.toISOString())
  const paid = all.filter((o) => ['PAID', 'REFUNDING', 'REFUNDED'].includes(o.status))
  const sum = (arr) => arr.reduce((a, o) => a + o.amountFen, 0)
  return {
    storeName: store?.name ?? '',
    orgId: ctx.orgId,
    todayCount: all.length,
    paidCount: paid.length,
    paidFen: sum(paid),
    cashFen: sum(paid.filter((o) => o.codeType === 'CASH')),
    onlineFen: sum(paid.filter((o) => o.codeType !== 'CASH')),
    refundFen: sum(all.filter((o) => o.status === 'REFUNDED')),
    exceptionCount: all.filter((o) => o.status === 'EXCEPTION').length,
    unpaidCount: all.filter((o) => ['PENDING', 'PAYING'].includes(o.status)).length,
    shiftOpen: Boolean(open),
    shiftId: open?.id ?? null,
    shiftPaidCount: totals?.paidCount ?? 0,
    shiftPaidFen: (totals?.cashFen ?? 0) + (totals?.onlineFen ?? 0),
    shiftCashFen: totals?.cashFen ?? 0,
    shiftOnlineFen: totals?.onlineFen ?? 0,
  }
}

export function createApp({ db }) {
  function route(method, pathname, body, ctx) {
    const url = new URL(pathname, 'http://local')
    const p = url.pathname
    const m = method.toUpperCase()

    if (m === 'GET' && p === '/api/health') {
      return { status: 200, data: { ok: true, now: nowIso() } }
    }

    if (m === 'GET' && p === '/api/bootstrap/state') {
      const org = db.prepare('SELECT id, name, code FROM organizations ORDER BY createdAt LIMIT 1').get()
      const store = org
        ? db.prepare('SELECT name FROM stores WHERE orgId = ? ORDER BY createdAt LIMIT 1').get(org.id)
        : null
      return {
        status: 200,
        data: {
          setupDone: Boolean(org),
          storeName: store?.name ?? '',
          orgName: org?.name ?? '',
          platform: true,
        },
      }
    }

    if (m === 'POST' && p === '/api/bootstrap/setup') {
      const existing = db.prepare('SELECT id FROM organizations LIMIT 1').get()
      if (existing) throw new HttpError(409, 40908, '平台已完成初始化')
      const orgName = String(body.orgName || '').trim()
      const storeName = String(body.storeName || '').trim()
      const username = String(body.username || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!orgName || orgName.length > 60) throw new HttpError(400, 40020, '机构名称必填且不超过 60 字')
      if (!storeName || storeName.length > 60) throw new HttpError(400, 40020, '门店名称必填且不超过 60 字')
      if (!/^[a-z0-9_]{4,20}$/.test(username)) throw new HttpError(400, 40021, '登录名需 4-20 位小写字母、数字或下划线')
      const verdict = checkPassword(password, username)
      if (!verdict.ok) throw new HttpError(400, 40011, `口令不符合要求：${verdict.failed.join('、')}`)
      const ts = nowIso()
      const orgId = newId('org')
      const storeId = newId('store')
      const userId = newId('user')
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO organizations(id, name, code, status, createdAt) VALUES(?,?,?,?,?)').run(
          orgId,
          orgName,
          'ORG' + Date.now().toString(36).toUpperCase(),
          'ACTIVE',
          ts,
        )
        db.prepare('INSERT INTO stores(id, orgId, name, code, timezone, status, createdAt) VALUES(?,?,?,?,?,?,?)').run(
          storeId,
          orgId,
          storeName,
          'S001',
          'Asia/Shanghai',
          'ACTIVE',
          ts,
        )
        db.prepare(
          'INSERT INTO users(id, orgId, username, displayName, passwordHash, role, status, mustChangePwd, failedCount, createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
        ).run(userId, orgId, username, '店主', hashPassword(password), 'OWNER', 'ACTIVE', 0, 0, ts)
        db.prepare('INSERT INTO store_members(storeId, userId) VALUES(?, ?)').run(storeId, userId)
        for (const code of ['mock', 'wechat', 'alipay']) {
          db.prepare(
            'INSERT INTO channels(id, storeId, code, name, mode, enabled, configured, lastCheckMsg) VALUES(?,?,?,?,?,?,?,?)',
          ).run(
            newId('ch'),
            storeId,
            code,
            code === 'mock' ? '模拟渠道' : code === 'wechat' ? '微信支付' : '支付宝',
            'DIRECT',
            code === 'mock' ? 1 : 0,
            code === 'mock' ? 1 : 0,
            code === 'mock' ? '演示渠道可用' : '未配置（演示模式不接真实渠道）',
          )
        }
        appendAudit(db, {
          ts,
          orgId,
          storeId,
          actorId: userId,
          actorRole: 'OWNER',
          action: 'PLATFORM_BOOTSTRAP',
          targetType: 'ORGANIZATION',
          targetId: orgId,
          afterJson: JSON.stringify({ orgName, storeName }),
        })
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { status: 201, data: { orgId, storeId, userId } }
    }

    if (m === 'POST' && p === '/api/auth/login') {
      const username = String(body.username || '').trim().toLowerCase()
      const password = String(body.password || '')
      const orgCode = body.orgCode ? String(body.orgCode).trim() : null
      const org = orgCode
        ? db.prepare('SELECT * FROM organizations WHERE code = ?').get(orgCode)
        : db.prepare('SELECT * FROM organizations ORDER BY createdAt LIMIT 1').get()
      if (!org) throw new HttpError(401, 40301, '用户名或口令错误')
      const user = db.prepare('SELECT * FROM users WHERE orgId = ? AND username = ?').get(org.id, username)
      if (!user) throw new HttpError(401, 40301, '用户名或口令错误')
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        throw new HttpError(423, 40303, '连续登录失败次数过多，请稍后再试')
      }
      if (!verifyPassword(password, user.passwordHash)) {
        const failed = user.failedCount + 1
        const locked = failed >= MAX_LOGIN_FAILURES
          ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
          : null
        db.prepare('UPDATE users SET failedCount = ?, lockedUntil = ? WHERE id = ?').run(
          locked ? 0 : failed,
          locked,
          user.id,
        )
        throw new HttpError(401, 40301, '用户名或口令错误')
      }
      if (user.status !== 'ACTIVE') throw new HttpError(403, 40302, '账号已停用，请联系管理员')
      db.prepare('UPDATE users SET failedCount = 0, lockedUntil = NULL WHERE id = ?').run(user.id)
      const token = createSession(db, user.id)
      const ctxNew = resolveSession(db, token)
      return {
        status: 200,
        data: {
          token,
          user: publicUser(user),
          org: { id: org.id, name: org.name },
          stores: ctxNew.stores,
          storeId: ctxNew.storeId,
        },
      }
    }

    if (m === 'POST' && p === '/api/auth/logout') {
      if (ctx) db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.token)
      return { status: 200, data: { ok: true } }
    }

    if (p.startsWith('/api/bootstrap/')) {
      throw new HttpError(404, 40401, '接口不存在')
    }

    if (!ctx) throw new HttpError(401, 40101, '未登录')

    if (m === 'GET' && p === '/api/auth/me') {
      return {
        status: 200,
        data: {
          user: publicUser(ctx.user),
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          stores: ctx.stores,
          role: ctx.user.role,
          username: ctx.user.username,
          displayName: ctx.user.displayName,
        },
      }
    }

    if (m === 'POST' && p === '/api/auth/switch-store') {
      if (!ctx.stores.some((s) => s.id === body.storeId)) throw new HttpError(403, 40331, '无权访问该门店')
      db.prepare('UPDATE sessions SET activeStoreId = ? WHERE token = ?').run(body.storeId, ctx.token)
      return { status: 200, data: { storeId: body.storeId } }
    }

    if (m === 'GET' && p === '/api/stores') {
      return { status: 200, data: listStores(db, ctx) }
    }

    if (m === 'GET' && p === '/api/platform/summary') {
      return { status: 200, data: platformSummary(db, ctx) }
    }

    if (m === 'GET' && p === '/api/dashboard/summary') {
      return { status: 200, data: storeSummary(db, ctx) }
    }

    if (m === 'GET' && p === '/api/shifts') {
      const storeId = requireStore(ctx)
      const rows = ctx.user.role === 'CASHIER'
        ? db.prepare('SELECT * FROM shifts WHERE storeId = ? AND userId = ? ORDER BY openAt DESC').all(storeId, ctx.user.id)
        : db.prepare('SELECT * FROM shifts WHERE storeId = ? ORDER BY openAt DESC').all(storeId)
      return {
        status: 200,
        data: rows.map((s) => {
          const user = db.prepare('SELECT displayName FROM users WHERE id = ?').get(s.userId)
          const totals = s.status === 'OPEN' ? refreshShiftTotals(db, s) : null
          return {
            ...s,
            floatCashFen: s.floatCashFen,
            expectedCashFen: totals ? totals.cashFen : s.expectedCashFen,
            expectedOnlineFen: totals ? totals.onlineFen : s.expectedOnlineFen,
            paidCount: totals ? totals.paidCount : 0,
            cashCount: totals ? totals.cashCount : 0,
            userName: user?.displayName ?? s.userId,
          }
        }),
      }
    }

    if (m === 'POST' && p === '/api/shifts/open') {
      const storeId = requireStore(ctx)
      if (ctx.user.role !== 'CASHIER' && ctx.user.role !== 'OWNER' && ctx.user.role !== 'MANAGER') {
        throw new HttpError(403, 40313, '当前角色不能开班')
      }
      const open = openShiftOf(db, ctx.user.id)
      if (open) throw new HttpError(409, 40906, '已有进行中的班次')
      const floatCashFen = body.floatCashFen ?? 0
      if (!Number.isInteger(floatCashFen) || floatCashFen < 0) throw new HttpError(400, 40012, '备用金必须为非负整数分')
      const shift = {
        id: newId('sh'),
        storeId,
        userId: ctx.user.id,
        openAt: nowIso(),
        status: 'OPEN',
        floatCashFen,
      }
      db.prepare(
        'INSERT INTO shifts(id, storeId, userId, openAt, floatCashFen, status) VALUES(?,?,?,?,?,?)',
      ).run(shift.id, storeId, ctx.user.id, shift.openAt, floatCashFen, 'OPEN')
      appendAudit(db, {
        ts: shift.openAt,
        orgId: ctx.orgId,
        storeId,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        action: 'SHIFT_OPEN',
        targetType: 'SHIFT',
        targetId: shift.id,
        amountFen: floatCashFen,
      })
      return { status: 201, data: shift }
    }

    const closeMatch = p.match(/^\/api\/shifts\/([^/]+)\/close$/)
    if (m === 'POST' && closeMatch) {
      const storeId = requireStore(ctx)
      const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND storeId = ?').get(closeMatch[1], storeId)
      if (!shift || shift.storeId !== storeId) throw new HttpError(404, 40401, '班次不存在')
      if (shift.userId !== ctx.user.id && !canManageStore(ctx.user)) throw new HttpError(403, 40313, '只能交自己的班')
      if (shift.status === 'CLOSED') {
        return { status: 200, data: shift }
      }
      const countedCashFen = body.countedCashFen
      if (!Number.isInteger(countedCashFen) || countedCashFen < 0) {
        throw new HttpError(400, 40012, '实点现金必须为非负整数分')
      }
      const totals = shiftTotals(db, shift.id)
      const diffFen = countedCashFen - totals.cashFen
      const ts = nowIso()
      const updated = db
        .prepare(
          "UPDATE shifts SET closeAt = ?, expectedCashFen = ?, expectedOnlineFen = ?, countedCashFen = ?, diffFen = ?, note = ?, status = 'CLOSED' WHERE id = ? AND status = 'OPEN'",
        )
        .run(ts, totals.cashFen, totals.onlineFen, countedCashFen, diffFen, body.note || '', shift.id)
      if (updated.changes === 0) throw new HttpError(409, 40911, '班次已被其他请求关闭')
      appendAudit(db, {
        ts,
        orgId: ctx.orgId,
        storeId,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        action: 'SHIFT_CLOSE',
        targetType: 'SHIFT',
        targetId: shift.id,
        beforeJson: JSON.stringify({ status: 'OPEN' }),
        afterJson: JSON.stringify({ status: 'CLOSED', countedCashFen, diffFen }),
        amountFen: countedCashFen,
      })
      const closed = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id)
      return { status: 200, data: closed }
    }

    if (m === 'POST' && p === '/api/cashier/orders') {
      const storeId = requireStore(ctx)
      if (ctx.user.role === 'VIEWER') throw new HttpError(403, 40313, '当前角色不能收银')
      const shift = openShiftOf(db, ctx.user.id)
      if (!shift || shift.storeId !== storeId) throw new HttpError(403, 40320, '未开班次')
      let amountFen = body.amountFen
      if (typeof amountFen === 'string') amountFen = yuanToFen(amountFen, settingsOf(db, storeId).singleMaxFen)
      if (!Number.isInteger(amountFen) || amountFen <= 0) {
        throw new HttpError(400, 40012, '金额非法：必须为正整数分（超过两位小数一律拒绝）')
      }
      const settings = settingsOf(db, storeId)
      if (amountFen > settings.singleMaxFen) throw new HttpError(400, 42901, '金额超出单笔上限')
      const clientRequestId = String(body.clientRequestId || '').trim()
      if (!clientRequestId) throw new HttpError(400, 40022, '缺少 clientRequestId')
      const codeType = String(body.codeType || 'MOCK').toUpperCase()
 if (['WECHAT', 'ALIPAY'].includes(codeType)) throw new HttpError(503,50301, '真实支付渠道不可用')
 const existed = db
        .prepare('SELECT * FROM orders WHERE storeId = ? AND clientRequestId = ?')
        .get(storeId, clientRequestId)
      if (existed) {
        const same = existed.createdById === ctx.user.id &&
          existed.amountFen === amountFen &&
          existed.codeType === codeType &&
          (existed.subject || '') === (body.subject || '') &&
          (existed.remark || '') === (body.remark || '')
        if (!same) throw new HttpError(409, 40909, '请求标识与已有订单冲突')
        return { status: 200, data: { ...orderView(existed), idempotent: true, payload: existed.codeType === 'CASH' ? { kind: 'NONE' } : channelMockPayload(existed) } }
      }

      if (!['WECHAT', 'ALIPAY', 'CASH', 'MOCK'].includes(codeType)) throw new HttpError(400, 40023, '不支持的收款方式')
      const ts = nowIso()
      const seqRow = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE storeId = ?').get(storeId)
      const seq = Number(seqRow.c) + 1
      const d = new Date(ts)
      const pad = (n) => String(n).padStart(2, '0')
      const orderNo = `SC${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(seq).padStart(6, '0')}`
      const order = {
        id: newId('ord'),
        storeId,
        orderNo,
        clientRequestId,
        amountFen,
        status: 'PENDING',
        codeType,
        channelCode: codeType === 'CASH' ? 'cash' : 'mock',
        subject: body.subject || '',
        remark: body.remark || '',
        shiftId: shift.id,
        createdById: ctx.user.id,
        createdAt: ts,
        nextQueryAt: codeType === 'CASH' ? null : new Date(Date.now() + settings.queryBackoffMs[0]).toISOString(),
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(
          `INSERT INTO orders(id, storeId, orderNo, clientRequestId, amountFen, status, codeType, channelCode, subject, remark, shiftId, createdById, createdAt, nextQueryAt)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          order.id, storeId, order.orderNo, clientRequestId, amountFen, order.status, order.codeType,
          order.channelCode, order.subject, order.remark, order.shiftId, order.createdById, ts, order.nextQueryAt,
        )
        addEvent(db, order.id, null, 'PENDING', 'UI', ctx.user.id, '订单创建')
        if (codeType === 'CASH') {
          db.prepare("UPDATE orders SET status = 'PAID', paidAt = ? WHERE id = ?").run(ts, order.id)
          addEvent(db, order.id, 'PENDING', 'PAID', 'UI', ctx.user.id, '现金收款当场入账')
          order.status = 'PAID'
        } else {
          db.prepare("UPDATE orders SET status = 'PAYING' WHERE id = ?").run(order.id)
          addEvent(db, order.id, 'PENDING', 'PAYING', 'UI', ctx.user.id, '渠道下单成功，等待顾客付款')
          order.status = 'PAYING'
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return {
        status: 201,
        data: {
          ...orderView(order),
          payload: codeType === 'CASH' ? { kind: 'NONE' } : channelMockPayload(order),
          pollIntervalMs: settings.queryBackoffMs[0],
          expireAt: new Date(Date.now() + settings.orderExpireMinutes * 60000).toISOString(),
        },
      }
    }

    const statusMatch = p.match(/^\/api\/cashier\/orders\/([^/]+)\/status$/)
    if (m === 'GET' && statusMatch) {
      const storeId = requireStore(ctx)
      let order = orderRow(db, storeId, statusMatch[1])
      if (!order) throw new HttpError(404, 40401, '订单不存在')
      if (ctx.user.role === 'CASHIER' && order.createdById !== ctx.user.id) {
        throw new HttpError(403, 40312, '只能查看本人订单')
      }
      const expireAt = new Date(order.createdAt).getTime() + settingsOf(db, storeId).orderExpireMinutes * 60000
      const open = order.status === 'PENDING' || order.status === 'PAYING'
      if (open && Date.now() >= expireAt) {
        const updated = db
          .prepare("UPDATE orders SET status = 'CLOSED', closedAt = ?, nextQueryAt = NULL WHERE id = ? AND status IN ('PENDING','PAYING')")
          .run(nowIso(), order.id)
        if (updated.changes) {
          addEvent(db, order.id, order.status, 'CLOSED', 'SCHEDULER', null, '超过订单有效期，自动关单')
          order = orderRow(db, storeId, order.orderNo)
        }
      }
      const late = order.status === 'CLOSED' && order.channelOrderNo
      return {
        status: 200,
        data: {
          orderNo: order.orderNo,
          status: order.status,
          amountFen: order.amountFen,
          paidAt: order.paidAt,
          exceptionReason: order.exceptionReason,
          nextQueryAt: order.nextQueryAt,
          attempt: order.attempt,
          lateProbe: late,
        },
      }
    }

    if (m === 'POST' && p === '/api/channels/mock/confirm') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const order = orderRow(db, storeId, body.orderNo)
      if (!order) throw new HttpError(404, 40401, '订单不存在')
      if (order.codeType !== 'MOCK' || order.channelCode !== 'mock') throw new HttpError(409,40919, '只能确认模拟订单')
 const amountFenPaid = body.kind === 'AMOUNT_MISMATCH' ? order.amountFen - 1 : order.amountFen
      if (body.kind === 'LATE_SUCCESS' && ['PENDING', 'PAYING'].includes(order.status)) {
        db.prepare("UPDATE orders SET status = 'CLOSED', closedAt = ?, nextQueryAt = NULL, channelOrderNo = ? WHERE id = ? AND status IN ('PENDING','PAYING')").run(
          nowIso(),
          `MOCKLATE${Date.now()}`,
          order.id,
        )
        addEvent(db, order.id, order.status, 'CLOSED', 'SCHEDULER', null, '演示：模拟超时关单')
      }
      const refreshed = orderRow(db, storeId, body.orderNo)
      const decision = applyChannelResult(
        db,
        ctx,
        refreshed,
        { status: 'SUCCESS', amountFen: amountFenPaid, channelOrderNo: `MOCK${Date.now()}` },
        'CALLBACK',
      )
      const after = orderRow(db, storeId, body.orderNo)
      return {
        status: 200,
        data: {
          orderNo: after.orderNo,
          status: after.status,
          wouldGoTo: decision.to,
          exceptionReason: after.exceptionReason,
          note: decision.note,
        },
      }
    }

    if (m === 'GET' && p === '/api/orders') {
      const storeId = requireStore(ctx)
      const q = url.searchParams
      const clauses = ['storeId = ?']
      const params = [storeId]
      if (ctx.user.role === 'CASHIER') {
        clauses.push('createdById = ?')
        params.push(ctx.user.id)
      }
      if (q.get('status')) {
        clauses.push('status = ?')
        params.push(q.get('status'))
      }
      if (q.get('shiftId')) {
        clauses.push('shiftId = ?')
        params.push(q.get('shiftId'))
      }
      if (q.get('kw')) {
        clauses.push('(orderNo LIKE ? OR channelOrderNo LIKE ? OR remark LIKE ? OR subject LIKE ?)')
        const like = `%${q.get('kw')}%`
        params.push(like, like, like, like)
      }
      const page = Math.max(1, Number(q.get('page') || 1))
      const pageSize = Math.min(200, Math.max(1, Number(q.get('pageSize') || 20)))
      const where = clauses.join(' AND ')
      const total = db.prepare(`SELECT COUNT(*) AS c FROM orders WHERE ${where}`).get(...params).c
      const rows = db
        .prepare(`SELECT * FROM orders WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, (page - 1) * pageSize)
      return { status: 200, data: { total, page, pageSize, rows: rows.map(orderView) } }
    }

    const detailMatch = p.match(/^\/api\/orders\/([^/]+)$/)
    if (m === 'GET' && detailMatch) {
      const storeId = requireStore(ctx)
      const order = orderRow(db, storeId, detailMatch[1])
      if (!order) throw new HttpError(404, 40401, '订单不存在')
      if (ctx.user.role === 'CASHIER' && order.createdById !== ctx.user.id) {
        throw new HttpError(403, 40312, '只能查看本人订单')
      }
      const events = db.prepare('SELECT * FROM order_events WHERE orderId = ? ORDER BY createdAt').all(order.id)
      const refunds = db.prepare('SELECT * FROM refunds WHERE orderId = ? ORDER BY createdAt').all(order.id)
      return { status: 200, data: { ...orderView(order), events, refunds } }
    }

    if (m === 'GET' && p === '/api/exceptions') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const rows = db.prepare("SELECT * FROM orders WHERE storeId = ? AND status = 'EXCEPTION' ORDER BY createdAt DESC").all(storeId)
      return {
        status: 200,
        data: {
          rows: rows.map(orderView),
          reasons: ['AMOUNT_MISMATCH', 'LATE_SUCCESS', 'NO_CALLBACK', 'PARSE_FAIL', 'MANUAL', 'REFUND_FAILED'],
        },
      }
    }

    const resolveMatch = p.match(/^\/api\/exceptions\/([^/]+)\/resolve$/)
    if (m === 'POST' && resolveMatch) {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const order = orderRow(db, storeId, resolveMatch[1])
      if (!order) throw new HttpError(404, 40401, '订单不存在')
      if (order.status !== 'EXCEPTION') throw new HttpError(409, 40907, '该订单不在异常态')
      if (!body.confirmPassword) throw new HttpError(400, 40002, '敏感操作需要口令二次确认')
      if (!verifyPassword(String(body.confirmPassword), ctx.user.passwordHash)) {
        throw new HttpError(403, 40311, '二次确认口令错误')
      }
      const note = String(body.note || '').trim()
      if (!note) throw new HttpError(400, 40024, '必须填写处理说明')
      const action = body.action
      if (!['RECORD_IN', 'IGNORE'].includes(action)) throw new HttpError(400, 40001, '未知处理动作')
      const to = action === 'RECORD_IN' ? 'PAID' : 'CLOSED'
      const updated = db
        .prepare('UPDATE orders SET status = ?, exceptionReason = NULL, paidAt = ?, reviewedById = ? WHERE id = ? AND status = ?')
        .run(to, to === 'PAID' ? nowIso() : null, ctx.user.id, order.id, 'EXCEPTION')
      if (updated.changes === 0) throw new HttpError(409, 40910, '订单状态已被其他请求改变')
      addEvent(db, order.id, 'EXCEPTION', to, 'MANUAL', ctx.user.id, note)
      appendAudit(db, {
        ts: nowIso(),
        orgId: ctx.orgId,
        storeId,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        action: action === 'RECORD_IN' ? 'EXCEPTION_RECORD_IN' : 'EXCEPTION_IGNORE',
        targetType: 'ORDER',
        targetId: order.orderNo,
        beforeJson: JSON.stringify({ status: 'EXCEPTION', reason: order.exceptionReason }),
        afterJson: JSON.stringify({ status: to, note }),
        amountFen: order.amountFen,
      })
      return { status: 200, data: { orderNo: order.orderNo, status: to } }
    }

    if (m === 'GET' && p === '/api/channels') {
      const storeId = requireStore(ctx)
      return { status: 200, data: db.prepare('SELECT * FROM channels WHERE storeId = ? ORDER BY code').all(storeId) }
    }

    const credMatch = p.match(/^\/api\/channels\/([^/]+)\/credentials$/)
    if (m === 'PUT' && credMatch) {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const channel = db.prepare('SELECT * FROM channels WHERE storeId = ? AND code = ?').get(storeId, credMatch[1])
      if (!channel) throw new HttpError(404, 40401, '渠道不存在')
      if (!verifyPassword(String(body.confirmPassword || ''), ctx.user.passwordHash)) {
        throw new HttpError(403, 40311, '二次确认口令错误')
      }
      const missing = ['appid', 'mchid', 'privateKeyPem', 'apiV3Key'].filter((k) => !String(body[k] || '').trim())
      if (missing.length) throw new HttpError(400, 40001, `凭据不完整：缺少 ${missing.join(' / ')}`)
      const mask = (text) => `${String(text).slice(0, 3)}******${String(text).slice(-3)}`
      db.prepare(
        'UPDATE channels SET configured = 1, lastCheckAt = ?, lastCheckOk = 0, lastCheckMsg = ?, credentialMask = ? WHERE id = ?',
      ).run(
        nowIso(),
        '演示模式：凭据未落库，也未连接真实渠道',
        JSON.stringify({ appid: mask(body.appid), mchid: mask(body.mchid) }),
        channel.id,
      )
      appendAudit(db, {
        ts: nowIso(),
        orgId: ctx.orgId,
        storeId,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        action: 'CHANNEL_CREDENTIAL_SUBMIT',
        targetType: 'CHANNEL',
        targetId: channel.code,
        afterJson: JSON.stringify({ configured: true, demoOnly: true }),
      })
      const after = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id)
      return {
        status: 200,
        data: { ...after, masked: JSON.parse(after.credentialMask || '{}') },
      }
    }

    const checkMatch = p.match(/^\/api\/channels\/([^/]+)\/check$/)
    if (m === 'POST' && checkMatch) {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const channel = db.prepare('SELECT * FROM channels WHERE storeId = ? AND code = ?').get(storeId, checkMatch[1])
      if (!channel) throw new HttpError(404, 40401, '渠道不存在')
      const ok = channel.code === 'mock' ? 1 : 0
      const msg = ok ? '演示渠道自检通过' : '演示模式不连接真实渠道，自检不可用'
      db.prepare('UPDATE channels SET lastCheckAt = ?, lastCheckOk = ?, lastCheckMsg = ? WHERE id = ?').run(nowIso(), ok, msg, channel.id)
      return { status: 200, data: db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id) }
    }

    if (m === 'GET' && p === '/api/settings') {
      const storeId = requireStore(ctx)
      return { status: 200, data: settingsOf(db, storeId) }
    }

    if (m === 'PUT' && p === '/api/settings') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      return { status: 200, data: saveSettings(db, storeId, body, { ...ctx.user, orgId: ctx.orgId }) }
    }

    if (m === 'GET' && p === '/api/users') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const rows = db
        .prepare(
          `SELECT u.id, u.username, u.displayName, u.role, u.status FROM users u
           JOIN store_members m ON m.userId = u.id WHERE m.storeId = ? ORDER BY u.createdAt`,
        )
        .all(storeId)
      return { status: 200, data: rows }
    }

    if (m === 'POST' && p === '/api/users') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const username = String(body.username || '').trim().toLowerCase()
      const displayName = String(body.displayName || '').trim()
      const password = String(body.password || '')
      const role = body.role === 'MANAGER' ? 'MANAGER' : 'CASHIER'
      if (!/^[a-z0-9_]{4,20}$/.test(username)) throw new HttpError(400, 40021, '登录名需 4-20 位小写字母、数字或下划线')
      if (!displayName) throw new HttpError(400, 40025, '请填写员工姓名')
      const verdict = checkPassword(password, username)
      if (!verdict.ok) throw new HttpError(400, 40011, `口令不符合要求：${verdict.failed.join('、')}`)
      const exists = db.prepare('SELECT id FROM users WHERE orgId = ? AND username = ?').get(ctx.orgId, username)
      if (exists) throw new HttpError(409, 40912, '登录名已存在')
      const id = newId('user')
      const ts = nowIso()
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare(
          'INSERT INTO users(id, orgId, username, displayName, passwordHash, role, status, mustChangePwd, createdAt) VALUES(?,?,?,?,?,?,?,?,?)',
        ).run(id, ctx.orgId, username, displayName, hashPassword(password), role, 'ACTIVE', 1, ts)
        db.prepare('INSERT INTO store_members(storeId, userId) VALUES(?, ?)').run(storeId, id)
        appendAudit(db, {
          ts,
          orgId: ctx.orgId,
          storeId,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          action: 'USER_CREATE',
          targetType: 'USER',
          targetId: username,
          afterJson: JSON.stringify({ role, displayName }),
        })
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { status: 201, data: { id, username, displayName, role, status: 'ACTIVE' } }
    }

    if (m === 'GET' && p === '/api/platform/stores') {
      requireManager(ctx)
      const stores = db.prepare('SELECT * FROM stores WHERE orgId = ? ORDER BY createdAt').all(ctx.orgId)
      return { status: 200, data: stores }
    }

    if (m === 'POST' && p === '/api/platform/stores') {
      if (ctx.user.role !== 'OWNER') throw new HttpError(403, 40313, '只有平台所有者可新建门店')
      const name = String(body.name || '').trim()
      if (!name || name.length > 60) throw new HttpError(400, 40020, '门店名称必填且不超过 60 字')
      const count = db.prepare('SELECT COUNT(*) AS c FROM stores WHERE orgId = ?').get(ctx.orgId).c
      const id = newId('store')
      const ts = nowIso()
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO stores(id, orgId, name, code, timezone, status, createdAt) VALUES(?,?,?,?,?,?,?)').run(
          id, ctx.orgId, name, `S${String(count + 1).padStart(3, '0')}`, 'Asia/Shanghai', 'ACTIVE', ts,
        )
        for (const code of ['mock', 'wechat', 'alipay']) {
          db.prepare('INSERT INTO channels(id, storeId, code, name, mode, enabled, configured, lastCheckMsg) VALUES(?,?,?,?,?,?,?,?)').run(
            newId('ch'), id, code,
            code === 'mock' ? '模拟渠道' : code === 'wechat' ? '微信支付' : '支付宝',
            'DIRECT', code === 'mock' ? 1 : 0, code === 'mock' ? 1 : 0,
            code === 'mock' ? '演示渠道可用' : '未配置（演示模式不接真实渠道）',
          )
        }
        appendAudit(db, {
          ts, orgId: ctx.orgId, storeId: id, actorId: ctx.user.id, actorRole: ctx.user.role,
          action: 'STORE_CREATE', targetType: 'STORE', targetId: id, afterJson: JSON.stringify({ name }),
        })
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
      return { status: 201, data: db.prepare('SELECT * FROM stores WHERE id = ?').get(id) }
    }

    if (m === 'GET' && p === '/api/audit') {
      requireManager(ctx)
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)))
 const owner = ctx.user.role === 'OWNER'
 const rows = owner
 ? db.prepare('SELECT id, ts, storeId, actorId, actorRole, action, targetType, targetId, amountFen, hash, prevHash FROM audit_logs WHERE orgId = ? ORDER BY id DESC LIMIT ?').all(ctx.orgId, limit)
 : db.prepare('SELECT id, ts, storeId, actorId, actorRole, action, targetType, targetId, amountFen FROM audit_logs WHERE orgId = ? AND storeId = ? ORDER BY id DESC LIMIT ?').all(ctx.orgId, requireStore(ctx), limit)
 const chain = owner ? verifyAuditChain(db, ctx.orgId) : null
      return { status: 200, data: { rows, chain } }
    }

if (m === 'GET' && p === '/api/audit/verify') {
 if (ctx.user.role !== 'OWNER') throw new HttpError(403,40313, '仅所有者可验证机构审计链')
      return { status: 200, data: verifyAuditChain(db, ctx.orgId) }
    }

    if (m === 'GET' && p === '/api/refunds') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const rows = db
        .prepare(
          `SELECT r.*, o.orderNo, o.amountFen AS orderAmountFen
           FROM refunds r JOIN orders o ON o.id = r.orderId
           WHERE r.storeId = ? ORDER BY r.createdAt DESC LIMIT 200`,
        )
        .all(storeId)
      return { status: 200, data: rows }
    }

    if (m === 'POST' && p === '/api/refunds') {
 throw new HttpError(503,50301, '退款申请不可用')
 }

 const approveMatch = p.match(/^\/api\/refunds\/([^/]+)\/approve$/)
    if (m === 'POST' && approveMatch) {
      const storeId = requireStore(ctx)
      if (ctx.user.role !== 'OWNER') throw new HttpError(403, 40313, '退款审批仅平台所有者可执行')
      const refund = db
        .prepare("SELECT * FROM refunds WHERE storeId = ? AND refundNo = ?")
        .get(storeId, approveMatch[1])
      if (!refund) throw new HttpError(404, 40401, '退款单不存在')
      if (refund.status !== 'PENDING') throw new HttpError(409, 40914, '退款单不在待审批状态')
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(refund.orderId)
      if (!order || order.status !== 'PAID') throw new HttpError(409, 40915, '订单状态不允许退款')
      throw new HttpError(503,50301, '退款结算不可用，无法审批')
 }

 if (m === 'POST' && p.startsWith('/api/refunds/') && p.endsWith('/settle')) {
 throw new HttpError(503,50301, '退款结算不可用')
 }

 if (m === 'GET' && p === '/api/exports/orders.csv') {
      const storeId = requireStore(ctx)
      requireManager(ctx)
      const rows = db.prepare('SELECT * FROM orders WHERE storeId = ? ORDER BY createdAt DESC LIMIT 5000').all(storeId)
      const head = ['订单号', '金额(元)', '方式', '状态', '异常原因', '渠道单号', '备注', '创建时间']
      const lines = rows.map((o) => [
        o.orderNo,
        fenToYuan(o.amountFen),
        o.codeType,
        o.status,
        o.exceptionReason || '',
        o.channelOrderNo || '',
        o.remark || '',
        o.createdAt,
      ])
      return { status: 200, raw: toCsv(head, lines), contentType: 'text/csv; charset=utf-8' }
    }

    throw new HttpError(404, 40401, '接口不存在')
  }

  return { route, resolveSession: (token) => resolveSession(db, token) }
}

export function seedDemo(db) {
  const org = db.prepare('SELECT id FROM organizations LIMIT 1').get()
  if (org) return null
  const ts = nowIso()
  const orgId = newId('org')
  const storeId = newId('store')
  const ownerId = newId('user')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('INSERT INTO organizations(id, name, code, status, createdAt) VALUES(?,?,?,?,?)').run(
      orgId, '示例连锁机构（演示数据）', 'DEMO', 'ACTIVE', ts,
    )
    db.prepare('INSERT INTO stores(id, orgId, name, code, timezone, status, createdAt) VALUES(?,?,?,?,?,?,?)').run(
      storeId, orgId, '示例便利店（演示数据）', 'S001', 'Asia/Shanghai', 'ACTIVE', ts,
    )
    db.prepare(
      'INSERT INTO users(id, orgId, username, displayName, passwordHash, role, status, mustChangePwd, createdAt) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(ownerId, orgId, 'owner', '店主', hashPassword('Shop2026test'), 'OWNER', 'ACTIVE', 0, ts)
    db.prepare('INSERT INTO store_members(storeId, userId) VALUES(?, ?)').run(storeId, ownerId)
    const staffId = newId('user')
    db.prepare(
      'INSERT INTO users(id, orgId, username, displayName, passwordHash, role, status, mustChangePwd, createdAt) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(staffId, orgId, 'staff', '小王', hashPassword('Staff2026test'), 'CASHIER', 'ACTIVE', 0, ts)
    db.prepare('INSERT INTO store_members(storeId, userId) VALUES(?, ?)').run(storeId, staffId)
    for (const code of ['mock', 'wechat', 'alipay']) {
      db.prepare('INSERT INTO channels(id, storeId, code, name, mode, enabled, configured, lastCheckMsg) VALUES(?,?,?,?,?,?,?,?)').run(
        newId('ch'), storeId, code,
        code === 'mock' ? '模拟渠道' : code === 'wechat' ? '微信支付' : '支付宝',
        'DIRECT', code === 'mock' ? 1 : 0, code === 'mock' ? 1 : 0,
        code === 'mock' ? '演示渠道可用' : '未配置（演示模式不接真实渠道）',
      )
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { orgId, storeId, ownerId }
}
