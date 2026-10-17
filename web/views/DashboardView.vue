<script setup>
import { onMounted } from 'vue'
import { state, refreshSummary } from '../store.js'

onMounted(refreshSummary)
</script>

<template>
  <div v-if="state.summary">
    <div class="grid grid-4">
      <div class="card stat"><div class="label">今日订单</div><div class="value">{{ state.summary.todayCount }}</div></div>
      <div class="card stat"><div class="label">已到账笔数</div><div class="value">{{ state.summary.paidCount }}</div></div>
      <div class="card stat"><div class="label">已到账金额</div><div class="value">{{ (state.summary.paidFen / 100).toFixed(2) }}</div></div>
      <div class="card stat"><div class="label">待人工处理</div><div class="value" :style="{ color: state.summary.exceptionCount ? 'var(--danger)' : '' }">{{ state.summary.exceptionCount }}</div></div>
    </div>
    <div class="grid grid-4 gap-top">
      <div class="card stat"><div class="label">现金收款</div><div class="value">{{ (state.summary.cashFen / 100).toFixed(2) }}</div></div>
      <div class="card stat"><div class="label">线上收款</div><div class="value">{{ (state.summary.onlineFen / 100).toFixed(2) }}</div></div>
      <div class="card stat"><div class="label">已退款</div><div class="value">{{ (state.summary.refundFen / 100).toFixed(2) }}</div></div>
      <div class="card stat"><div class="label">支付中/待付</div><div class="value">{{ state.summary.unpaidCount }}</div></div>
    </div>
    <div class="card gap-top">
      <h3>运行状态</h3>
      <div class="row wrap">
        <span class="badge" :class="state.summary.diskFreeMb > 200 ? 'b-PAID' : 'b-EXCEPTION'">磁盘剩余 {{ (state.summary.diskFreeMb / 1024).toFixed(1) }} GB</span>
        <span class="badge" :class="state.summary.clockDriftMin > 2 ? 'b-EXCEPTION' : 'b-PAID'">系统时钟偏差 {{ state.summary.clockDriftMin }} 分钟</span>
        <span class="badge" :class="state.summary.diffCount ? 'b-EXCEPTION' : 'b-PAID'">昨日对账差异 {{ state.summary.diffCount }} 笔</span>
      </div>
    </div>
  </div>
  <p v-else class="muted">加载中…</p>
</template>
