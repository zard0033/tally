/* 同步的 UUID v5（RFC 4122，SHA-1）。
 *
 * 為什麼自己寫：預填動作要「確定性 id」（階段 2 spec 設計說明 ②）——兩個容器（Safari 分頁、主畫面 App）
 * 各自預填，只會 upsert 到同一列。crypto.subtle.digest 是非同步的，而預填 id 要在同步的純邏輯裡算，
 * 所以用一段小而固定的 SHA-1；它不是拿來做安全用途，只是把「使用者＋動作 key」穩定地映射成 UUID。 */

function sha1(bytes: Uint8Array): Uint8Array {
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const bitLen = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32))
  view.setUint32(padded.length - 4, bitLen >>> 0)

  const w = new Uint32Array(80)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]
      w[i] = (x << 1) | (x >>> 31)
    }
    let [a, b, c, d, e] = h
    for (let i = 0; i < 80; i++) {
      let f: number
      let k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = t
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
  }

  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  h.forEach((v, i) => outView.setUint32(i * 4, v))
  return out
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** namespace 必須是合法 UUID 字串；name 以 UTF-8 編碼。同樣的輸入永遠得到同樣的輸出。 */
export function uuidV5(namespace: string, name: string): string {
  if (!UUID_RE.test(namespace)) throw new Error(`namespace 不是合法的 UUID：${namespace}`)
  const ns = namespace.replace(/-/g, '')
  const nsBytes = Uint8Array.from({ length: 16 }, (_, i) => parseInt(ns.slice(i * 2, i * 2 + 2), 16))
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(16 + nameBytes.length)
  input.set(nsBytes)
  input.set(nameBytes, 16)
  const digest = sha1(input).slice(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50 // version 5
  digest[8] = (digest[8] & 0x3f) | 0x80 // variant RFC 4122
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
