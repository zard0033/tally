/* 份量輸入正規化。照 legacy/app.js 的 normalizeQty 逐字搬。 */

/**
 * 空白、0、負數、非數字一律回 1；有效值捨入到小數第二位。
 * schema 有 check (qty > 0) 擋底，這裡先擋掉，不讓「加入」按下去才失敗。
 */
export function normalizeQty(v: unknown): number {
  const n = Number(String(v).trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 1
}
