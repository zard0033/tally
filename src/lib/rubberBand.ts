/* 橡皮筋阻力（iOS 拉過邊界的手感）：超出邊界的距離越大，實際露出越慢逼近上限。
   `excess` 是手指超出邊界多少 px（可正可負），回傳實際該露出的 px，絕對值永遠小於 `max`。
   訓練中排序用：把被拖的卡限制在清單區內，拉到邊界外最多露出約 14px（spec.md「訓練中畫面改版」AC 8）。 */
export const RUBBER_BAND_MAX = 14

export function rubberBand(excess: number, max: number = RUBBER_BAND_MAX): number {
  if (excess === 0) return 0
  const dist = Math.abs(excess)
  // 經典公式：(1 − 1 / (d·c / max + 1)) · max；c＝0.55 是 iOS 捲動邊界常用的係數
  const out = (1 - 1 / ((dist * 0.55) / max + 1)) * max
  return excess < 0 ? -out : out
}
