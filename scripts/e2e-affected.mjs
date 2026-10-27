/* 只跑受影響的 e2e spec。改動檔 = 對 origin/main 的差 ∪ 未暫存 ∪ 已暫存 ∪ 未追蹤，
   對照下面的表換成 spec 清單。

   fail-safe：src/、e2e/ 或設定檔裡「表上沒有」的改動一律跑全量並說明原因——
   漏列只會多跑，不會漏測。純文件／狀態檔（見 IGNORED）不觸發任何 spec。

   用法：node scripts/e2e-affected.mjs [--dry] [playwright 參數…]
   --dry   只印選到的 spec 清單（或 FULL＋原因），不跑
   --files a,b,c   隱藏旗標，用給定清單取代 git 偵測（測試這支腳本用）

   positional 參數是對檔案路徑比對的 regex，而 repo 路徑含 "Tally"，所以一律傳
   `e2e/<name>\.spec\.ts`，不能傳裸字（`tally` 會比到全部）。
   直接用 node 呼叫 playwright 的 cli、不經 shell。退出碼＝playwright 的。 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const TRAIN = ['training', 'rest-timer', 'spring-sheet', 'sync-sheet', 'weight-suggest']
const ANALYSIS = ['analysis', 'recovery-foreground']
const FOOD = [
  'tally', 'interaction', 'quota-warning', 'food-library', 'vendor-autocomplete',
  'inline-edit', 'intake-detail', 'meal-exit-animation', 'form-macros-align',
]
const SETTINGS = ['settings-nav', 'daily-goal', 'weight-trend']

/* 動作庫／食品庫的入口列在設定頁，settings-nav 守「三個入口都進得去」，所以兩個庫多帶它 */
const SCREENS = {
  TrainingSession: TRAIN, SetSheet: TRAIN, CardioSheet: TRAIN, ExercisePicker: TRAIN,
  ExerciseEditSheet: TRAIN, ExerciseLibrary: [...TRAIN, 'settings-nav'], FinishSheet: TRAIN,
  StartSheet: TRAIN, SyncSheet: TRAIN, RoutineEditor: TRAIN, RoutineNameSheet: TRAIN,
  RoutineTargetSheet: TRAIN,
  Training: [...TRAIN, ...ANALYSIS], // 訓練分析的入口列在訓練頁
  Analysis: ANALYSIS,
  Today: FOOD, LogSheet: FOOD, FoodLibrary: [...FOOD, 'settings-nav'],
  Settings: SETTINGS, DailyGoal: SETTINGS, MaintenanceCard: SETTINGS, WeightTrend: SETTINGS,
  Login: ['interaction'],
}

/* 只被訓練／分析用到的邏輯層與 hook（import 關係查過）。分析讀訓練底，所以資料層的改動兩邊都帶 */
const FILES = {
  'src/useTraining.ts': [...TRAIN, ...ANALYSIS],
  'src/trainingSync.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/training.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/trainingRuntime.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/queue.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/queueStore.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/sender.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/exerciseCatalog.ts': [...TRAIN, ...ANALYSIS],
  'src/lib/restTimer.ts': TRAIN,
  'src/lib/recovery.ts': ANALYSIS,
  'src/lib/strength.ts': ANALYSIS,
  'src/lib/weightTrend.ts': [...ANALYSIS, 'weight-trend'],
  'src/lib/baseline.ts': SETTINGS,
}

/* 不影響任何 e2e 的路徑：文件、狀態、腳本、建置產物、後端定義（e2e 的 fetch 全 stub）、
   vitest 的單元測試（由 `npx vitest run` 守） */
const IGNORED = [
  /\.md$/, /^\.omc\//, /^scripts\//, /^session-state\//, /^test-results\//, /^dist\//,
  /^_design-sample\//, /^supabase\//, /^schema\.sql$/, /^\.gitignore$/, /^\.claude\//,
  /^e2e\/smoke\.json$/, /^e2e\/shots\//, /^src\/lib\/.*\.test\.ts$/,
]

/** 回傳 { ignore } | { css } | { full: 原因 } | { specs: [名稱…] } */
function classify(file) {
  if (IGNORED.some((re) => re.test(file))) return { ignore: true }
  if (file === 'src/app.css') return { css: true }
  const spec = file.match(/^e2e\/([^/]+)\.spec\.ts$/)
  if (spec) return { specs: [spec[1]] }
  const screen = file.match(/^src\/screens\/([^/]+)\.tsx$/)
  if (screen && SCREENS[screen[1]]) return { specs: SCREENS[screen[1]] }
  if (FILES[file]) return { specs: FILES[file] }
  return { full: `${file}（共用或表上沒有）` }
}

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const filesIdx = args.indexOf('--files')
const forced = filesIdx >= 0 ? args[filesIdx + 1] : null
const passthrough = args.filter((a, i) => a !== '--dry' && a !== '--files' && !(filesIdx >= 0 && i === filesIdx + 1))

function git(...a) {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} 失敗`)
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

let changed
let gitFailure = null
if (forced !== null) {
  changed = forced.split(',').map((s) => s.trim()).filter(Boolean)
} else {
  try {
    changed = [...new Set([
      ...git('diff', '--name-only', 'origin/main'),
      ...git('diff', '--name-only'),
      ...git('diff', '--name-only', '--cached'),
      ...git('ls-files', '--others', '--exclude-standard'),
    ])]
  } catch (e) {
    gitFailure = e.message
  }
}

const reasons = []
const specs = new Set()
let cssTouched = false
if (gitFailure) {
  reasons.push(`${gitFailure}，無法判斷改了什麼`)
} else {
  for (const f of changed) {
    const c = classify(f)
    if (c.full) reasons.push(c.full)
    else if (c.css) cssTouched = true
    else if (c.specs) c.specs.forEach((s) => specs.add(s))
  }
  if (cssTouched && specs.size === 0 && reasons.length === 0) {
    reasons.push('src/app.css 是唯一改動的 src 檔，沒有別的檔可以界定範圍')
  }
}

const full = reasons.length > 0
if (!full && cssTouched) {
  console.warn('!!! 警告 app.css changed: 若動的是全域規則或 token，請改跑全量 `npm run e2e`')
}

/* 已刪除的 spec 不能傳給 playwright（會變成「No tests found」） */
const list = [...specs].filter((s) => existsSync(new URL(`../e2e/${s}.spec.ts`, import.meta.url)))
const positional = list.map((s) => `e2e/${s}\\.spec\\.ts`)

console.log(`改動檔 ${changed?.length ?? '?'} 個`)
if (full) {
  console.log('FULL（跑全量）：')
  reasons.forEach((r) => console.log(`  - ${r}`))
} else if (positional.length === 0) {
  console.log('沒有影響 e2e 的改動，不跑。')
} else {
  console.log(`受影響的 spec ${positional.length} 個：`)
  list.forEach((s) => console.log(`  - e2e/${s}.spec.ts`))
}

if (dry || (!full && positional.length === 0)) process.exit(0)

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const r = spawnSync(process.execPath, [cli, 'test', ...(full ? [] : positional), ...passthrough], {
  cwd: root,
  stdio: 'inherit',
})
process.exit(r.status ?? 1)
