import { randomBytes, randomInt } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer, preview } from 'vite'

if (process.env.BASE || process.env.SHOPCASH_TEST_BASE || process.env.SHOPCASH_TEST_TOKEN) throw new Error('隔离测试入口不接受外部目标配置')
const mode = process.argv[2]
if (!['api', 'ui', 'ui-build'].includes(mode)) throw new Error('未知的隔离测试类型')
const token = randomBytes(32).toString('hex')
const port = randomInt(49152,65536)
process.env.SHOPCASH_ISOLATION_TOKEN = token
let server
let child
let interrupted = false
const stop = () => { interrupted = true; child?.kill() }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
 server = mode === 'ui-build'
 ? await preview({ preview: { host: '127.0.0.1', port, strictPort: true } })
 : await createServer({ server: { host: '127.0.0.1', port, strictPort: true } })
 if (mode !== 'ui-build') await server.listen()
 const address = server.httpServer.address()
 if (!address || typeof address === 'string' || address.port ===5199) throw new Error('隔离测试端口无效')
 console.log(`隔离测试服务：127.0.0.1:${address.port}`)
 if (interrupted) throw new Error('隔离测试已中断')
 const script = mode === 'api' ? 'scripts/api-rules-check.mjs' : 'scripts/ui-check.mjs'
 child = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, SHOPCASH_TEST_BASE: `http://127.0.0.1:${address.port}`, SHOPCASH_TEST_TOKEN: token } })
 const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code)) })
 if (code !==0 || interrupted) process.exitCode =1
} finally {
 if (server) {
 await server.close()
 console.log('隔离测试服务已关闭')
 }
 process.removeListener('SIGINT', stop)
 process.removeListener('SIGTERM', stop)
}
