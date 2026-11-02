import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { isolatedTarget } from './test-target.mjs'

test('invalid tokens and port5199 are rejected before fetch; mismatched identity is rejected', async () => {
 const originalFetch = globalThis.fetch
 const oldBase = process.env.SHOPCASH_TEST_BASE
 const oldToken = process.env.SHOPCASH_TEST_TOKEN
 let requests =0
 globalThis.fetch = async (url, options) => {
 requests++
 assert.equal(url, 'http://127.0.0.1:12345/__shopcash_isolation')
 assert.equal(options.redirect, 'error')
 return { ok: true, text: async () => 'b'.repeat(64) }
 }
 try {
 process.env.SHOPCASH_TEST_BASE = 'http://127.0.0.1:12345'
 for (const token of ['bad', 'g'.repeat(64), 'a'.repeat(63)]) {
 process.env.SHOPCASH_TEST_TOKEN = token
 await assert.rejects(isolatedTarget(), /隔离测试目标未配置/)
 }
 process.env.SHOPCASH_TEST_TOKEN = 'a'.repeat(64)
 process.env.SHOPCASH_TEST_BASE = 'http://127.0.0.1:5199'
 await assert.rejects(isolatedTarget(), /隔离测试目标无效/)
 assert.equal(requests,0)
 process.env.SHOPCASH_TEST_BASE = 'http://127.0.0.1:12345'
 await assert.rejects(isolatedTarget(), /身份校验失败/)
 assert.equal(requests,1)
 } finally {
 globalThis.fetch = originalFetch
 if (oldBase === undefined) delete process.env.SHOPCASH_TEST_BASE
 else process.env.SHOPCASH_TEST_BASE = oldBase
 if (oldToken === undefined) delete process.env.SHOPCASH_TEST_TOKEN
 else process.env.SHOPCASH_TEST_TOKEN = oldToken
 }
})

for (const script of ['api-rules-check.mjs', 'ui-check.mjs']) {
 test(`${script} rejects absent credentials without connecting`, () => {
 const env = { ...process.env, BASE: 'http://127.0.0.1:1' }
 delete env.SHOPCASH_TEST_BASE
 delete env.SHOPCASH_TEST_TOKEN
 const result = spawnSync(process.execPath, [`scripts/${script}`], { env, encoding: 'utf8', timeout:5000 })
 assert.notEqual(result.status,0)
 assert.match(result.stderr, /隔离测试/)
 })
 test(`${script} rejects a target without valid credentials without connecting`, async () => {
 let requests =0
 const server = createServer((req, res) => { requests++; res.end('not isolated') })
 await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
 try {
 const child = spawn(process.execPath, [`scripts/${script}`], { env: { ...process.env, SHOPCASH_TEST_BASE: `http://127.0.0.1:${server.address().port}`, SHOPCASH_TEST_TOKEN: '' }, stdio: 'ignore' })
 const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
 assert.notEqual(code,0)
 assert.equal(requests,0)
 } finally { await new Promise((resolve) => server.close(resolve)) }
 })
}
for (const mode of ['api', 'ui', 'ui-build']) {
 test(`${mode} rejects explicit targets`, () => {
 const result = spawnSync(process.execPath, ['scripts/isolated-check.mjs', mode], { env: { ...process.env, BASE: 'http://127.0.0.1:1' }, encoding: 'utf8', timeout:5000 })
 assert.notEqual(result.status,0)
 assert.match(result.stderr, /不接受外部目标/)
 })
}
