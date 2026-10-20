/* 組間休息計時器的提示音（一次性，產物已進 repo；要改音再重跑）。
   自己合成的兩聲短促正弦波（880Hz → 1175Hz，各 130ms，指數衰減），沒有任何外部素材，所以沒有授權或致謝問題。
   產出 `src/assets/rest-chime.wav`：單聲道 16-bit 22.05kHz，約 13KB，進 precache（離線健身房也響）。
   用法：node scripts/build-rest-chime.mjs */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RATE = 22050
const TONES = [880, 1175]
const TONE_SEC = 0.13
const GAP_SEC = 0.04
const PEAK = 0.45 // 不要滿格：健身房音量由手機決定，爆音比小聲糟

const samples = []
for (const hz of TONES) {
  const n = Math.round(RATE * TONE_SEC)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const attack = Math.min(1, i / (RATE * 0.004)) // 4ms 淡入，免得起音爆裂
    const decay = Math.exp(-t * 18)
    samples.push(Math.sin(2 * Math.PI * hz * t) * attack * decay * PEAK)
  }
  for (let i = 0; i < Math.round(RATE * GAP_SEC); i++) samples.push(0)
}

const data = Buffer.alloc(samples.length * 2)
samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2))

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16) // fmt 區塊長度
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // 單聲道
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 2, 28) // byte rate
header.writeUInt16LE(2, 32) // block align
header.writeUInt16LE(16, 34) // bits per sample
header.write('data', 36)
header.writeUInt32LE(data.length, 40)

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/rest-chime.wav')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, data]))
console.log(`${out}：${header.length + data.length} bytes，${(samples.length / RATE).toFixed(2)} 秒`)
