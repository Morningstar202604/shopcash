/**
 * Vue 模板绑定自检：tsc 不覆盖 .vue，模板里漏 import 的标识符会让页面静默渲染成空态。
 * 这里用最笨但有效的办法兜住：模板里出现、但 `<script setup>` 里既没 import 也没声明的标识符 → 报错。
 * 只检查项目自有的已知符号，避免把 HTML 属性、内联表达式里的局部变量误判。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), 'web')
const STORE = path.join(ROOT, 'store.js')

function exportedNames(file) {
  const src = fs.readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of src.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  return names
}

function sharedNames() {
  const dir = path.resolve(process.cwd(), 'packages/shared/src')
  const names = new Set()
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'index.ts')) {
    for (const name of exportedNames(path.join(dir, f))) names.add(name)
  }
  return names
}

function vueFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return vueFiles(p)
    return e.name.endsWith('.vue') ? [p] : []
  })
}

const KNOWN = new Set([...exportedNames(STORE), ...sharedNames()])
const problems = []

for (const file of vueFiles(ROOT)) {
  const src = fs.readFileSync(file, 'utf8')
  const scriptMatch = src.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  const script = scriptMatch ? scriptMatch[1] : ''
  const template = src.replace(/<script[^>]*>[\s\S]*?<\/script>/, '')

  const declared = new Set()
  for (const m of script.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    if (m[1]) declared.add(m[1])
    if (m[2]) for (const part of m[2].split(',')) {
      const name = part.split(/\s+as\s+/).pop().trim()
      if (name) declared.add(name)
    }
  }
  for (const m of script.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
  for (const m of script.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (name) declared.add(name)
    }
  }

  // 只取「表达式位置」：{{ ... }} 与 v-*/:*/@* 绑定值，避免把 class 名、HTML 属性误判成标识符
  const expressions = []
  for (const m of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) expressions.push(m[1])
  for (const m of template.matchAll(/\s(?:v-[\w:.-]+|[:@][\w.:-]+)\s*=\s*"([^"]*)"/g)) expressions.push(m[1])
  const exprText = expressions.join('\n')

  for (const name of KNOWN) {
    const inTemplate = new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(exprText)
    if (inTemplate && !declared.has(name)) {
      problems.push(`${path.relative(process.cwd(), file)}: 模板表达式引用了 ${name}，但 <script setup> 里没有 import/声明`)
    }
  }
}

if (problems.length) {
  console.error('Vue 模板绑定自检失败：')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log(`Vue 模板绑定自检通过：${vueFiles(ROOT).length} 个 .vue 文件、已知符号 ${KNOWN.size} 个`)
