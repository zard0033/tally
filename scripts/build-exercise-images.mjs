/* 動作示意圖的取得腳本（一次性，圖已進 repo；之後新增動作時重跑）。
   來源：exercises-dataset（https://github.com/hasaneyldrm/exercises-dataset）。圖與 GIF 是 Gym visual 的
   （© Gym visual — https://gymvisual.com/），經版權方許可以 180×180 散布；使用者 2026-10-20 向 Gym visual 確認個人 App 可以使用。
   授權條款與致謝要求見 NOTICE.md；dataset 的 MIT 只涵蓋文字資料，不涵蓋圖。
   **下載釘在固定 commit**（不跟 main）：上游內容會變，重跑要得到同樣的圖；要更新就換 SHA 並看 diff。
   對照表 `scripts/exercise-images.json`：{ map: { 動作 key: 資料集的動作 id }, noImage: [沒有對應的 key] }。
   產出（原檔直接存，不轉檔、不縮放）：
   - 縮圖 `src/assets/exercises/<key>.jpg`：180×180，約 6–9KB，進 precache（離線看得到）。
   - 動畫 `src/assets/exercise-gifs/<key>.gif`：180×180，不進 precache（檢視器才載，離線退回縮圖）。
   用法：node scripts/build-exercise-images.mjs [--force] */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { map } = JSON.parse(readFileSync(join(root, 'scripts/exercise-images.json'), 'utf8'))
const thumbDir = join(root, 'src/assets/exercises')
const gifDir = join(root, 'src/assets/exercise-gifs')
const force = process.argv.includes('--force')
const COMMIT = '7455efae41b330c265e7cd4b78dfa848e7ce5ebd'
const BASE = `https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/${COMMIT}`
// key 會組成輸出檔名、路徑會組成網址：只收安全字元，對照表或資料集被改壞時直接停（不會寫到輸出目錄以外）
const SAFE_KEY = /^[A-Za-z0-9_-]+$/
const SAFE_PATH = /^(images|videos)\/[A-Za-z0-9_-]+\.(jpg|gif)$/
mkdirSync(thumbDir, { recursive: true })
mkdirSync(gifDir, { recursive: true })

async function get(path) {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`${path} 下載失敗：HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const dataset = JSON.parse((await get('data/exercises.json')).toString('utf8'))
const byId = new Map(dataset.map((r) => [r.id, r]))
let thumbs = 0
let gifs = 0
let thumbBytes = 0
let gifBytes = 0
for (const [key, id] of Object.entries(map)) {
  if (!SAFE_KEY.test(key)) throw new Error(`對照表含不合法的 key：${key}`)
  const row = byId.get(id)
  if (!row) throw new Error(`${key} 的資料集 id ${id} 不存在`)
  if (!SAFE_PATH.test(row.image) || !SAFE_PATH.test(row.gif_url)) throw new Error(`${key}（${id}）的檔案路徑不合法：${row.image}／${row.gif_url}`)
  const thumb = join(thumbDir, `${key}.jpg`)
  const gif = join(gifDir, `${key}.gif`)
  if (force || !existsSync(thumb)) {
    const buf = await get(row.image)
    writeFileSync(thumb, buf)
    thumbs++
    thumbBytes += buf.length
  }
  if (force || !existsSync(gif)) {
    const buf = await get(row.gif_url)
    writeFileSync(gif, buf)
    gifs++
    gifBytes += buf.length
  }
}
console.log(`縮圖 ${thumbs} 張，共 ${(thumbBytes / 1024).toFixed(0)} KB；動畫 ${gifs} 個，共 ${(gifBytes / 1024 / 1024).toFixed(1)} MB`)
