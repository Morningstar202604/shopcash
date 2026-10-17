<script setup>
import { onMounted, reactive, ref } from 'vue'
import { api, toast, STATUS_TEXT, CODE_TEXT, EXCEPTION_TEXT } from '../store.js'

const q = reactive({ status: '', kw: '', page: 1, pageSize: 20 })
const rows = ref([])
const total = ref(0)
const detail = ref(null)
const loading = ref(false)
const loadErr = ref('')

async function load() {
  loading.value = true
  loadErr.value = ''
  try {
    const d = await api(`/orders?status=${q.status}&kw=${encodeURIComponent(q.kw)}&page=${q.page}&pageSize=${q.pageSize}`)
    rows.value = d.rows
    total.value = d.total
  } catch (e) {
    loadErr.value = e.message
  } finally {
    loading.value = false
  }
}

async function open(row) {
  detail.value = await api(`/orders/${row.orderNo}`)
}

async function resolve(orderNo, action) {
  try {
    await api(`/exceptions/${orderNo}/resolve`, { method: 'POST', body: { action, note: '界面演示处理' } })
    toast('ok', action === 'RECORD_IN' ? '已补录为到账' : '已作废')
    detail.value = null
    await load()
  } catch (e) {
    toast('err', e.message)
  }
}

async function exportCsv() {
  const d = await api(`/orders?status=${q.status}&kw=${encodeURIComponent(q.kw)}&page=1&pageSize=100000`)
  const head = ['订单号', '金额(元)', '方式', '状态', '异常原因', '渠道单号', '备注', '创建时间']
  const lines = d.rows.map((o) =>
    [o.orderNo, (o.amountFen / 100).toFixed(2), CODE_TEXT[o.codeType], STATUS_TEXT[o.status], o.exceptionReason || '', o.channelOrderNo || '', o.remark || '', o.createdAt].join(','),
  )
  const blob = new Blob(['\ufeff' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  toast('ok', `已导出 ${d.rows.length} 笔`)
}

function money(fen) {
  return (fen / 100).toFixed(2)
}

onMounted(load)
</script>

<template>
  <div>
    <div class="card">
      <div class="card-title">
        <h2>订单</h2>
        <div class="row">
          <select v-model="q.status" style="width: 130px" @change="q.page = 1; load()">
            <option value="">全部状态</option>
            <option v-for="(t, k) in STATUS_TEXT" :key="k" :value="k">{{ t }}</option>
          </select>
          <input v-model="q.kw" placeholder="订单号 / 渠道单号 / 备注" style="width: 220px" @keyup.enter="q.page = 1; load()" />
          <button @click="q.page = 1; load()">查询</button>
          <button @click="exportCsv">导出 CSV</button>
        </div>
      </div>

      <p v-if="loading" class="muted">加载中…</p>
      <p v-else-if="loadErr" class="err">{{ loadErr }}</p>
      <p v-else-if="!rows.length" class="muted">没有符合条件的订单。换个筛选条件，或回收银台按 F2 开始收款。</p>

      <table v-else>
        <thead>
          <tr>
            <th>订单号</th><th class="right">金额</th><th>方式</th><th>状态</th><th>渠道单号</th><th>时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in rows" :key="o.orderNo" class="clickable" @click="open(o)">
            <td class="mono">{{ o.orderNo }}</td>
            <td class="mono right">￥{{ money(o.amountFen) }}</td>
            <td>{{ CODE_TEXT[o.codeType] }}</td>
            <td>
              <span class="badge" :class="`b-${o.status}`">{{ STATUS_TEXT[o.status] }}</span>
              <span v-if="o.exceptionReason" class="kbd"> {{ EXCEPTION_TEXT[o.exceptionReason] || o.exceptionReason }}</span>
            </td>
            <td class="mono kbd">{{ o.channelOrderNo || '—' }}</td>
            <td class="kbd">{{ o.createdAt.slice(11, 19) }}</td>
            <td><button @click.stop="open(o)">查看详情</button></td>
          </tr>
        </tbody>
      </table>

      <div class="row gap-top">
        <span class="kbd">共 {{ total }} 笔</span>
        <button :disabled="q.page <= 1" @click="q.page -= 1; load()">上一页</button>
        <span class="kbd">第 {{ q.page }} 页</span>
        <button :disabled="q.page * q.pageSize >= total" @click="q.page += 1; load()">下一页</button>
      </div>
    </div>

    <div v-if="detail" class="card">
      <div class="card-title">
        <h2>订单详情</h2>
        <button @click="detail = null">关闭</button>
      </div>
      <div class="grid grid-2">
        <div>
          <p><span class="muted">订单号</span><br /><span class="mono">{{ detail.orderNo }}</span></p>
          <p><span class="muted">金额</span><br /><span class="amount">￥{{ money(detail.amountFen) }}</span></p>
          <p><span class="muted">状态</span><br /><span class="badge" :class="`b-${detail.status}`">{{ STATUS_TEXT[detail.status] }}</span></p>
        </div>
        <div>
          <p v-if="detail.exceptionReason"><span class="muted">异常原因</span><br />{{ EXCEPTION_TEXT[detail.exceptionReason] || detail.exceptionReason }}</p>
          <p v-if="detail.remark"><span class="muted">备注</span><br />{{ detail.remark }}</p>
        </div>
      </div>
      <h3>状态流转</h3>
      <ul class="timeline">
        <li v-for="e in detail.events" :key="e.id">
          <span class="t">{{ e.createdAt.slice(11, 19) }}</span>
          <span class="badge" :class="`b-${e.toStatus}`">{{ STATUS_TEXT[e.toStatus] }}</span>
          <span class="kbd">{{ e.source }}</span>
          <div class="muted">{{ e.note }}</div>
        </li>
      </ul>
      <div v-if="detail.status === 'EXCEPTION'" class="row gap-top">
        <button class="btn-primary" @click="resolve(detail.orderNo, 'RECORD_IN')">确已收款，补录入账</button>
        <button class="btn-danger" @click="resolve(detail.orderNo, 'IGNORE')">确认未收款，作废</button>
      </div>
    </div>
  </div>
</template>
