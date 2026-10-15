/* sheet 手勢的純物理（禁沾 DOM，這層未來要原樣帶去 React Native）。
   手勢放手時要回答：關還是回彈。參數的來歷見 DESIGN.md「互動與動效」與 v2.60 版本紀錄。 */

/** 放手後「會滑到哪」：Apple 的投射式（decelerationRate 0.99，比 scroll 的 0.998 更短促）。
 *  單位 px/s → px。不是 v²/(2a)：那是教科書的等減速，Apple 出貨的是指數衰減。 */
export function project(velocity: number, decelerationRate = 0.99): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

/** 往下拖放手時的判斷：位移加上投射超過高度的這個比例就關。 */
const DISMISS_RATIO = 0.35
/** 輕輕一甩就夠：速度達到這個值、且確實動了一小段，不必拖過 35%。 */
const FLICK_VELOCITY = 500
const FLICK_MIN_OFFSET = 24

export function shouldDismiss({ offset, velocity, height }: { offset: number; velocity: number; height: number }): boolean {
  if (offset <= 0 && velocity <= 0) return false // 往上拖、往上甩：不關
  if (velocity < 0) return false // 拖到一半往上甩回去：承接手指的方向
  if (velocity >= FLICK_VELOCITY && offset >= FLICK_MIN_OFFSET) return true
  return offset + project(velocity) > height * DISMISS_RATIO
}
