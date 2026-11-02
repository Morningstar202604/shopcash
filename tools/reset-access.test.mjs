import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, handle } from './mock-server.js'

const reset = (db, suffix = '') => handle(db, 'POST', `/api/__test/reset${suffix}`, {})

test('reset is unavailable by default and cannot restore a logged-out owner', () => {
 const previous = process.env.SHOPCASH_ISOLATION_TOKEN
 delete process.env.SHOPCASH_ISOLATION_TOKEN
 try {
 const db = createSeed()
 handle(db, 'POST', '/api/auth/logout', {})
 const before = structuredClone(db)
 assert.equal(reset(db).status,404)
 assert.deepEqual(db, before)
 assert.equal(handle(db, 'GET', '/api/auth/me', {}).status,401)
 } finally {
 if (previous === undefined) delete process.env.SHOPCASH_ISOLATION_TOKEN
 else process.env.SHOPCASH_ISOLATION_TOKEN = previous
 }
})

test('explicit isolated test mode preserves reset and setup fixtures', () => {
 const previous = process.env.SHOPCASH_ISOLATION_TOKEN
 process.env.SHOPCASH_ISOLATION_TOKEN = 'isolated-test'
 try {
 const db = createSeed()
 handle(db, 'POST', '/api/auth/logout', {})
 assert.equal(reset(db).status,200)
 assert.equal(db.session.role, 'OWNER')
 assert.equal(reset(db, '?setup=0').status,200)
 assert.equal(db.setupDone, false)
 assert.equal(db.users.length,0)
 } finally {
 if (previous === undefined) delete process.env.SHOPCASH_ISOLATION_TOKEN
 else process.env.SHOPCASH_ISOLATION_TOKEN = previous
 }
})
