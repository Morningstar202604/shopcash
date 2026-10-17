<script setup>
import { onMounted, reactive, ref } from 'vue'
import { api, toast } from '../store.js'

const channels = ref([])
const form = reactive({ code: '', appid: '', mchid: '', privateKeyPem: '', apiV3Key: '', confirmPassword: '' })
const panel = ref(null)
const err = ref('')

async function load() {
  channels.value = await api('/channels')
}

function edit(c) {
  panel.value = c.code
  form.code = c.code
  err.value = ''
}

async function save() {
  err.value = ''
  if (!form.confirmPassword) return (err.value = '保存渠道凭据需要店主口令二次确认')
  try {
    await api(`/channels/${form.code}/credentials`, { method: 'PUT', body: { ...form } })
    toast('ok', '凭据已加密保存')
    panel.value = null
    form.confirmPassword = ''
    await load()
  } catch (e) {
    err.value = e.message
  }
}

async function check(c) {
  try {
    const r = await api(`/channels/${c.code}/check`, { method: 'POST' })
    toast(r.lastCheckOk ? 'ok' : 'warn', r.lastCheckMsg)
    await load()
  } catch (e) {
    toast('err', e.message)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="card">
      <h2>收款渠道</h2>
      <p class="muted">
        资金直接进入本店的微信/支付宝商户号（T+1 自动提现到本店银行卡）。本软件不持有、不归集、不转发任何资金，
        也不提供余额、充值、提现、转账、分账功能。
      </p>
      <div class="grid grid-4">
        <div v-for="c in channels" :key="c.code" class="card stat equal">
          <div class="row">
            <h3 style="margin: 0">{{ c.name }}</h3>
            <span class="spacer" style="flex: 1"></span>
            <span class="badge" :class="c.enabled ? 'b-PAID' : 'b-PENDING'">{{ c.enabled ? '已启用' : '未启用' }}</span>
          </div>
          <p class="kbd">{{ c.mode === 'DIRECT' ? '直连商户' : '服务商' }} ｜ {{ c.configured ? '凭据已配置' : '凭据未配置' }}</p>
          <p style="color: var(--text); font-size: 13px">{{ c.lastCheckMsg || '尚未自检' }}</p>
          <div class="row">
            <button @click="check(c)">配置自检</button>
            <button v-if="c.code !== 'mock'" @click="edit(c)">填写凭据</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="panel" class="card">
      <div class="card-title"><h2>配置 {{ panel }} 商户凭据</h2><button @click="panel = null">取消</button></div>
      <p class="muted">私钥与 APIv3 密钥会用本机密钥文件加密后存储，界面只显示掩码。请勿把这些内容截图或发给任何人。</p>
      <div class="grid grid-2">
        <div class="field"><label>AppID</label><input v-model="form.appid" placeholder="wx…" /></div>
        <div class="field"><label>商户号</label><input v-model="form.mchid" placeholder="1900…" /></div>
      </div>
      <div class="field">
        <label>商户 API 私钥（PEM）</label>
        <textarea v-model="form.privateKeyPem" rows="3" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
      </div>
      <div class="field"><label>APIv3 密钥</label><input v-model="form.apiV3Key" type="password" /></div>
      <div class="field"><label>店主口令（二次确认）</label><input v-model="form.confirmPassword" type="password" /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn-primary btn-lg gap-top" @click="save">加密保存并自检</button>
    </div>
  </div>
</template>
