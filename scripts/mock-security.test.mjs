import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, handle } from '../tools/mock-server.js'

const call = (db, method, path, body = {}) => handle(db, method, `/api${path}`, body)
const login = (db, username, password) => call(db, 'POST', '/auth/login', { username, password })

test('successful mock login supplies the token required by the login view', () => {
 const db = createSeed()
 call(db, 'POST', '/auth/logout')
 const response = login(db, 'owner', 'Shop2026test')
 assert.equal(response.status,200)
 assert.equal(typeof response.body.data.token, 'string')
 assert.ok(response.body.data.token.length >0)
 assert.equal(call(db, 'GET', '/auth/me').body.data.user.username, 'owner')
 assert.equal(call(db, 'GET', '/dashboard/summary').status,200)
})

test('current user response excludes credentials', () => {
 const db = createSeed()
 const response = call(db, 'GET', '/auth/me')
 assert.equal(response.status,200)
 assert.equal(response.body.data.user.username, 'owner')
 assert.equal('pwd' in response.body.data.user, false)
})

test('anonymous queries and status polling require authentication without mutation', () => {
 const db = createSeed()
 call(db, 'POST', '/shifts/open')
 const order = call(db, 'POST', '/cashier/orders', { amountFen:100, clientRequestId: 'anonymous-test' }).body.data
 db.orders[0].nextQueryAt = new Date(0).toISOString()
 call(db, 'POST', '/auth/logout')
 const before = structuredClone(db.orders[0])
 for (const path of ['/shifts', '/orders', `/orders/${order.orderNo}`, '/dashboard/summary', `/cashier/orders/${order.orderNo}/status`]) {
 assert.equal(call(db, 'GET', path).status,401, path)
 }
 assert.deepEqual(db.orders[0], before)
})

test('idempotency retries require matching user, shift and order fields', () => {
 const db = createSeed()
 call(db, 'POST', '/shifts/open')
 const body = { amountFen:100, codeType: 'CASH', clientRequestId: 'collision', subject: 'sale', remark: 'note' }
 const first = call(db, 'POST', '/cashier/orders', body)
 assert.equal(first.status,201)
 assert.equal(call(db, 'POST', '/cashier/orders', body).body.data.orderNo, first.body.data.orderNo)
 for (const change of [{ amountFen:101 }, { codeType: 'WECHAT' }, { subject: 'other' }, { remark: 'other' }]) {
 const result = call(db, 'POST', '/cashier/orders', { ...body, ...change })
 assert.equal(result.status,409)
 assert.equal(result.body.data, null)
 }
 login(db, 'staff', 'Staff2026test')
 call(db, 'POST', '/shifts/open')
 const collision = call(db, 'POST', '/cashier/orders', body)
 assert.equal(collision.status,409)
 assert.equal(collision.body.data, null)
 assert.equal(db.orders.length,1)
})

test('cashier status polling respects order visibility', () => {
 const db = createSeed()
 call(db, 'POST', '/shifts/open')
 const order = call(db, 'POST', '/cashier/orders', { amountFen:100 }).body.data
 login(db, 'staff', 'Staff2026test')
 call(db, 'POST', '/shifts/open')
 assert.equal(call(db, 'GET', `/cashier/orders/${order.orderNo}/status`).status,403)
})
