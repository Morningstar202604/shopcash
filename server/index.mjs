import { createServer } from 'node:http'
import { openDatabase } from './db.mjs'
import { createApp, HttpError, seedDemo } from './app.mjs'

const PORT = Number(process.env.PORT || 5400)
const HOST = process.env.HOST || '127.0.0.1'
const DB_FILE = process.env.DB_FILE || 'data/shopcash.db'

const db = openDatabase(DB_FILE)
if (process.env.SEED_DEMO === '1') seedDemo(db)

const app = createApp({ db })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'local'}`)
  if (!url.pathname.startsWith('/api/')) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ code: 40401, message: '接口不存在' }))
    return
  }
  let body = {}
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
      if (Buffer.concat(chunks).length > 1_000_000) {
        res.statusCode = 413
        res.end()
        return
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ code: 40001, message: '请求体不是合法 JSON' }))
        return
      }
    }
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
    (req.headers.cookie || '').split(';').map((p) => p.trim()).find((p) => p.startsWith('sc_session='))?.slice('sc_session='.length)
  const ctx = token ? app.resolveSession?.(token) ?? null : null
  try {
    const out = app.route(req.method, req.url, body, ctx)
    res.statusCode = out.status
    if (out.raw !== undefined) {
      res.setHeader('content-type', out.contentType || 'text/plain; charset=utf-8')
      res.end(out.raw)
      return
    }
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ code: 0, message: 'ok', data: out.data }))
  } catch (e) {
    const known = e instanceof HttpError
    res.statusCode = known ? e.status : 500
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        code: known ? e.code : 50001,
        message: known ? e.message : '服务内部错误',
        data: null,
      }),
    )
    if (!known) console.error(e)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`ShopCash server listening on http://${HOST}:${PORT}`)
})

const shutdown = () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
