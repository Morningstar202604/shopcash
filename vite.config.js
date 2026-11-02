import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSeed, handle, reseedOrders } from './tools/mock-server.js'

/**
 * 本地开发/自测用：把 mock API 挂成 Vite 中间件，前端与接口同源，无需另起后端。
 * 商家便携包不使用此文件（生产由 NestJS sidecar 提供同名接口）。
 */
function mockApi() {
  const db = createSeed()
  reseedOrders(db)

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch {
          resolve({})
        }
      })
    })

  const middleware = async (req, res, next) => {
    if (req.url === '/__shopcash_isolation' && process.env.SHOPCASH_ISOLATION_TOKEN) {
      res.end(process.env.SHOPCASH_ISOLATION_TOKEN)
      return
    }
    if (!req.url.startsWith('/api')) return next()
    const out = handle(db, req.method, req.url, req.method === 'GET' ? {} : await readBody(req))
    res.statusCode = out.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(out.body))
  }

  return {
    name: 'shopcash-mock-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

export default defineConfig({
  root: 'web',
  plugins: [vue(), mockApi()],
  // 产物目录 web/dist：预览服务器按 root 解析；真实产品里由 NestJS sidecar 托管这批静态文件
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: ['..'] } },
  preview: { host: '127.0.0.1', port: 5199, strictPort: true },
})
