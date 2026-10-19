/* 動作示意圖的產生腳本（一次性，圖已進 repo；之後新增動作時重跑）。
   來源：free-exercise-db（https://github.com/yuhonas/free-exercise-db ，The Unlicense，LICENSE.md 在 repo 根目錄）。
   注意：該 repo 的照片轉自 wrkout/exercises.json，原始拍攝來源 repo 沒有交代——「公有領域」是 repo 作者的宣告。
   **下載釘在固定 commit**（不跟 main）：上游內容會變，重跑要得到同樣的圖；要更新就換 SHA 並看 diff。
   對照表 `scripts/exercise-images.json`：{ 動作 key: 資料集的動作 id }。
   產出兩組（原圖 850×567，3:2）：
   - 縮圖 `src/assets/exercises/<key>.webp`：第一張（起始姿勢），寬 240，約 3–11KB。
   - 放大圖 `src/assets/exercises-large/<key>-0.webp`（起始）與 `<key>-1.webp`（收尾），寬 640，約 4–40KB；
     資料集沒有第二張、或第二張與第一張完全相同的動作只有 -0（檢視器退成單張）。這類動作每次重跑都會重抓一次
     兩張圖（沒有 -1 檔可供判斷「已做過」），只有少數幾個，不值得為它記狀態。
   需要 ffmpeg（含 libwebp）在 PATH。用法：node scripts/build-exercise-images.mjs [--force] */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const map = JSON.parse(readFileSync(join(root, 'scripts/exercise-images.json'), 'utf8'))
const outDir = join(root, 'src/assets/exercises')
const largeDir = join(root, 'src/assets/exercises-large')
const force = process.argv.includes('--force')
const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'
const BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${COMMIT}/exercises`
// key 會組成輸出檔名、datasetId 會組成網址：只收安全字元，對照表被改壞時直接停（不會寫到 outDir 以外、也不會打到別的路徑）
const SAFE = /^[A-Za-z0-9_-]+$/
mkdirSync(outDir, { recursive: true })
mkdirSync(largeDir, { recursive: true })
// 暫存放在每次新建的私有目錄，不用固定檔名（共用 /tmp 的系統上可被預先放 symlink）
const tmpDir = mkdtempSync(join(tmpdir(), 'tally-ex-'))

/** 下載 <datasetId>/<n>.jpg；404 回 null（該動作沒有這一張），其餘失敗直接丟。 */
async function download(key, datasetId, n) {
  const res = await fetch(`${BASE}/${datasetId}/${n}.jpg`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${key}（${datasetId}/${n}）下載失敗：HTTP ${res.status}`)
  const tmp = join(tmpDir, `${key}-${n}.jpg`)
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  return tmp
}

function toWebp(tmp, out, width, quality) {
  // 指定輸入格式為 jpeg、只准讀本機檔：不讓 ffmpeg 依內容猜成 playlist 之類會再去抓別的資源的格式
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-f', 'jpeg_pipe', '-i', tmp, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', out])
  return statSync(out).size
}

let made = 0
let total = 0
let madeLarge = 0
let totalLarge = 0
const noEnd = []
try {
  for (const [key, datasetId] of Object.entries(map)) {
    if (!SAFE.test(key) || !SAFE.test(datasetId)) throw new Error(`對照表含不合法字元：${key} → ${datasetId}`)
    const thumb = join(outDir, `${key}.webp`)
    const large0 = join(largeDir, `${key}-0.webp`)
    const large1 = join(largeDir, `${key}-1.webp`)
    const needThumb = force || !existsSync(thumb)
    const need0 = force || !existsSync(large0)
    const need1 = force || !existsSync(large1)
    if (!needThumb && !need0 && !need1) continue
    const tmp = await download(key, datasetId, 0)
    if (!tmp) throw new Error(`${key}（${datasetId}）沒有第一張圖`)
    if (needThumb) { total += toWebp(tmp, thumb, 240, 60); made++ }
    if (need0) { totalLarge += toWebp(tmp, large0, 640, 60); madeLarge++ }
    if (need1) {
      const tmp1 = await download(key, datasetId, 1)
      // 有些動作上游的兩張是同一張圖（例：reverse-grip-barbell-row）：並排放兩張一樣的照片沒有意義，當作沒有收尾姿勢
      if (tmp1 && !readFileSync(tmp).equals(readFileSync(tmp1))) { totalLarge += toWebp(tmp1, large1, 640, 60); madeLarge++ } else noEnd.push(key)
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
console.log(`縮圖 ${made} 張，共 ${(total / 1024).toFixed(0)} KB；放大圖 ${madeLarge} 張，共 ${(totalLarge / 1024).toFixed(0)} KB`)
if (noEnd.length > 0) console.log(`沒有收尾姿勢（只有單張）：${noEnd.join(', ')}`)
