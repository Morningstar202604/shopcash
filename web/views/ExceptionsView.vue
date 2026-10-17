<script setup>
import { onMounted, ref } from 'vue'
import { api, state, toast, refreshSummary, EXCEPTION_TEXT } from '../store.js'

const rows = ref([])
const note = ref('')
const busy = ref('')
const armed = ref('')

function arm(no) {
  armed.value = no
  toast('warn', '再次点击「确认作废」才会生效', 4000)
}

async function load() {
  const d = await api('/exceptions')
  rows.value = d.rows
}

async function resolve(o, action) {
  if (state.me?.role !== 'OWNER') return toast('err', '只有店主可以处理待处理订单')
  busy.value = o.orderNo
  try {
    await api(`/exceptions/${o.orderNo}/resolve`, { method: 'POST', body: { action, note: note.value } })
    toast('ok', action === 'RECORD_IN' ? '已补录为到账' : '已作废并留痕')
    note.value = ''
    armed.value = ''
    await load()
    await refreshSummary()
  } catch (e) {
    toast('err', e.message)
  } finally {
    busy.value = ''
  }
}

function age(o) {
  const h = Math.floor((Date.now() - new Date(o.createdAt)) / 3600000)
  return h >= 24 ? `${Math.floor(h / 24)} 天` : `${h} 小时`
}

onMounted(load)
</script>

<template>
  <div class="card">
    <div class="card-title">
      <h2>待人工处理</h2>
      <button @click="load">刷新</button>
    </div>
    <p v-if="!rows.length" class="muted">没有待处理订单。钱和账目前一致。</p>
    <div v-else>
      <p class="muted">这些订单不能被系统自动入账——金额对不上、或关单后才发现付款成功。必须由店主确认。</p>
      <table>
        <thead><tr><th>订单号</th><th>金额</th><th>原因</th><th>渠道显示</th><th>账龄</th><th>处理</th></tr></thead>
        <tbody>
          <tr v-for="o in rows" :key="o.orderNo">
            <td class="mono">{{ o.orderNo }}</td>
            <td class="mono right">￥{{ (o.amountFen / 100).toFixed(2) }}</td>
            <td><span class="badge b-EXCEPTION">{{ EXCEPTION_TEXT[o.exceptionReason] || o.exceptionReason }}</span></td>
            <td class="mono kbd">{{ o.amountFenPaid !== undefined && o.amountFenPaid !== null ? `实付 ￥${(o.amountFenPaid / 100).toFixed(2)}` : o.prevStatus === 'CLOSED' ? '关单后成功' : '—' }}</td>
            <td class="kbd">{{ age(o) }}</td>
            <td>
              <div class="row row-danger">
                <span v-if="armed === o.orderNo" class="badge b-EXCEPTION">二次确认中</span>
                <button class="btn-primary" :disabled="busy === o.orderNo" @click="resolve(o, 'RECORD_IN')">确已收款，补录</button>
                <button v-if="armed !== o.orderNo" class="btn-danger" :disabled="busy === o.orderNo" @click="arm(o.orderNo)">作废（需二次确认）</button>
                <template v-else>
                  <button class="btn-danger" style="min-width: 160px" :disabled="busy === o.orderNo" @click="resolve(o, 'IGNORE')">确认作废，不可撤销</button>
                  <button @click="armed = ''">取消</button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="field gap-top">
        <label>处理说明（每笔都会写入操作记录）</label>
        <input v-model="note" placeholder="如：顾客出示微信账单，实付与订单一致，补录" />
      </div>
    </div>
  </div>
</template>
