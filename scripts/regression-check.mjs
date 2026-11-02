import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { computed, reactive, ref, onMounted, onUnmounted } from 'vue'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const failures = []

function loadView(path, names, extra = {}) {
 const source = read(path).match(/<script setup>([\s\S]*?)<\/script>/)[1]
 .replace(/^import .*$/gm, '')
 const context = vm.createContext({ computed, reactive, ref, onMounted: () => {}, onUnmounted: () => {}, ...extra })
 vm.runInContext(`${source}\nObject.assign(globalThis, { ${names.join(', ')} })`, context)
 return context
}

async function test(name, run) {
 try {
 await run()
 console.log(`PASS ${name}`)
 } catch (error) {
 failures.push(name)
 console.error(`FAIL ${name}: ${error.message}`)
 }
}

await test('setup success updates routing state before navigation', async () => {
 const state = { setupDone: false }
 let destination
 const view = loadView('web/views/SetupView.vue', ['form', 'submit'], {
 state,
 useRouter: () => ({ push: (path) => { destination = state.setupDone ? path : '/setup' } }),
 api: async () => ({}), toast: () => {}, PASSWORD_MIN_LENGTH:8,
 checkPassword: () => ({ failed: [] }),
 })
 Object.assign(view.form, { orgName: 'Test Org', storeName: 'Test', username: 'owner', password: 'ValidPass123', confirm: 'ValidPass123' })
 await view.submit()
 assert.equal(destination, '/login')
 assert.equal(state.setupDone, true)
})

await test('00 keypad respects two decimal places', () => {
 const view = loadView('web/views/CashierView.vue', ['amountText', 'pressKey'], {
 state: {}, api: () => {}, toast: () => {}, refreshSummary: () => {}, beep: () => {}, STATUS_TEXT: {}, CODE_TEXT: {},
 yuanToFen: () =>1, fenToYuan: () => '', formatTime: () => '', AmountError: Error,
 })
 for (const key of ['1', '.', '2', '00']) view.pressKey(key)
 assert.equal(view.amountText.value, '1.2')
 view.pressKey('C')
 for (const key of ['1', '.', '00']) view.pressKey(key)
 assert.equal(view.amountText.value, '1.00')
})

await test('channel cancellation and switching clear all form fields', () => {
 const view = loadView('web/views/ChannelsView.vue', ['form', 'panel', 'edit', 'cancel'], { api: () => {}, toast: () => {} })
 const template = read('web/views/ChannelsView.vue')
 const cancel = template.match(/<button @click="([^"]+)">取消<\/button>/)[1]
 const fill = () => Object.assign(view.form, { appid: 'app', mchid: 'merchant', privateKeyPem: 'private', apiV3Key: 'secret', confirmPassword: 'password' })
 const empty = () => ['appid', 'mchid', 'privateKeyPem', 'apiV3Key', 'confirmPassword'].forEach((key) => assert.equal(view.form[key], '', key))
 view.edit({ code: 'wechat' })
 fill()
 vm.runInContext(/^[\w$]+$/.test(cancel) ? `${cancel}()` : cancel.replace(/^panel\s*=\s*null$/, 'panel.value = null'), view)
 view.edit({ code: 'wechat' })
 empty()
 fill()
 view.edit({ code: 'alipay' })
 empty()
})

await test('channel form identifies credentials as unsaved demo data', () => {
 const source = read('web/views/ChannelsView.vue')
 assert.match(source, /演示模式不会保存凭据/)
 assert.doesNotMatch(source, /凭据已加密保存|加密保存并自检/)
})

if (failures.length) process.exitCode =1
