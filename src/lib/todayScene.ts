/* 今日頁頂端插圖的狀態：太陽（或月亮）在哪。純函式、不碰 DOM——
   畫面只拿這裡算好的比例去擺，換成 React Native 也是同一份。
   （v2.166 拿掉踏腳石，原本在這裡的 nextMeal／stonesFor／rememberStones 一起刪了。） */

/** 白天的範圍（分鐘）。台灣夏天大約 5:30 日出、18:45 日落，取整數好記。 */
export const DAY_START_MIN = 5 * 60 + 30
export const DAY_END_MIN = 18 * 60 + 45
/** 不是今天的那幾頁固定畫下午三點：那天的事已經定了（或還沒開始），太陽不跟著現在走。 */
export const FIXED_SCENE_MIN = 15 * 60

export type Sky =
  /** t：沿著弧線走了多少（0＝剛日出、1＝日落）；h：離地平線多高（0–1，正午是 1）。 */
  | { kind: 'sun'; t: number; h: number }
  /** 天黑以後：月亮掛在固定的位置，不跟著時間走（夜裡的五個小時不值得一條軌跡）。 */
  | { kind: 'moon' }

export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

export function skyAt(minutes: number): Sky {
  if (minutes < DAY_START_MIN || minutes > DAY_END_MIN) return { kind: 'moon' }
  const t = (minutes - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)
  return { kind: 'sun', t, h: Math.sin(Math.PI * t) }
}
