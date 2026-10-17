<script setup>
import { onMounted, reactive, ref, computed } from 'vue'
import { api, state, toast, refreshSummary, beep, STATUS_TEXT, CODE_TEXT } from '../store.js'
import { yuanToFen, fenToYuan, AmountError } from '@shopcash/shared'

const amountText = ref('')
const remark = ref('')
const amountErr = ref('')
const current = reactive({ order: null, status: '', attempt: 0, note: '' })
const lastPaid = ref(null)
let pollTimer = null

const amountFen = computed(() => {
  try {
    return yuanToFen(amountText.value || '0')
  } catch {
    return 0
  }
})

const shiftOpen = computed(() => Boolean(state.me?.shiftId))

function validateLive() {
  amountErr.value = ''
  if (!amountText.value) return
  try {
    yuanToFen(amountText.value)
  } catch (e) {
    amountErr.value = e instanceof AmountError ? e.message : '金额非法'
  }
}

function pressKey(k) {
  if (k === 'C') return (amountText.value = '')
  if (k === '←') {
    amountText.value = amountText.value.slice(0, -1)
    return validateLive()
  }
  if (k === '.' && amountText.value.includes('.')) return
  if (k === '.' && !amountText.value) amountText.value = '0'
  const next = amountText.value + k
  if (/\.\d{2}$/.test(amountText.value) && k !== '.') return
  amountText.value = next
  validateLive()
}

function stopPoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function poll(orderNo) {
  stopPoll()
  const tick = async () => {
    try {
      const s = await api(`/cashier/orders/${orderNo}/status`)
      current.status = s.status
      current.attempt = s.attempt
      current.note = s.exceptionReason ? `异常原因：${s.exceptionReason}` : ''
      if (s.status === 'PAID') {
        beep('ok')
        toast('ok', `已到账 ${fenToYuan(current.order?.amountFen ?? 0)} 元`)
        lastPaid.value = { orderNo, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }
        current.order = null
        amountText.value = ''
        remark.value = ''
        refreshSummary()
        return
      }
      if (s.status === 'CLOSED' || s.status === 'EXCEPTION') {
        beep(s.status === 'EXCEPTION' ? 'warn' : 'err')
        toast(s.status === 'EXCEPTION' ? 'warn' : 'err',
          s.status === 'EXCEPTION' ? '这笔需要店主人工处理，已进待处理列表' : '订单已超时关闭；若顾客称已付款，请到待处理核对')
        current.order = null
        refreshSummary()
        return
      }
      if (s.nextQueryAt) pollTimer = setTimeout(tick, Math.max(600, new Date(s.nextQueryAt) - Date.now()))
      else pollTimer = setTimeout(tick, 2000)
    } catch {
      pollTimer = setTimeout(tick, 2000)
    }
  }
  pollTimer = setTimeout(tick, 600)
}

async function create(codeType) {
  if (!shiftOpen.value) return toast('err', '请先开班再收银')
  amountErr.value = ''
  let fen
  try {
    fen = yuanToFen(amountText.value || '0')
  } catch (e) {
    amountErr.value = e.message
    beep('err')
    toast('err', e.message)
    return
  }
  try {
    const res = await api('/cashier/orders', {
      method: 'POST',
      body: {
        amountFen: fen,
        codeType,
        clientRequestId: crypto.randomUUID(),
        remark: remark.value,
      },
    })
    current.order = res
    current.status = res.status
    current.note = ''
    if (codeType === 'CASH') {
      toast('ok', `现金收款 ${fenToYuan(fen)} 元已入账`)
      beep('ok')
      lastPaid.value = { orderNo: res.orderNo, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }
      amountText.value = ''
      remark.value = ''
      current.order = null
      refreshSummary()
    } else {
      poll(res.orderNo)
    }
  } catch (e) {
    toast('err', e.message)
    beep('err')
  }
}

async function mockChannel(kind) {
  if (!current.order) return
  try {
    const r = await api('/channels/mock/confirm', { method: 'POST', body: { orderNo: current.order.orderNo, kind } })
    toast('ok', r.note)
  } catch (e) {
    toast('err', e.message)
  }
}

