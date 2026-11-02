/* 份量輸入正規化。 */

/**
 * 空白、0、負數、非數字一律回 1；有效值捨入到小數第二位。
 * schema 有 check (qty > 0) 擋底，這裡先擋掉，不讓「加入」按下去才失敗。
 */
export function normalizeQty(v: unknown): number {
  const n = Number(String(v).trim())
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 1
}

/**
 * 打字途中只收「能解析成正數」的值：這時還不正規化（"1." 這種中間狀態被改成 1，游標會跳走），
 * 正規化留到 blur 再做。解析不出正數回 null，呼叫端就不更新數量。
 */
export function parseTypedQty(raw: string): number | null {
  const n = Number(raw.trim())
  return Number.isFinite(n) && n > 0 ? n : null
}
