/* burn-in：這次改到的 e2e 測試在 CI 上各重複跑 N 次、不重試，讓「本機綠、CI 慢機器偶發紅」的新測試在第一次 push 就紅，
   而不是之後隨機冒出來（2026-11-10～13 雲端全量紅 8 次，5 次是這類，見 wiki e2e-reference）。

   用法：node scripts/e2e-burnin.mjs <base-ref> [--dry]
   選法：git diff 出 e2e/*.spec.ts 改到的行，落在哪條 test() 的範圍內就選那條；改到 test() 外面（共用 helper、檔頭）不選——
   影響面看不出來，交給全量。超過 MAX 條就不跑、只出警告，大改動同樣交給全量。 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPEAT = 5
const MAX = 20

const root = fileURLToPath(new URL('..', import.meta.url))
const base = process.argv[2]
const dry = process.argv.includes('--dry')
if (!base || base.startsWith('--')) throw new Error('用法：node scripts/e2e-burnin.mjs <base-ref> [--dry]')

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失敗：${r.stderr}`)
  return r.stdout
}

// 新版那一側改到的行號；純刪除的 hunk（+N,0）記刪除位置那一行
const changed = new Map()
let file = null
for (const line of run('git', ['diff', '-U0', `${base}...HEAD`, '--', 'e2e/*.spec.ts']).split('\n')) {
  if (line.startsWith('+++ ')) file = line === '+++ /dev/null' ? null : path.basename(line.slice(6))
  const m = file && line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/)
  if (!m) continue
  const start = Number(m[1])
  const count = m[2] === undefined ? 1 : Number(m[2])
  const lines = changed.get(file) ?? new Set()
  for (let i = 0; i < Math.max(count, 1); i++) lines.add(start + i)
  changed.set(file, lines)
}

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const list = JSON.parse(run(process.execPath, [cli, 'test', '--list', '--reporter=json']))
const specs = []
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s)
  for (const s of suite.specs ?? []) specs.push(s)
}
list.suites.forEach(walk)

// test() 的結尾＝之後第一行縮排相同的 `})`
const selected = []
for (const [f, lines] of changed) {
  const src = readFileSync(path.join(root, 'e2e', f), 'utf8').split('\n')
  for (const s of specs.filter((x) => x.file === f)) {
    const indent = src[s.line - 1].match(/^\s*/)[0]
    let end = s.line
    while (end < src.length && !src[end].startsWith(`${indent}})`)) end++
    const last = end + 1
    if ([...lines].some((l) => l >= s.line && l <= last)) selected.push({ loc: `e2e/${f}:${s.line}`, title: s.title })
  }
}

if (selected.length === 0) {
  console.log('burn-in：這次沒有改到任何 test() 本體，跳過')
  process.exit(0)
}
console.log(`burn-in：選到 ${selected.length} 條，各跑 ${REPEAT} 次`)
for (const s of selected) console.log(`  - ${s.loc}  ${s.title}`)
if (selected.length > MAX) {
  console.log(`::warning::burn-in 選到 ${selected.length} 條，超過 ${MAX}，跳過（交給全量）`)
  process.exit(0)
}
if (dry) process.exit(0)

const r = spawnSync(
  process.execPath,
  [cli, 'test', ...selected.map((s) => s.loc), `--repeat-each=${REPEAT}`, '--retries=0', '--workers=1'],
  { cwd: root, stdio: 'inherit' },
)
process.exit(r.status ?? 1)
