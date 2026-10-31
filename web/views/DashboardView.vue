<script setup>
import { onMounted } from 'vue'
import { state, refreshSummary } from '../store.js'
import { fenToYuan } from '@shopcash/shared'

onMounted(refreshSummary)

function gb(mb) {
  return mb === null || mb === undefined ? '—' : (mb / 1024).toFixed(1)
}
</script>

<template>
  <div v-if="state.summary">
    <p class="kbd">统计口径：今日全店 {{ state.summary.todayCount }} 笔订单；「本班实时」请看收银台</p>
    <div class="grid grid-4 gap-top">
      <div class="card stat"><div class="label">今日订单</div><div class="value">{{ state.summary.todayCount }}</div></div>
      <div class="card stat"><div class="label">已到账笔数</div><div class="value">{{ state.summary.paidCount }}</div></div>
      <div class="card stat"><div class="label">已到账金额</div><div class="value">{{ fenToYuan(state.summary.paidFen) }}</div></div>
      <div class="card stat"><div class="label">待人工处理</div><div class="value" :style="{ color: state.summary.exceptionCount ? 'var(--danger)' : '' }">{{ state.summary.exceptionCount }}</div></div>
    </div>
    <div class="grid grid-4 gap-top">
      <div class="card stat"><div class="label">现金收款</div><div class="value">{{ fenToYuan(state.summary.cashFen) }}</div></div>
      <div class="card stat"><div class="label">线上收款</div><div class="value">{{ fenToYuan(state.summary.onlineFen) }}</div></div>
      <div class="card stat"><div class="label">已退款</div><div class="value">{{ fenToYuan(state.summary.refundFen) }}</div></div>
      <div class="card stat"><div class="label">支付中/待付</div><div class="value">{{ state.summary.unpaidCount }}</div></div>
    </div>
    <div class="card gap-top">
      <h3>运行状态</h3>
      <div class="row wrap">
        <span class="badge" :class="state.summary.diskFreeMb > 200 ? 'b-PAID' : 'b-EXCEPTION'">磁盘剩余 {{ gb(state.summary.diskFreeMb) }} GB</span>
        <span class="badge b-PENDING">时钟偏差：开发桩未接入</span>
        <span class="badge b-PENDING">昨日对账：开发桩未接入</span>
      </div>
      <p class="kbd gap-top">磁盘容量取自本机真实可用空间；时钟偏差与每日对账属 W5/W6，开发桩未实现，因此不做绿色断言。</p>
    </div>
  </div>
  <p v-else class="muted">加载中…</p>
</template>
