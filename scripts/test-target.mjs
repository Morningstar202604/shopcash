export async function isolatedTarget() {
 const base = process.env.SHOPCASH_TEST_BASE
 const token = process.env.SHOPCASH_TEST_TOKEN
 if (!base || !token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('隔离测试目标未配置，请使用 npm 自检入口')
 const url = new URL(base)
 if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.port === '5199' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('隔离测试目标无效')
 const response = await fetch(`${url.origin}/__shopcash_isolation`, { redirect: 'error', signal: AbortSignal.timeout(3000) })
 if (!response.ok || await response.text() !== token) throw new Error('隔离测试目标身份校验失败')
 return url.origin
}
