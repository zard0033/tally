/* 「這週」卡（spec「熱量看這一週」，v2.165）：一週（週一到週日）的總帳、每天計入多少、之後每天吃多少就打平。
   純邏輯，不沾 DOM。

   - 這週額度＝現在的每日目標 × 7（週中改過目標也照現在的算，不追溯）。
   - 過去的日子：早、午、晚餐有一餐空著、又沒按「沒吃」＝沒記完，那天至少算到每日目標（漏記的餐不能被當成省下的額度）。
     點心不問。按了「沒吃」只在那餐還沒有紀錄時算數（之後補記了就照紀錄）。
   - 今天：吃的跟每日目標取大的（還沒吃完，先照目標佔位；已經吃超過就照實）。
   - 未來的日子：預先記錄的照今天同一套（跟目標取大）；沒記的是「打平」的日子。
   - 打平＝（這週額度 − 已計入的）÷ 打平天數，最低到 BMR（使用者裁決：低於基礎代謝不健康）；用 BMR 攤不完的＝這週會多 N。
     下限取 BMR 跟每日目標小的那個（review S3）：目標本身就低於 BMR 是每日目標頁的事，這張卡不該整週都說會多；BMR 算不出來就用目標。
     「會多 N」用畫面上那個取整過的每天量算，畫面上的數字自己對得起來（review S7）。
     沒有打平的日子（預先記到週日）就直接比已計入的跟額度（review S8）。
   - 紅色只看「這週到今天為止已經吃的」：過去的日子照計入量（沒記完已補到目標），今天照實吃的，超過額度才紅。 */
import type { MealKey } from './meals'

/** 會問「沒吃／補記」的三餐；點心不問。 */
export const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'] as const
export type MainMeal = (typeof MAIN_MEALS)[number]

export const isMainMeal = (m: string): m is MainMeal => (MAIN_MEALS as readonly string[]).includes(m)

/** 一天的輸入：吃了多少（份量已乘進去）、哪幾餐有紀錄、哪幾餐按了沒吃。 */
export interface DayIntake {
  kcal: number
  logged: ReadonlySet<MealKey>
  skipped: ReadonlySet<MainMeal>
}

export type DayKind = 'past' | 'today' | 'future'

export interface WeekDay {
  date: string
  kind: DayKind
  /** 實際記了多少。 */
  eaten: number
  /** 算進這週總帳的量（沒記完補到目標、今天與預先記錄跟目標取大）。打平的日子是 0。 */
  counted: number
  /** 過去的日子、三餐有一餐空著又沒按沒吃。 */
  unlogged: boolean
  /** 未來的日子已經預先記錄了東西：畫實際的柱子，不是打平框。 */
  prelogged: boolean
  /** 打平的日子要吃多少（已取整到 10）；不是打平的日子、或這週已超過時是 null。 */
  plan: number | null
}

export type WeekHeader =
  | { kind: 'over'; n: number }
  | { kind: 'under'; n: number }
  | { kind: 'even' }
  | { kind: 'willOver'; n: number }
  | { kind: 'red'; n: number }

export interface WeekBudget {
  days: WeekDay[]
  budget: number
  header: WeekHeader
  /** 打平的每天量（取整到 10）；沒有打平的日子或已超過時是 null。 */
  planPerDay: number | null
  /** 打平值被 BMR 頂住了。 */
  floored: boolean
  red: boolean
}

const ZERO: DayIntake = { kcal: 0, logged: new Set(), skipped: new Set() }

/** 這天三餐還有幾餐沒交代（空著、又沒按沒吃）。 */
export function unresolvedMeals(d: DayIntake): MainMeal[] {
  return MAIN_MEALS.filter((m) => !d.logged.has(m) && !d.skipped.has(m))
}

/** 打平值取整到 10（「1670」）：畫面上的建議值，不需要個位數的假精確。 */
const round10 = (n: number) => Math.round(n / 10) * 10

/**
 * dates：週一到週日七天（dates.weekDates）。today：今天（yyyy-mm-dd）。target：每日目標。bmr：打平下限。
 * byDate：查不到的日子當沒吃也沒記（過去的日子因此是「沒記完」）。
 * 整週都在未來（週一在今天之後）回 null：不出這張卡。
 */
