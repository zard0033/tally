/* 動作示意圖的產生腳本（一次性，圖已進 repo；之後新增動作時重跑）。
   來源：free-exercise-db（https://github.com/yuhonas/free-exercise-db ，The Unlicense，LICENSE.md 在 repo 根目錄）。
   注意：該 repo 的照片轉自 wrkout/exercises.json，原始拍攝來源 repo 沒有交代——「公有領域」是 repo 作者的宣告。
   **下載釘在固定 commit**（不跟 main）：上游內容會變，重跑要得到同樣的圖；要更新就換 SHA 並看 diff。
   對照表 `scripts/exercise-images.json`：{ 動作 key: 資料集的動作 id }。每個動作取第一張（起始姿勢）。
   產出：`src/assets/exercises/<key>.webp`，寬 240（原圖 850×567，3:2），約 3–11KB 一張。
   需要 ffmpeg（含 libwebp）在 PATH。用法：node scripts/build-exercise-images.mjs [--force] */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const map = JSON.parse(readFileSync(join(root, 'scripts/exercise-images.json'), 'utf8'))
const outDir = join(root, 'src/assets/exercises')
const force = process.argv.includes('--force')
const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5'
const BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${COMMIT}/exercises`
// key 會組成輸出檔名、datasetId 會組成網址：只收安全字元，對照表被改壞時直接停（不會寫到 outDir 以外、也不會打到別的路徑）
const SAFE = /^[A-Za-z0-9_-]+$/
mkdirSync(outDir, { recursive: true })
// 暫存放在每次新建的私有目錄，不用固定檔名（共用 /tmp 的系統上可被預先放 symlink）
const tmpDir = mkdtempSync(join(tmpdir(), 'tally-ex-'))

let made = 0
let total = 0
try {
  for (const [key, datasetId] of Object.entries(map)) {
    if (!SAFE.test(key) || !SAFE.test(datasetId)) throw new Error(`對照表含不合法字元：${key} → ${datasetId}`)
    const out = join(outDir, `${key}.webp`)
    if (existsSync(out) && !force) continue
    const res = await fetch(`${BASE}/${datasetId}/0.jpg`)
    if (!res.ok) throw new Error(`${key}（${datasetId}）下載失敗：HTTP ${res.status}`)
    const tmp = join(tmpDir, `${key}.jpg`)
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
    // 指定輸入格式為 jpeg、只准讀本機檔：不讓 ffmpeg 依內容猜成 playlist 之類會再去抓別的資源的格式
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-protocol_whitelist', 'file', '-f', 'jpeg_pipe', '-i', tmp, '-vf', 'scale=240:-2:flags=lanczos', '-c:v', 'libwebp', '-quality', '60', '-compression_level', '6', out])
    made++
    total += statSync(out).size
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
console.log(`產生 ${made} 張，共 ${(total / 1024).toFixed(0)} KB`)
