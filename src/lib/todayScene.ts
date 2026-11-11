/* 今日頁頂端插圖的狀態：太陽（或月亮）在哪、四塊踏腳石哪幾塊亮。純函式、不碰 DOM——
   畫面只拿這裡算好的比例去擺，換成 React Native 也是同一份。 */
import { MEALS, defaultMeal, type MealKey } from './meals'

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

export type StoneState = 'done' | 'next' | 'todo'
export interface Stone {
  key: MealKey
  label: string
  state: StoneState
}

/** 該亮的下一塊：只有今天才有。從「現在這個時段的那一餐」往後找第一個還沒記的；後面都記了就沒有。 */
export function nextMeal(logged: ReadonlySet<MealKey>, now: Date): MealKey | null {
  const from = MEALS.findIndex((m) => m.key === defaultMeal(now))
  return MEALS.slice(from).find((m) => !logged.has(m.key))?.key ?? null
}

export function stonesFor(logged: ReadonlySet<MealKey>, next: MealKey | null): Stone[] {
  return MEALS.map((m) => ({
    key: m.key,
    label: m.label,
    state: logged.has(m.key) ? 'done' : m.key === next ? 'next' : 'todo',
  }))
}

/** 踏腳石要記得的事：最後一次讀到哪幾餐記了（known；null＝一次都還沒讀到），和哪幾塊剛亮、要彈一下（lit）。 */
export interface StoneMemory {
  known: ReadonlySet<MealKey> | null
  lit: ReadonlySet<MealKey>
}
export const NO_STONES: StoneMemory = { known: null, lit: new Set() }

/** 這一次讀到 logged（null＝載入中）之後要記得什麼。內容沒變就回傳同一個物件，呼叫端用 !== 判斷要不要更新。
 *  - 載入中：沿用上一次讀到的——存檔後重撈的那一下，石頭不能閃回「都沒記」，資料回來時也不能全部重跳。
 *  - 第一次讀到：只記基準、一塊都不彈（冷開機時本來就記過的不是「剛亮」）。
 *  - 之後：只有「從沒記變成記了」的那幾餐彈。 */
export function rememberStones(mem: StoneMemory, logged: ReadonlySet<MealKey> | null): StoneMemory {
  if (logged === null) return mem
  const { known } = mem
  if (known && known.size === logged.size && [...logged].every((k) => known.has(k))) return mem
  return { known: logged, lit: known === null ? new Set() : new Set([...logged].filter((k) => !known.has(k))) }
}
