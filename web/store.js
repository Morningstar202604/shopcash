import { reactive } from 'vue'

export const STATUS_TEXT = {
  PENDING: '待支付',
  PAYING: '支付中',
  PAID: '已到账',
  CLOSED: '已关单',
  REFUNDING: '退款中',
  REFUNDED: '已退款',
  EXCEPTION: '需处理',
}

export const CODE_TEXT = { WECHAT: '微信', ALIPAY: '支付宝', CASH: '现金', MOCK: '模拟' }

export const ROLE_TEXT = { OWNER: '所有者', MANAGER: '店长', CASHIER: '店员', VIEWER: '只读' }

export const EXCEPTION_TEXT = {
  AMOUNT_MISMATCH: '金额不符',
  LATE_SUCCESS: '迟到成功',
  NO_CALLBACK: '未收到回调',
  PARSE_FAIL: '回调解析失败',
  MANUAL: '人工登记',
  REFUND_FAILED: '退款失败',
}

const TOKEN_KEY = 'shopcash_token'

export const state = reactive({
  token: localStorage.getItem(TOKEN_KEY) || '',
  me: null,
  summary: null,
  stores: [],
  toasts: [],
  banner: null,
})

let toastSeq = 0
export function toast(kind, text, ms = 2600) {
  const id = ++toastSeq
  state.toasts.push({ id, kind, text })
  while (state.toasts.length > 3) state.toasts.shift()
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id)
    if (i >= 0) state.toasts.splice(i, 1)
  }, ms)
}

export function setToken(token) {
  state.token = token || ''
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (json.code !== 0) {
    const err = new Error(json.message || '请求失败')
    err.code = json.code
    if (json.code === 40101) setToken('')
    throw err
  }
  return json.data
}

export function canManage() {
  return state.me?.role === 'OWNER' || state.me?.role === 'MANAGER'
}

export async function refreshMe() {
  state.me = await api('/auth/me')
  state.stores = state.me.stores || []
  return state.me
}

export async function refreshSummary() {
  state.summary = await api('/dashboard/summary')
  if (state.summary.exceptionCount > 0)
    state.banner = { level: 'warn', text: `${state.summary.exceptionCount} 笔订单待人工处理，请及时结案` }
  else state.banner = null
  return state.summary
}

export async function switchStore(storeId) {
  await api('/auth/switch-store', { method: 'POST', body: { storeId } })
  state.me.storeId = storeId
  await refreshSummary()
}

export function beep(kind = 'ok') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const freq = kind === 'ok' ? 880 : kind === 'warn' ? 420 : 220
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = freq
    o.type = 'sine'
    g.gain.value = 0.08
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    setTimeout(() => {
      o.stop()
      ctx.close()
    }, kind === 'ok' ? 180 : 320)
  } catch {
    /* 忽略音频不可用 */
  }
}
