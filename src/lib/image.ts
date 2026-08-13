/* 圖片尺寸計算。**只有算術，不碰 canvas／DOM**——實際的壓縮在畫面層（canvas 是 Web API，
   照 CLAUDE.md 的分層不能進 lib，未來也帶不去 React Native）。拆出來的理由是這段是唯一
   會算錯的部分，值得單獨測；canvas 那幾行是直述的 API 呼叫，沒有分支可錯。 */

/**
 * 等比縮到長邊不超過 max。已經夠小就原樣回傳——**不放大**：拉大不會生出細節，
 * 只會讓 token 變多（Qwen3.7 每 32×32 px 一個 token）。
 * 邊長至少 1：四捨五入到 0 會讓 canvas 直接拋錯。
 */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w, h }
  const r = max / longest
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) }
}
