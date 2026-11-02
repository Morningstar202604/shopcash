import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './styles.css'
import { api, state, refreshMe } from './store.js'

import SetupView from './views/SetupView.vue'
import LoginView from './views/LoginView.vue'
import DashboardView from './views/DashboardView.vue'
import CashierView from './views/CashierView.vue'
import OrdersView from './views/OrdersView.vue'
import ShiftsView from './views/ShiftsView.vue'
import ExceptionsView from './views/ExceptionsView.vue'
import ChannelsView from './views/ChannelsView.vue'
import UnavailableView from './views/UnavailableView.vue'

const routes = [
  { path: '/setup', component: SetupView, meta: { public: true, bare: true } },
  { path: '/login', component: LoginView, meta: { public: true, bare: true } },
  { path: '/dashboard', component: DashboardView, meta: { manage: true } },
  { path: '/cashier', component: CashierView },
  { path: '/orders', component: OrdersView },
  { path: '/shifts', component: ShiftsView },
  { path: '/refunds', component: UnavailableView, meta: { manage: true } },
  { path: '/exceptions', component: ExceptionsView, meta: { manage: true } },
  { path: '/channels', component: ChannelsView, meta: { manage: true } },
  { path: '/stores', component: UnavailableView, meta: { manage: true } },
  { path: '/staff', component: UnavailableView, meta: { manage: true } },
  { path: '/audit', component: UnavailableView, meta: { manage: true } },
]

const router = createRouter({ history: createWebHistory(), routes })

let bootChecked = false

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

  if (to.path === '/setup') {
    if (!state.setupDone && !state.token) return true
    if (!state.token) return '/login'
  }
  if (!state.setupDone && to.path !== '/setup' && !state.token) return '/setup'

  if (to.meta.public) return true

  if (!state.me) {
    try {
      state.me = await refreshMe()
      if (!state.summary) await api('/dashboard/summary').then((d) => (state.summary = d))
    } catch {
      return '/login'
    }
  }
  if (to.meta.manage && !['OWNER', 'MANAGER'].includes(state.me?.role)) return '/cashier'
  return true
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

export { router, routes }
