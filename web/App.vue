<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { state, refreshMe, refreshSummary, switchStore, api, setToken, ROLE_TEXT } from './store.js'

const route = useRoute()
const router = useRouter()

const bare = computed(() => route.meta.bare === true)
const manage = computed(() => ['OWNER', 'MANAGER'].includes(state.me?.role))
const navItems = computed(() => {
  const all = [
    { to: '/cashier', label: '收银台' },
    { to: '/orders', label: '订单' },
    { to: '/shifts', label: '班次交接' },
    { to: '/dashboard', label: '经营总览', manage: true },
    { to: '/refunds', label: '退款', manage: true },
    { to: `/exceptions`, label: `待处理${state.summary?.exceptionCount ? ` (${state.summary.exceptionCount})` : ''}`, manage: true },
    { to: '/channels', label: '渠道', manage: true },
    { to: '/stores', label: '门店', manage: true },
    { to: '/staff', label: '员工', manage: true },
    { to: '/audit', label: '审计', manage: true },
  ]
  return manage.value ? all : all.filter((i) => !i.manage)
})

async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
  } catch {
    /* 会话已失效也必须可退出 */
  }
  setToken('')
  state.me = null
  state.summary = null
  router.push('/login')
}

async function changeStore(e) {
  const storeId = e.target.value
  if (!storeId || storeId === state.me?.storeId) return
  try {
    await switchStore(storeId)
    location.reload()
  } catch (err) {
    e.target.value = state.me?.storeId || ''
  }
}

onMounted(async () => {
  if (!bare.value && state.token) {
    try {
      await refreshMe()
      await refreshSummary()
    } catch {
      /* 未登录由路由守卫处理 */
    }
  }
})

watch(
  () => route.path,
  async () => {
    if (bare.value || !state.token) return
    try {
      await refreshSummary()
    } catch {
      /* 网络异常时保留上一次数据 */
    }
  },
)
</script>

<template>
  <div v-if="bare" class="bare">
    <router-view />
  </div>
  <div v-else class="shell">
    <header class="topbar">
      <span class="brand">ShopCash 门店运营平台</span>
      <span v-if="state.summary?.storeName" class="muted">{{ state.summary.storeName }}</span>
      <select
        v-if="state.stores.length > 1"
        class="store-switch"
        :value="state.me?.storeId"
        @change="changeStore"
        aria-label="切换门店"
      >
        <option v-for="s in state.stores" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <span class="spacer"></span>
      <span class="kbd">{{ state.me?.username || '—' }} · {{ ROLE_TEXT[state.me?.role] || state.me?.role }} · 班次 {{ state.summary?.shiftOpen ? '当班中' : '未开' }}</span>
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
      本软件不持有、不归集、不转发任何资金；收款直接进入各门店自己的微信/支付宝商户号。
    </footer>

    <div class="toast-host">
      <div v-for="t in state.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </div>
  </div>
</template>
