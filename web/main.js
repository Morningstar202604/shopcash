import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './styles.css'
import { api, state } from './store.js'

import SetupView from './views/SetupView.vue'
import LoginView from './views/LoginView.vue'
import DashboardView from './views/DashboardView.vue'
import CashierView from './views/CashierView.vue'
import OrdersView from './views/OrdersView.vue'
import ShiftsView from './views/ShiftsView.vue'
import ExceptionsView from './views/ExceptionsView.vue'
import ChannelsView from './views/ChannelsView.vue'

const routes = [
  { path: '/setup', component: SetupView, meta: { public: true, bare: true } },
  { path: '/login', component: LoginView, meta: { public: true, bare: true } },
  { path: '/dashboard', component: DashboardView, meta: { ownerOnly: true } },
  { path: '/cashier', component: CashierView },
  { path: '/orders', component: OrdersView },
  { path: '/shifts', component: ShiftsView },
  { path: '/exceptions', component: ExceptionsView, meta: { ownerOnly: true } },
  { path: '/channels', component: ChannelsView, meta: { ownerOnly: true } },
]

const router = createRouter({ history: createWebHistory(), routes })

let bootChecked = false

// 守卫顺序：未完成首启 → /setup；未登录 → /login；mustChangePwd → /change-password；角色不足 → /cashier
router.beforeEach(async (to) => {
  if (!bootChecked) {
    try {
      const bs = await api('/bootstrap/state')
      state.setupDone = bs.setupDone
    } catch {
      state.setupDone = true
    }
    bootChecked = true
  }

  if (!state.setupDone && to.path !== '/setup') return '/setup'
  if (state.setupDone && to.path === '/setup') return '/login'

  if (to.meta.public) return true

  if (!state.me) {
    try {
      state.me = await api('/auth/me')
    } catch {
      return '/login'
    }
  }
  if (state.me?.mustChangePwd) return false
  if (to.meta.ownerOnly && state.me?.role !== 'OWNER') return '/cashier'
  return true
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

export { router, routes }
