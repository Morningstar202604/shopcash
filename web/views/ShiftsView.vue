<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { api, state, toast, refreshMe, refreshSummary } from '../store.js'
import { yuanToFen } from '@shopcash/shared'

const openForm = reactive({ floatCash: '' })
const closeForm = reactive({ countedCash: '', note: '' })
const shifts = ref([])
const err = ref('')

const current = computed(() => shifts.value.find((s) => s.id === state.me?.shiftId))

const preview = computed(() => {
  const s = current.value
  if (!s) return null
  let counted = null
  try {
    counted = yuanToFen(closeForm.countedCash || '0')
  } catch {
    return { diff: null, invalid: true }
  }
  return { expected: s.expectedCashFen, counted, diff: counted - s.expectedCashFen, invalid: false }
})

async function load() {
  shifts.value = await api('/shifts')
}

async function open() {
  err.value = ''
  let fen = 0
  if (openForm.floatCash) {
    try {
      fen = yuanToFen(openForm.floatCash)
    } catch (e) {
      err.value = e.message
      return
    }
  }
  try {
    await api('/shifts/open', { method: 'POST', body: { floatCashFen: fen } })
    await refreshMe()
    toast('ok', '已开班')
    await load()
    openForm.floatCash = ''
  } catch (e) {
    err.value = e.message
  }
}

async function close() {
  err.value = ''
  if (closeForm.countedCash === '') {
    err.value = '请填写实点现金（没有就填 0.00）'
    return
  }
  try {
    const s = await api(`/shifts/${current.value.id}/close`, {
      method: 'POST',
      body: { countedCashFen: yuanToFen(closeForm.countedCash), note: closeForm.note },
    })
    await refreshMe()
    await refreshSummary()
    toast(s.diffFen === 0 ? 'ok' : 'warn', s.diffFen === 0 ? '交接完成，账实相符' : `交接完成，差额 ${(s.diffFen / 100).toFixed(2)} 元已记录`)
    closeForm.countedCash = ''
    closeForm.note = ''
    await load()
  } catch (e) {
    err.value = e.message
  }
}

function money(fen) {
  return fen === null || fen === undefined ? '—' : (fen / 100).toFixed(2)
}

onMounted(load)
</script>

<template>
  <div class="grid grid-2 shift-grid" style="align-items: start">
    <div class="card">
      <h2>{{ current ? '当前班次' : '开班' }}</h2>
      <template v-if="!current">
        <div class="field">
          <label>备用金（可选）</label>
          <input v-model="openForm.floatCash" placeholder="如 200.00" />
        </div>
        <div v-if="err" class="err">{{ err }}</div>
        <button class="btn-primary btn-lg gap-top" style="width: 100%" @click="open">开班 / F8</button>
      </template>
      <template v-else>
        <div class="grid grid-2">
          <div class="stat"><div class="label">开班时间</div><div class="value kbd">{{ current.openAt.slice(11, 16) }}</div></div>
          <div class="stat"><div class="label">备用金</div><div class="value">{{ money(current.floatCashFen) }}</div></div>
          <div class="stat"><div class="label">应收现金</div><div class="value">{{ money(current.expectedCashFen) }}</div></div>
          <div class="stat"><div class="label">已到账线上</div><div class="value">{{ money(current.expectedOnlineFen) }}</div></div>
        </div>
        <div class="field gap-top">
          <label>实点现金</label>
          <input v-model="closeForm.countedCash" :class="{ 'input-error': preview && preview.invalid }" placeholder="抽屉里数出来的现金" />
        </div>
        <div class="field">
          <label>交接说明</label>
          <input v-model="closeForm.note" placeholder="如：少 10 元，顾客现金找零争议" />
        </div>
        <div v-if="preview && !preview.invalid" class="row gap-top">
          <span class="muted">预计差额</span>
          <span class="amount" :style="{ color: preview.diff === 0 ? 'var(--brand)' : 'var(--danger)' }">
            {{ (preview.diff / 100).toFixed(2) }}
          </span>
        </div>
        <div v-if="preview && preview.invalid" class="err">现金金额格式非法</div>
        <div v-if="err" class="err">{{ err }}</div>
        <button class="btn-primary btn-lg gap-top" style="width: 100%" @click="close">交班结算</button>
      </template>
    </div>

    <div class="card">
      <h2>班次历史</h2>
      <p v-if="!shifts.length" class="muted">还没有班次记录</p>
      <table v-else>
        <thead><tr><th>店员</th><th>开班</th><th>现金</th><th>线上</th><th>差额</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="s in shifts" :key="s.id">
            <td>{{ s.userName }}</td>
            <td class="kbd">{{ s.openAt.slice(5, 16).replace('T', ' ') }}</td>
            <td class="mono right">{{ money(s.expectedCashFen) }}</td>
            <td class="mono right">{{ money(s.expectedOnlineFen) }}</td>
            <td class="mono right" :style="{ color: s.diffFen ? 'var(--danger)' : '' }">{{ money(s.diffFen) }}</td>
            <td><span class="badge" :class="s.status === 'OPEN' ? 'b-PAYING' : 'b-PAID'">{{ s.status === 'OPEN' ? '当班中' : '已交接' }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
