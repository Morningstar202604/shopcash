<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api, state, toast, refreshSummary, EXCEPTION_TEXT } from '../store.js'
import { formatMonthDayMinute, fenToYuan } from '@shopcash/shared'

const rows = ref([])
const detail = ref(null)
const loadErr = ref('')
const reason = ref('')

const closeForm = reactive({ password: '', note: '' })
const closeState = reactive({ orderNo: '', action: '' })
const closeErr = ref('')
const busy = ref('')

const REASON_HINT = {
  AMOUNT_MISMATCH: '渠道实付金额与订单不一致，系统拒绝自动入账。核对渠道账单后再决定补录或作废。',
  LATE_SUCCESS: '订单已关单后渠道才报成功。这类钱不能自动入账，必须人工核对。',
  NO_CALLBACK: '长时间未收到渠道回调，且主动查单无结果。',
  PARSE_FAIL: '渠道回调报文解析失败，需要人工核对原始报文。',
  MANUAL: '人工登记进入待处理，等待店主裁定。',
  REFUND_FAILED: '渠道退款失败，需要人工跟进。',
}

async function load() {
  loadErr.value = ''
  try {
    const d = await api('/exceptions')
    rows.value = d.rows
  } catch (e) {
    loadErr.value = e.message
  }
}

function startAction(o, action) {
  if (state.me?.role !== 'OWNER') return toast('err', '只有店主可以处理待处理订单')
  detail.value = o
  closeState.orderNo = o.orderNo
  closeState.action = action
  reason.value = REASON_HINT[o.exceptionReason] || ''
  closeErr.value = ''
  closeForm.password = ''
  closeForm.note = ''
}

async function submit() {
  closeErr.value = ''
  if (!closeForm.password) return (closeErr.value = '请输入店主口令')
  busy.value = closeState.orderNo
  try {
    await api(`/exceptions/${closeState.orderNo}/resolve`, {
      method: 'POST',
      body: { action: closeState.action, note: closeForm.note, confirmPassword: closeForm.password },
    })
    toast('ok', closeState.action === 'RECORD_IN' ? '已补录为到账' : '已作废并留痕')
    detail.value = null
    closeState.orderNo = ''
    closeState.action = ''
    await load()
    await refreshSummary()
  } catch (e) {
    closeErr.value = e.message
  } finally {
    busy.value = ''
    closeForm.password = ''
  }
}

function money(fen) {
  return fen === undefined || fen === null ? '—' : fenToYuan(fen)
}

onMounted(load)
</script>

<template>
  <div class="card">
    <div class="card-title">
      <h2>待人工处理</h2>
      <button @click="load">刷新</button>
    </div>
    <p v-if="loadErr" class="err">{{ loadErr }}</p>
    <p v-else-if="!rows.length" class="muted">没有待处理订单。钱和账目前一致。</p>
    <div v-else>
      <p class="muted">这些订单不能被系统自动入账——金额对不上、或关单后才发现付款成功。必须由店主输入口令确认。</p>
      <table>
        <thead><tr><th>订单号</th><th>金额</th><th>原因</th><th>渠道显示</th><th>下单时间</th><th>处理</th></tr></thead>
        <tbody>
          <tr v-for="o in rows" :key="o.orderNo">
            <td class="mono">{{ o.orderNo }}</td>
            <td class="mono right">￥{{ money(o.amountFen) }}</td>
            <td><span class="badge b-EXCEPTION">{{ EXCEPTION_TEXT[o.exceptionReason] || o.exceptionReason }}</span></td>
            <td class="mono kbd">
              {{ o.amountFenPaid !== undefined && o.amountFenPaid !== null ? `实付 ￥${money(o.amountFenPaid)}` : o.prevStatus === 'CLOSED' ? '关单后成功' : '—' }}
            </td>
            <td class="kbd">{{ formatMonthDayMinute(o.createdAt) }}</td>
            <td>
              <div class="row row-danger">
                <button class="btn-primary" :disabled="busy === o.orderNo" @click="startAction(o, 'RECORD_IN')">确已收款，补录</button>
                <button class="btn-danger" :disabled="busy === o.orderNo" @click="startAction(o, 'IGNORE')">作废</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="closeState.orderNo" class="modal-mask" @click.self="closeState.orderNo = ''">
    <div class="card modal-card">
      <div class="card-title">
        <h2>{{ closeState.action === 'RECORD_IN' ? '补录为到账' : '作废该订单' }}</h2>
        <button @click="closeState.orderNo = ''">取消</button>
      </div>
      <p class="muted">{{ reason }}</p>
      <p class="kbd mono">{{ closeState.orderNo }} ｜ 订单 ￥{{ money(detail?.amountFen) }}<span v-if="detail?.amountFenPaid !== null && detail?.amountFenPaid !== undefined"> ｜ 渠道实付 ￥{{ money(detail.amountFenPaid) }}</span></p>
      <p v-if="closeState.action === 'RECORD_IN'" class="muted">补录会把订单置为已到账，计入本班应收，请先核对顾客账单。</p>
      <p v-else class="err">作废不可撤销，订单转为已关单并写入操作记录。</p>
      <div class="field gap-top">
        <label>处理说明（写入操作记录）</label>
        <input v-model="closeForm.note" maxlength="200" placeholder="如：顾客出示微信账单，实付与订单一致" />
      </div>
      <div class="field">
        <label>店主口令（二次确认）</label>
        <input v-model="closeForm.password" type="password" @keyup.enter="submit" />
      </div>
      <div v-if="closeErr" class="err">{{ closeErr }}</div>
      <button
        class="btn-lg gap-top"
        :class="closeState.action === 'RECORD_IN' ? 'btn-primary' : 'btn-danger'"
        style="width: 100%"
        :disabled="busy === closeState.orderNo"
        @click="submit"
      >
        {{ busy === closeState.orderNo ? '处理中…' : closeState.action === 'RECORD_IN' ? '确认补录入账' : '确认作废，不可撤销' }}
      </button>
    </div>
  </div>
</template>
