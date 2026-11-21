/* 煙霧層 e2e：只跑 e2e/smoke.json 列的那幾十條（核心路徑＋tally.spec 的大回歸），
   開發中與 push 前快速確認「沒把東西弄壞」用；不能取代全量 `npm run e2e`，全量排在 push 後（見 CLAUDE.md）。

   清單存的是測試標題原文，這裡逃脫 regex 特殊字元後用 `|` 串成一個 -g。
   其餘參數原樣轉給 playwright（例如 `--list` 可以核對選到幾條）。
   直接用 node 呼叫 playwright 的 cli、不經 shell：標題裡的 `|`、引號、中文在 cmd 下會被吃掉。 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const titles = JSON.parse(readFileSync(new URL('../e2e/smoke.json', import.meta.url), 'utf8'))

/* 標題對不到任何測試就停：-g 是 regex，對不到的那條不報錯、只會靜默少跑一條
   （v2.149 改了測試標題，smoke 從 55 條掉成 54 條才發現） */
const specs = readdirSync(new URL('../e2e', import.meta.url))
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => readFileSync(new URL(`../e2e/${f}`, import.meta.url), 'utf8'))
  .join('\n')
const missing = titles.filter((t) => !specs.includes(t))
if (missing.length > 0) {
  console.error(`e2e/smoke.json 有 ${missing.length} 條標題對不到任何測試（改了標題要一起改清單）：`)
  for (const t of missing) console.error(`  - ${t}`)
  process.exit(1)
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const grep = titles.map(escape).join('|')

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const r = spawnSync(process.execPath, [cli, 'test', '-g', grep, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})
process.exit(r.status ?? 1)