export function weekBudget(
  dates: readonly string[],
  today: string,
  target: number,
  bmr: number,
  byDate: ReadonlyMap<string, DayIntake>,
): WeekBudget | null {
  if (dates.length !== 7 || dates[0] > today) return null
  const budget = target * 7

  const base = dates.map((date) => {
    const d = byDate.get(date) ?? ZERO
    const kind: DayKind = date < today ? 'past' : date === today ? 'today' : 'future'
    const unlogged = kind === 'past' && unresolvedMeals(d).length > 0
    const prelogged = kind === 'future' && d.kcal > 0
    let counted = 0
    if (kind === 'past') counted = unlogged ? Math.max(d.kcal, target) : d.kcal
    else if (kind === 'today' || prelogged) counted = Math.max(d.kcal, target)
    return { date, kind, eaten: d.kcal, counted, unlogged, prelogged }
  })

  const isPlanDay = (x: (typeof base)[number]) => x.kind === 'future' && !x.prelogged
  const planDays = base.filter(isPlanDay).length
  const committed = base.reduce((s, x) => s + (isPlanDay(x) ? 0 : x.counted), 0)

  // 已經吃的：過去照計入量（沒記完補到目標），今天照實；未來不算
  const spent = base.reduce((s, x) => s + (x.kind === 'past' ? x.counted : x.kind === 'today' ? x.eaten : 0), 0)
  const red = spent > budget

  // 到今天為止的差（今天照佔位）；整週都是過去就是整週
  const upTo = base.filter((x) => x.kind !== 'future')
  const diff = Math.round(upTo.reduce((s, x) => s + x.counted, 0) - target * upTo.length)

  const floor = Number.isFinite(bmr) && bmr > 0 ? Math.min(bmr, target) : target
  const remaining = budget - committed
  let planPerDay: number | null = null
  let floored = false
  let willOver = 0
  if (!red && planDays > 0) {
    const raw = remaining / planDays
    if (raw < floor) {
      floored = true
      planPerDay = round10(floor)
      willOver = Math.round(planPerDay * planDays - remaining)
    } else {
      planPerDay = round10(raw)
    }
  } else if (!red && planDays === 0 && remaining < 0) {
    willOver = Math.round(-remaining)
  }

  const header: WeekHeader = red
    ? { kind: 'red', n: Math.round(spent - budget) }
    : willOver > 0
      ? { kind: 'willOver', n: willOver }
      : diff > 0
        ? { kind: 'over', n: diff }
        : diff < 0
          ? { kind: 'under', n: -diff }
          : { kind: 'even' }

  return {
    days: base.map((x) => ({ ...x, plan: isPlanDay(x) ? planPerDay : null })),
    budget,
    header,
    planPerDay,
    floored,
    red,
  }
}

/** 卡頭右邊那段字。 */
export function headerText(h: WeekHeader): string {
  switch (h.kind) {
    case 'red':
      return `這週超過 ${h.n}`
    case 'willOver':
      return `這週會多 ${h.n}`
    case 'over':
      return `多吃 ${h.n}`
    case 'under':
      return `少吃 ${h.n}`
    case 'even':
      return '剛好'
  }
}

/**
 * 待記錄的三餐要不要問「沒吃／補記」：過去的日子都問；今天要等那餐的時段過了（早餐 11 點、午餐 15 點，晚餐到隔天才問）；
 * 未來不問、點心不問。鐘點是假設（spec「我定的」）。
 */
export function askSkip(meal: MealKey, date: string, today: string, hour: number): boolean {
  if (!isMainMeal(meal) || date > today) return false
  if (date < today) return true
  if (meal === 'breakfast') return hour >= 11
  if (meal === 'lunch') return hour >= 15
  return false
}

/** 下一個會讓 askSkip 或「今天」變的時間點還有多久（ms）：今天 11:00、15:00、隔天 0:00 之中最近的那個。
 *  今日頁照這個排一個計時器重畫（review N4：一直開著也會在 11 點冒出「沒吃／補記」，午夜換天）。 */
export function msToNextAskBoundary(now: Date): number {
  const at = (h: number, dayOffset = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, 0, 0, 0).getTime()
  const t = now.getTime()
  const next = [at(11), at(15), at(0, 1)].find((x) => x > t) ?? at(0, 1)
  return next - t
}

/** listIntakeKcal 的列（eaten_on／qty／kcal 單份快照／meal）→ 每天吃了多少、哪幾餐有紀錄。skipped 另外併。 */
export function dayIntakeFromRows(
  rows: readonly { eaten_on: string; qty: number | string; kcal: number | string; meal: string }[],
): Map<string, { kcal: number; logged: Set<MealKey> }> {
  const out = new Map<string, { kcal: number; logged: Set<MealKey> }>()
  for (const r of rows) {
    const cur = out.get(r.eaten_on) ?? { kcal: 0, logged: new Set<MealKey>() }
    cur.kcal += Number(r.kcal) * Number(r.qty)
    cur.logged.add(r.meal as MealKey)
    out.set(r.eaten_on, cur)
  }
  return out
}

/** 某天的「沒吃」：抓到的那份，疊上這次 session 按的與取消的（review S2：本機的不能整個蓋掉抓到的）。 */
export function mergeSkips(
  fetched: ReadonlySet<MainMeal>,
  local: { added: ReadonlySet<MainMeal>; removed: ReadonlySet<MainMeal> } | undefined,
): Set<MainMeal> {
  const out = new Set(fetched)
  if (!local) return out
  for (const m of local.added) out.add(m)
  for (const m of local.removed) out.delete(m)
  return out
}
