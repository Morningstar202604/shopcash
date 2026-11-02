import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openDatabase, appendAudit } from './db.mjs'
import { createApp, seedDemo, createSession } from './app.mjs'

function fixture() {
 const db = openDatabase(':memory:')
 const seeded = seedDemo(db)
 const app = createApp({ db })
 const ctx = () => app.resolveSession(token)
 const token = createSession(db, seeded.ownerId)
 return { db, app, seeded, ctx }
}

function rejected(fn, status) {
 assert.throws(fn, (error) => error.status === status)
}

test('startup does not seed demo by default and reset is unavailable even with isolation token', () => {
 assert.match(readFileSync(new URL('./index.mjs', import.meta.url), 'utf8'), /SEED_DEMO\s*===\s*['"]1['"]/)
 const { db, app, ctx } = fixture()
 const previous = process.env.SHOPCASH_ISOLATION_TOKEN
 process.env.SHOPCASH_ISOLATION_TOKEN = 'test'
 try {
 rejected(() => app.route('POST', '/api/__test/reset', {}, null),401)
 rejected(() => app.route('POST', '/api/__test/reset?setup=0', {}, ctx()),404)
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2)
 } finally {
 if (previous === undefined) delete process.env.SHOPCASH_ISOLATION_TOKEN
 else process.env.SHOPCASH_ISOLATION_TOKEN = previous
 db.close()
 }
})

test('real channels cannot create mock orders or be confirmed via mock', () => {
 const { db, app, seeded, ctx } = fixture()
 try {
 app.route('POST', '/api/shifts/open', {}, ctx())
 for (const codeType of ['WECHAT', 'ALIPAY']) {
 rejected(() => app.route('POST', '/api/cashier/orders', { codeType, amountFen:100, clientRequestId: codeType }, ctx()),503)
 }
 const order = app.route('POST', '/api/cashier/orders', { codeType: 'MOCK', amountFen:100, clientRequestId: 'mock' }, ctx()).data
 db.prepare("UPDATE orders SET codeType = 'WECHAT' WHERE orderNo = ?").run(order.orderNo)
 rejected(() => app.route('POST', '/api/channels/mock/confirm', { orderNo: order.orderNo }, ctx()),409)
 assert.equal(db.prepare('SELECT status FROM orders WHERE orderNo = ?').get(order.orderNo).status, 'PAYING')
 } finally { db.close() }
})

test('refund requests fail closed for every role without reserving balance', () => {
 const { db, app, seeded, ctx } = fixture()
 try {
 app.route('POST', '/api/shifts/open', {}, ctx())
 const order = app.route('POST', '/api/cashier/orders', { codeType: 'CASH', amountFen:100, clientRequestId: 'disabled-refund' }, ctx()).data
 const staffId = db.prepare("SELECT id FROM users WHERE role = 'CASHIER'").get().id
 const token = createSession(db, staffId)
 const audits = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n
 for (const role of ['OWNER', 'MANAGER', 'CASHIER', 'VIEWER']) {
 db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, staffId)
 for (let i =0; i <2; i++) {
 rejected(() => app.route('POST', '/api/refunds', { orderNo: order.orderNo, amountFen:100, reason:'test' }, app.resolveSession(token)),503)
 }
 }
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refunds').get().n,0)
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n, audits)
 assert.equal(db.prepare('SELECT status FROM orders WHERE orderNo = ?').get(order.orderNo).status, 'PAID')
 assert.ok(seeded.ownerId)
 } finally { db.close() }
})

test('unavailable approval does not check confirmation passwords', () => {
 const { db, app, seeded, ctx } = fixture()
 try {
 app.route('POST', '/api/shifts/open', {}, ctx())
 const order = app.route('POST', '/api/cashier/orders', { codeType:'CASH', amountFen:100, clientRequestId:'approval-disabled' }, ctx()).data
 const orderId = db.prepare('SELECT id FROM orders WHERE orderNo = ?').get(order.orderNo).id
 db.prepare('INSERT INTO refunds(id, storeId, refundNo, orderId, amountFen, status, reason, initiatedById, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run('legacy-refund', seeded.storeId, 'legacy-refund', orderId,100, 'PENDING', 'test', seeded.ownerId, '2026-01-01', '2026-01-01')
 for (const confirmPassword of [undefined, 'incorrect', 'Shop2026test']) {
 rejected(() => app.route('POST', '/api/refunds/legacy-refund/approve', { confirmPassword }, ctx()),503)
 }
 assert.equal(db.prepare('SELECT status FROM refunds WHERE id = ?').get('legacy-refund').status, 'PENDING')
 assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId).status, 'PAID')
 } finally { db.close() }
})

test('cross-store shifts cannot be used or leaked and manager audit is store scoped', () => {
 const { db, app, seeded, ctx } = fixture()
 try {
 const shift = app.route('POST', '/api/shifts/open', {}, ctx()).data
 const second = app.route('POST', '/api/platform/stores', { name: 'Second' }, ctx()).data
 db.prepare('INSERT INTO store_members(storeId, userId) VALUES (?, ?)').run(second.id, seeded.ownerId)
 app.route('POST', '/api/auth/switch-store', { storeId: second.id }, ctx())
 assert.equal(app.route('GET', '/api/dashboard/summary', {}, ctx()).data.shiftOpen, false)
 rejected(() => app.route('POST', '/api/cashier/orders', { codeType: 'CASH', amountFen:100, clientRequestId: 'cross' }, ctx()),403)
 db.prepare("UPDATE users SET role = 'MANAGER' WHERE id = ?").run(seeded.ownerId)
 appendAudit(db, { ts: new Date().toISOString(), orgId: seeded.orgId, storeId: seeded.storeId, action: 'SECRET', targetType: 'TEST' })
 const audit = app.route('GET', '/api/audit', {}, ctx()).data
 assert.ok(audit.rows.every((row) => row.storeId === second.id))
 rejected(() => app.route('GET', '/api/audit/verify', {}, ctx()),403)
 assert.ok(shift.id)
 } finally { db.close() }
})
