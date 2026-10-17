import { reactive } from 'vue'
import { fenToYuan } from '@shopcash/shared'

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

export const EXCEPTION_TEXT = {
  AMOUNT_MISMATCH: '金额不符',
  LATE_SUCCESS: '迟到成功',
  NO_CALLBACK: '未收到回调',
  PARSE_FAIL: '回调解析失败',
  MANUAL: '人工登记',
  REFUND_FAILED: '退款失败',
}

export const state = reactive({
  me: null,
  summary: null,
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

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (json.code !== 0) {
    const err = new Error(json.message || '请求失败')
    err.code = json.code
    throw err
  }
  return json.data
}

export async function refreshMe() {
  state.me = await api('/auth/me')
  return state.me
}

export async function refreshSummary() {
  state.summary = await api('/dashboard/summary')
  if (state.summary.diskFreeMb < 200) state.banner = { level: 'error', text: '磁盘剩余不足 200MB，暂停新建订单' }
  else if (state.summary.exceptionCount > 0)
    state.banner = { level: 'warn', text: `${state.summary.exceptionCount} 笔订单待人工处理，请今天结案` }
  else state.banner = null
  return state.summary
}

export function yuan(fen) {
  return fenToYuan(fen ?? 0)
}

/** 提示音：到账 / 异常 / 失败（Web Audio，不依赖任何资源文件） */
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
