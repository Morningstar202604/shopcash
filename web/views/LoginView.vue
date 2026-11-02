<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, setToken, refreshMe, refreshSummary } from '../store.js'

const router = useRouter()
const form = reactive({ username: 'owner', password: '' })
const err = ref('')
const busy = ref(false)

async function submit() {
  err.value = ''
  if (!form.username || !form.password) return (err.value = '请输入登录名与口令')
  busy.value = true
  try {
 const result = await api('/auth/login', { method: 'POST', body: { username: form.username, password: form.password } })
 if (!result?.token) throw new Error('登录响应缺少会话令牌')
 setToken(result.token)
 await refreshMe()
    await refreshSummary()
    router.push('/cashier')
  } catch (e) {
    err.value = e.message
    if (e.code === 40311) form.password = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="center">
    <div class="card" style="width: 380px">
      <h1>店收宝 ShopCash</h1>
      <p class="muted">门店单机收银 · 数据只存本机</p>
      <div class="field">
        <label>登录名</label>
        <input v-model="form.username" @keyup.enter="submit" />
      </div>
      <div class="field">
        <label>口令</label>
        <input v-model="form.password" type="password" @keyup.enter="submit" />
      </div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn-primary btn-lg gap-top" style="width: 100%" :disabled="busy" @click="submit">
        {{ busy ? '登录中…' : '登录' }}
      </button>
      <p class="kbd gap-top">演示账号 owner / staff，口令见开发说明；仅本机监听 127.0.0.1</p>
    </div>
  </div>
</template>

<style scoped>
.center { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
</style>
