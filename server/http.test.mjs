import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

async function freePort() {
 for (;;) {
 const probe = createServer()
 probe.listen(0, '127.0.0.1')
 await once(probe, 'listening')
 const port = probe.address().port
 await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()))
 if (port !==5199) return port
 }
}

test('HTTP isolation, authentication, cash orders and unavailable payment operations', async (t) => {
 const port = await freePort()
 const child = spawn(process.execPath, [fileURLToPath(new URL('./index.mjs', import.meta.url))], {
 env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_FILE: ':memory:', SEED_DEMO: '0' },
 stdio: ['ignore', 'pipe', 'pipe'],
 })
 let output = ''
 child.stdout.setEncoding('utf8')
 child.stderr.setEncoding('utf8')
 child.stdout.on('data', (chunk) => { output += chunk })
 child.stderr.on('data', (chunk) => { output += chunk })
 t.after(async () => {
 if (child.exitCode === null && child.signalCode === null) {
 child.kill()
 await once(child, 'exit')
 }
 })
 const base = `http://127.0.0.1:${port}`
 for (let i =0; i <100 && !output.includes('listening on'); i++) {
 if (child.exitCode !== null) throw new Error(`Server exited: ${output}`)
 await new Promise((resolve) => setTimeout(resolve,50))
 }
 assert.match(output, /listening on/)
 async function request(path, { method = 'GET', body, token, raw } = {}) {
 const response = await fetch(base + path, {
 method,
 headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}) },
 body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
 })
 return { status: response.status, body: await response.json() }
 }
 const post = (path, body, token) => request(path, { method: 'POST', body, token })
 assert.equal((await request('/api/auth/me')).status,401)
 assert.equal((await request('/api/bootstrap/state')).body.data.setupDone, false)
 assert.equal((await post('/api/bootstrap/setup', { orgName: 'Test', storeName: 'One', username: 'owner', password: 'weak' })).status,400)
 const setup = { orgName: 'Test', storeName: 'One', username: 'owner', password: 'Shop2026test' }
 assert.equal((await post('/api/bootstrap/setup', setup)).status,201)
 assert.equal((await post('/api/bootstrap/setup', setup)).status,409)
 assert.equal((await post('/api/auth/login', { username: 'owner', password: 'bad' })).status,401)
 const login = await post('/api/auth/login', setup)
 assert.equal(login.status,200)
 const token = login.body.data.token
 const firstStore = login.body.data.storeId
 assert.equal((await request('/api/auth/me', { token })).body.data.storeId, firstStore)
 assert.equal((await request('/api/auth/me', { token: 'invalid' })).status,401)
 assert.equal((await request('/api/shifts/open', { method: 'POST', token, raw: '{' })).status,400)
 assert.equal((await post('/api/shifts/open', {}, token)).status,201)
 const cash = { codeType: 'cash', amountFen:125, clientRequestId: 'cash-1' }
 const created = await post('/api/cashier/orders', cash, token)
 assert.equal(created.status,201)
 assert.equal(created.body.data.status, 'PAID')
 const orderNo = created.body.data.orderNo
 const retry = await post('/api/cashier/orders', cash, token)
 assert.equal(retry.status,200)
 assert.equal(retry.body.data.orderNo, orderNo)
 assert.equal(retry.body.data.idempotent, true)
 assert.equal((await post('/api/cashier/orders', { ...cash, amountFen:126 }, token)).status,409)
 for (const codeType of ['WECHAT', 'ALIPAY']) {
 assert.equal((await post('/api/cashier/orders', { codeType, amountFen:100, clientRequestId: codeType }, token)).status,503)
 }
 assert.equal((await post('/api/channels/mock/confirm', { orderNo }, token)).status,409)
 const refund = await post('/api/refunds', { orderNo, amountFen:125, reason: 'test' }, token)
 assert.equal(refund.status,503)
 assert.equal(refund.body.message, '退款申请不可用')
 assert.equal((await post('/api/refunds/legacy/settle', { result: 'SUCCESS' }, token)).status,503)
 assert.deepEqual((await request('/api/refunds', { token })).body.data, [])
 assert.equal((await request(`/api/orders/${orderNo}`, { token })).body.data.status, 'PAID')
 const second = await post('/api/platform/stores', { name: 'Two' }, token)
 assert.equal(second.status,201)
 assert.equal((await post('/api/auth/switch-store', { storeId: second.body.data.id }, token)).status,403)
 assert.equal((await request(`/api/orders/${orderNo}`, { token })).status,200)
 assert.equal((await request('/api/orders', { token })).body.data.total,1)
 assert.equal((await post('/api/auth/logout', {}, token)).status,200)
 assert.equal((await request('/api/auth/me', { token })).status,401)
})