function onKey(e) {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'password') return
  const map = { F2: 'WECHAT', F3: 'ALIPAY', F4: 'CASH' }
  if (map[e.key]) {
    e.preventDefault()
    create(map[e.key])
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
</script>

<template>
  <div class="cashier-grid">
    <div>
      <div class="card">
        <div class="card-title">
          <h2>收款金额</h2>
          <span class="kbd">F2 微信 · F3 支付宝 · F4 现金</span>
        </div>
        <div class="amount-display">￥{{ amountText || '0' }}</div>
        <div v-if="amountErr" class="err">{{ amountErr }}</div>
        <div class="keypad">
          <button v-for="k in ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '←']" :key="k" class="btn-key" @click="pressKey(k)">
            {{ k }}
          </button>
          <button class="btn-key" style="color: var(--danger)" @click="pressKey('C')">C</button>
          <button class="btn-key btn-primary" @click="pressKey('00')">00</button>
        </div>
        <div class="field gap-top">
          <label>备注（可选）</label>
          <input v-model="remark" maxlength="200" placeholder="如：堂食 / 老顾客" />
        </div>
        <div class="grid grid-2 gap-top" style="grid-template-columns: repeat(3, 1fr)">
          <button class="btn-pay" :disabled="!shiftOpen" @click="create('WECHAT')">微信收款<span v-if="!shiftOpen" class="kbd" style="display:block;color:#6b7280">需先开班</span></button>
          <button class="btn-pay" :disabled="!shiftOpen" @click="create('ALIPAY')">支付宝收款<span v-if="!shiftOpen" class="kbd" style="display:block;color:#6b7280">需先开班</span></button>
          <button class="btn-pay btn-primary" :disabled="!shiftOpen" @click="create('CASH')">现金收款<span v-if="!shiftOpen" class="kbd" style="display:block;color:#6b7280">需先开班</span></button>
        </div>
        <p v-if="!shiftOpen" class="err">当前未开班，先「开班 / 填备用金」才能收银。</p>
      </div>

      <div v-if="current.order" class="card">
        <div class="card-title">
          <h2>等待顾客付款</h2>
          <span class="badge" :class="`b-${current.status || 'PENDING'}`">{{ STATUS_TEXT[current.status] || current.status }}</span>
        </div>
        <div class="row">
          <div class="qr-box">
            <div class="qr-fake"></div>
            <div class="kbd mono">{{ current.order.orderNo }}</div>
          </div>
          <div>
            <div class="amount">￥{{ fenToYuan(current.order.amountFen) }}</div>
            <p class="muted">{{ CODE_TEXT[current.order.codeType] }}收款 · 已查询 {{ current.attempt }} 次</p>
            <p class="kbd">没有公网也能到账：系统按 3s/10s/30s/2min/5min 主动查单</p>
            <div v-if="state.summary?.seed" class="demo-box">
              <h3>演示专用（未接真实商户号时才显示，正式包不含此区块）</h3>
              <div class="row wrap">
                <button @click="mockChannel('SUCCESS')">模拟：正常付款</button>
                <button @click="mockChannel('AMOUNT_MISMATCH')">模拟：少付 1 分</button>
                <button @click="mockChannel('LATE_SUCCESS')">模拟：关单后才付</button>
              </div>
            </div>
            <p v-if="current.note" class="err">{{ current.note }}</p>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="card">
        <div class="card-title"><h2>本班实时</h2></div>
        <div class="grid grid-2">
          <div class="stat"><div class="label">已到账笔数</div><div class="value">{{ state.summary?.paidCount ?? 0 }}</div></div>
          <div class="stat"><div class="label">已到账金额</div><div class="value">{{ fenToYuan(state.summary?.paidFen ?? 0) }}</div></div>
          <div class="stat"><div class="label">现金</div><div class="value">{{ fenToYuan(state.summary?.cashFen ?? 0) }}</div></div>
          <div class="stat"><div class="label">待处理</div><div class="value" :style="{ color: state.summary?.exceptionCount ? 'var(--danger)' : '' }">{{ state.summary?.exceptionCount ?? 0 }}</div></div>
        </div>
      </div>
      <div class="card">
        <h3>最近到账</h3>
        <p v-if="!lastPaid" class="muted">今天还没有到账记录</p>
        <div v-else class="row">
          <span class="badge b-PAID">已到账</span>
          <span class="mono kbd">{{ lastPaid.orderNo }}</span>
          <span class="kbd">{{ lastPaid.at }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
