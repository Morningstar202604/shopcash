<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, toast, STATUS_TEXT, CODE_TEXT, EXCEPTION_TEXT } from '../store.js'
import { toCsv, formatDateTime, fenToYuan } from '@shopcash/shared'

const router = useRouter()
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
  try {
    detail.value = await api(`/orders/${row.orderNo}`)
  } catch (e) {
    toast('err', e.message)
  }
}

function gotoResolve(orderNo) {
  detail.value = null
  router.push({ path: '/exceptions', query: { orderNo } })
}

async function exportCsv() {
  try {
    const d = await api(`/orders?status=${q.status}&kw=${encodeURIComponent(q.kw)}&page=1&pageSize=100000`)
    const head = ['订单号', '金额(元)', '方式', '状态', '异常原因', '渠道单号', '备注', '创建时间']
    const lines = d.rows.map((o) => [
      o.orderNo,
      money(o.amountFen),
      CODE_TEXT[o.codeType] || o.codeType,
      STATUS_TEXT[o.status] || o.status,
      o.exceptionReason ? EXCEPTION_TEXT[o.exceptionReason] || o.exceptionReason : '',
      o.channelOrderNo || '',
      o.remark || '',
      formatDateTime(o.createdAt, { withSeconds: true }),
    ])
    const blob = new Blob([toCsv(head, lines)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast('ok', `已导出 ${d.rows.length} 笔`)
  } catch (e) {
    toast('err', e.message)
  }
}

function money(fen) {
  return fen === undefined || fen === null ? '—' : fenToYuan(fen)
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
            <td>{{ CODE_TEXT[o.codeType] || o.codeType }}</td>
            <td>
              <span class="badge" :class="`b-${o.status}`">{{ STATUS_TEXT[o.status] || o.status }}</span>
              <span v-if="o.exceptionReason" class="kbd"> {{ EXCEPTION_TEXT[o.exceptionReason] || o.exceptionReason }}</span>
            </td>
            <td class="mono kbd">{{ o.channelOrderNo || '—' }}</td>
            <td class="kbd">{{ formatDateTime(o.createdAt) }}</td>
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
          <p><span class="muted">状态</span><br /><span class="badge" :class="`b-${detail.status}`">{{ STATUS_TEXT[detail.status] || detail.status }}</span></p>
          <p><span class="muted">下单时间</span><br /><span class="kbd">{{ formatDateTime(detail.createdAt, { withSeconds: true }) }}</span></p>
        </div>
        <div>
          <p v-if="detail.exceptionReason"><span class="muted">异常原因</span><br />{{ EXCEPTION_TEXT[detail.exceptionReason] || detail.exceptionReason }}</p>
          <p v-if="detail.remark"><span class="muted">备注</span><br />{{ detail.remark }}</p>
          <p v-if="detail.channelOrderNo"><span class="muted">渠道单号</span><br /><span class="mono kbd">{{ detail.channelOrderNo }}</span></p>
        </div>
      </div>
      <h3>状态流转</h3>
      <ul class="timeline">
        <li v-for="e in detail.events" :key="e.id">
          <span class="t">{{ formatDateTime(e.createdAt, { withSeconds: true }) }}</span>
          <span class="badge" :class="`b-${e.toStatus}`">{{ STATUS_TEXT[e.toStatus] || e.toStatus }}</span>
          <span class="kbd">{{ e.source }}</span>
          <div class="muted">{{ e.note }}</div>
        </li>
      </ul>
      <div v-if="detail.status === 'EXCEPTION'" class="row gap-top">
        <button class="btn-primary" @click="gotoResolve(detail.orderNo)">去待处理工作台结案</button>
        <span class="kbd">结案需要店主口令二次确认，统一在「待处理」页面完成</span>
      </div>
    </div>
  </div>
</template>
