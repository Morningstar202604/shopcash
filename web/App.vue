<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { state, refreshMe, refreshSummary, api } from './store.js'

const route = useRoute()
const router = useRouter()

const bare = computed(() => route.meta.bare === true)
const navItems = computed(() => {
  const all = [
    { to: '/cashier', label: '收银台' },
    { to: '/orders', label: '订单' },
    { to: '/shifts', label: '班次交接' },
    { to: '/dashboard', label: '总览' },
    { to: '/exceptions', label: `待处理${state.summary?.exceptionCount ? ` (${state.summary.exceptionCount})` : ''}` },
    { to: '/channels', label: '渠道配置' },
  ]
  if (state.me?.role !== 'OWNER') return all.filter((i) => !['/dashboard', '/exceptions', '/channels'].includes(i.to))
  return all
})

async function logout() {
  await api('/auth/logout', { method: 'POST' })
  state.me = null
  router.push('/login')
}

onMounted(async () => {
  if (!bare.value) {
    try {
      await refreshMe()
      await refreshSummary()
    } catch {
      /* 未登录由路由守卫处理 */
    }
  }
})
</script>

<template>
  <div v-if="bare" class="bare">
    <router-view />
  </div>
  <div v-else class="shell">
    <header class="topbar">
      <span class="brand">店收宝 ShopCash</span>
      <span class="muted">{{ state.summary?.storeName }}</span>
      <span class="spacer"></span>
      <span v-if="state.summary?.seed" class="kbd">演示数据 · 未接真实商户号</span>
      <span class="kbd">
        {{ state.me?.username || '—' }} · {{ state.me?.role === 'OWNER' ? '店主' : '店员' }} ·
        班次 {{ state.me?.shiftId ? '当班中' : '未开' }}
      </span>
      <button @click="logout">登出</button>
    </header>

    <nav class="nav">
      <router-link v-for="i in navItems" :key="i.to" :to="i.to" active-class="active">{{ i.label }}</router-link>
    </nav>

    <main class="main">
      <div v-if="state.banner" class="banner" :class="state.banner.level">{{ state.banner.text }}</div>
      <router-view />
    </main>

    <footer class="footer-note">
      本软件不持有、不归集、不转发任何资金；收款直接进入本店自己的微信/支付宝商户号。
    </footer>

    <div class="toast-host">
      <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </div>
  </div>
</template>
