<script setup>
import { reactive, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { api, state, toast } from '../store.js'
import { checkPassword, PASSWORD_MIN_LENGTH } from '@shopcash/shared'

const router = useRouter()
const form = reactive({ orgName: '', storeName: '', username: 'owner', password: '', confirm: '' })
const err = ref('')
const busy = ref(false)

const verdict = computed(() => checkPassword(form.password, form.username))
const pwdChecks = computed(() => [
  { label: `至少 ${PASSWORD_MIN_LENGTH} 位`, ok: form.password.length >= PASSWORD_MIN_LENGTH },
  { label: '含大写与小写', ok: /[A-Z]/.test(form.password) && /[a-z]/.test(form.password) },
  { label: '含数字', ok: /\d/.test(form.password) },
  { label: '不等于用户名', ok: !!form.password && form.password.toLowerCase() !== form.username.trim().toLowerCase() },
  { label: '不是常见弱口令', ok: !!form.password && !verdict.value.failed.includes('不是常见弱口令') },
  { label: '两次输入一致', ok: !!form.password && form.password === form.confirm },
])
const pwdOk = computed(() => pwdChecks.value.every((c) => c.ok))

async function submit() {
  err.value = ''
  if (!form.orgName.trim()) return (err.value = '请填写机构名称')
  if (!form.storeName.trim()) return (err.value = '请填写首家门店名称')
  if (!/^[a-z0-9_]{4,20}$/.test(form.username.trim().toLowerCase())) return (err.value = '登录名需 4-20 位小写字母、数字或下划线')
  if (!pwdOk.value) return (err.value = `口令不符合要求：${verdict.value.failed.join('、') || '两次输入不一致'}`)
  busy.value = true
  try {
    await api('/bootstrap/setup', {
      method: 'POST',
      body: {
        orgName: form.orgName.trim(),
        storeName: form.storeName.trim(),
        username: form.username.trim().toLowerCase(),
        password: form.password,
      },
    })
    state.setupDone = true
    toast('ok', '平台初始化完成，请登录')
    router.push('/login')
  } catch (e) {
    err.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="center">
    <div class="card setup-card">
      <h1>创建运营平台</h1>
      <p class="muted">初始化会创建机构、首家门店和平台所有者账号。所有者口令同时用于退款审批、异常结案等敏感操作。</p>

      <div class="field"><label>机构名称</label><input v-model="form.orgName" maxlength="60" placeholder="如：河南路王记便利店有限公司" /></div>
      <div class="field"><label>首家门店名称</label><input v-model="form.storeName" maxlength="60" placeholder="如：河南路王记便利店" /></div>
      <div class="field"><label>所有者登录名</label><input v-model="form.username" maxlength="20" /></div>
      <div class="field"><label>设置口令</label><input v-model="form.password" type="password" /></div>
      <div class="field"><label>再输一遍</label><input v-model="form.confirm" type="password" @keyup.enter="submit" /></div>

      <div class="row wrap gap-top">
        <span v-for="c in pwdChecks" :key="c.label" class="badge" :class="c.ok ? 'b-PAID' : 'b-PENDING'">
          {{ c.ok ? '✓' : '○' }} {{ c.label }}
        </span>
      </div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn-primary btn-lg gap-top" style="width: 100%" :disabled="!pwdOk || !form.orgName.trim() || !form.storeName.trim() || busy" @click="submit">
        {{ busy ? '创建中…' : '创建平台并登录' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.center { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.setup-card { width: 560px; max-width: 100%; }
</style>
