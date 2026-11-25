import { describe, expect, it } from 'vitest'
import type { MealKey } from './meals'
import { askSkip, dayIntakeFromRows, headerText, mergeSkips, missedMeals, msToNextAskBoundary, unresolvedMeals, weekBudget, type DayIntake, type MainMeal } from './weekBudget'

// 2026-11-23 是週一
const WEEK = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']
const THU = '2026-11-26'
const ALL: MealKey[] = ['breakfast', 'lunch', 'dinner']
const day = (kcal: number, logged: MealKey[] = ALL, skipped: MainMeal[] = []): DayIntake => ({ kcal, logged: new Set(logged), skipped: new Set(skipped) })
const map = (entries: Record<string, DayIntake>) => new Map(Object.entries(entries))

describe('weekBudget：總帳與打平（AC 1）', () => {
  const w = weekBudget(WEEK, THU, 1850, 1600, map({
    '2026-11-23': day(1650),
    '2026-11-24': day(1780),
    '2026-11-25': day(2650),
    '2026-11-26': day(1200, ['breakfast', 'lunch']),
  }))!
  it('週一到今天：多吃 530（今天照目標佔位）', () => {
    expect(w.header).toEqual({ kind: 'over', n: 530 })
    expect(headerText(w.header)).toBe('多吃 530')
  })
  it('週五到週日打平 1670（5020 ÷ 3 取整到 10）', () => {
    expect(w.days.slice(4).map((d) => d.plan)).toEqual([1670, 1670, 1670])
    expect(w.planPerDay).toBe(1670)
    expect(w.floored).toBe(false)
  })
  it('過去照實計入、今天跟目標取大、沒有沒記完', () => {
    expect(w.days.slice(0, 4).map((d) => d.counted)).toEqual([1650, 1780, 2650, 1850])
    expect(w.days.map((d) => d.kind)).toEqual(['past', 'past', 'past', 'today', 'future', 'future', 'future'])
    expect(w.days.some((d) => d.unlogged)).toBe(false)
    expect(w.red).toBe(false)
  })
  it('少吃時寫少吃、剛好寫剛好', () => {
    const under = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-23': day(1500), '2026-11-24': day(1800), '2026-11-25': day(1800), '2026-11-26': day(0, []) }))!
    expect(headerText(under.header)).toBe('少吃 450')
    const even = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-23': day(1850), '2026-11-24': day(1850), '2026-11-25': day(1850) }))!
    expect(headerText(even.header)).toBe('剛好')
  })
})

describe('打平下限是 BMR（AC 2）', () => {
  it('攤下來低於 BMR → 停在 BMR、這週會多 N', () => {
    const w = weekBudget(WEEK, THU, 1850, 1693, map({
      '2026-11-23': day(3850),
      '2026-11-24': day(1780),
      '2026-11-25': day(2650),
      '2026-11-26': day(1200),
    }))!
    // 12950 − (3850+1780+2650+1850) = 2820；÷3 = 940 < 1693
    expect(w.floored).toBe(true)
    expect(w.planPerDay).toBe(1690)
    // 會多＝畫面上的 1690 × 3 − 2820（review S7：用取整過的每天量，畫面上的數字自己對得起來）
    expect(w.header).toEqual({ kind: 'willOver', n: 1690 * 3 - 2820 })
    expect(headerText(w.header)).toBe('這週會多 2250')
  })
  it('目標本身低於 BMR：下限用目標，不會整週都說會多（review S3）', () => {
    const w = weekBudget(WEEK, THU, 1500, 1600, map({ '2026-11-23': day(1500), '2026-11-24': day(1500), '2026-11-25': day(1500) }))!
    // 10500 − 6000 = 4500 ÷ 3 = 1500，剛好是目標：不頂住、不會多
    expect(w.planPerDay).toBe(1500)
    expect(w.floored).toBe(false)
    expect(w.header).toEqual({ kind: 'even' })
    const over = weekBudget(WEEK, THU, 1500, 1600, map({ '2026-11-23': day(2100), '2026-11-24': day(1500), '2026-11-25': day(1500) }))!
    // 4500 − 600 = 3900 ÷ 3 = 1300 < 下限 1500（不是 BMR 1600）
    expect(over.planPerDay).toBe(1500)
    expect(over.header).toEqual({ kind: 'willOver', n: 1500 * 3 - 3900 })
  })
  it('BMR 算不出來（NaN）：下限用目標，打平永遠不會是負的（review N9）', () => {
    const w = weekBudget(WEEK, THU, 1850, NaN, map({ '2026-11-23': day(9000) }))!
    expect(w.planPerDay).toBe(1850)
    expect(w.days.slice(4).every((d) => d.plan !== null && d.plan > 0)).toBe(true)
  })
})

describe('紅色只看這週已經吃的（AC 3）', () => {
  it('已吃超過目標 × 7 → 紅、打平是 null', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-23': day(5000), '2026-11-24': day(5000), '2026-11-25': day(4000), '2026-11-26': day(1200) }))!
    expect(w.red).toBe(true)
    expect(w.header).toEqual({ kind: 'red', n: 15200 - 12950 })
    expect(w.days.slice(4).every((d) => d.plan === null)).toBe(true)
  })
  it('今天的佔位不算「已經吃的」：差一點超過但今天才吃一點，不紅', () => {
    // 過去 11000＋今天實吃 100 = 11100 < 12950；今天佔位 1850 也不該被當成吃了
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-23': day(4000), '2026-11-24': day(4000), '2026-11-25': day(3000), '2026-11-26': day(100) }))!
    expect(w.red).toBe(false)
  })
  it('單日多吃、週總量沒超 → 不紅', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-23': day(1000), '2026-11-24': day(1000), '2026-11-25': day(4000) }))!
    expect(w.red).toBe(false)
  })
})

describe('沒記完與沒吃（AC 4、5、6）', () => {
  it('晚餐空著沒回答 → 沒記完、至少算到目標', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-24': day(1000, ['breakfast', 'lunch']) }))!
    const tue = w.days[1]
    expect(tue.unlogged).toBe(true)
    expect(tue.counted).toBe(1850)
    expect(tue.eaten).toBe(1000)
  })
  it('按了沒吃 → 照實算、不再沒記完', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-24': day(1000, ['breakfast', 'lunch'], ['dinner']) }))!
    expect(w.days[1].unlogged).toBe(false)
    expect(w.days[1].counted).toBe(1000)
  })
  it('點心空著不算沒記完', () => {
    expect(unresolvedMeals(day(1800))).toEqual([])
  })
  it('補記之後沒吃不再算數（有紀錄就照紀錄）', () => {
    expect(unresolvedMeals(day(1800, ALL, ['dinner']))).toEqual([])
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-24': day(2300, ALL, ['dinner']) }))!
    expect(w.days[1].counted).toBe(2300)
  })
  it('完全沒記的過去日子＝三餐都沒交代、算到目標', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, new Map())!
    expect(w.days.slice(0, 3).every((d) => d.unlogged && d.counted === 1850)).toBe(true)
  })
  it('今天不標沒記完（今天本來就照目標佔位）', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-26': day(300, ['breakfast']) }))!
    expect(w.days[3].unlogged).toBe(false)
  })
})

describe('預先記錄、週一週日、看過去與未來的週（AC 8）', () => {
  it('明天預先記錄：不是打平框、跟目標取大計入，打平天數少一天', () => {
    const w = weekBudget(WEEK, THU, 1850, 1600, map({
      '2026-11-23': day(1850), '2026-11-24': day(1850), '2026-11-25': day(1850), '2026-11-26': day(1850),
      '2026-11-27': day(600, ['breakfast']),
    }))!
    expect(w.days[4].prelogged).toBe(true)
    expect(w.days[4].plan).toBe(null)
    expect(w.days[4].counted).toBe(1850)
    expect(w.days.slice(5).map((d) => d.plan)).toEqual([1850, 1850])
  })
  it('今天是週一：之前沒有過去的日子，打平是後面六天', () => {
    const w = weekBudget(WEEK, '2026-11-23', 1850, 1600, map({ '2026-11-23': day(2450) }))!
    // 12950 − 2450 = 10500 ÷ 6 = 1750
    expect(w.days.slice(1).map((d) => d.plan)).toEqual(Array(6).fill(1750))
    expect(w.header).toEqual({ kind: 'over', n: 600 })
  })
  it('預先記到週日、已計入超過額度：沒有打平的日子也寫這週會多（review S8）', () => {
    const pre = Object.fromEntries(['2026-11-27', '2026-11-28', '2026-11-29'].map((d) => [d, day(2500, ['lunch'])]))
    const w = weekBudget(WEEK, THU, 1850, 1600, map({ '2026-11-23': day(1850), '2026-11-24': day(1850), '2026-11-25': day(1850), '2026-11-26': day(1850), ...pre }))!
    expect(w.planPerDay).toBe(null)
    // 1850×4 ＋ 2500×3 − 12950
    expect(w.header).toEqual({ kind: 'willOver', n: 7400 + 7500 - 12950 })
  })
  it('今天是週日：沒有打平的日子', () => {
    const w = weekBudget(WEEK, '2026-11-29', 1850, 1600, new Map())!
    expect(w.planPerDay).toBe(null)
    expect(w.days.every((d) => d.plan === null)).toBe(true)
  })
  it('看上週：七天都是過去、沒有打平，差額算整週', () => {
    const w = weekBudget(WEEK, '2026-12-02', 1850, 1600, new Map(WEEK.map((d) => [d, day(1800)])))!
    expect(w.days.every((d) => d.kind === 'past' && d.plan === null)).toBe(true)
    expect(w.header).toEqual({ kind: 'under', n: 350 })
    // 整週吃超過額度＝這週超過（紅）
    const over = weekBudget(WEEK, '2026-12-02', 1850, 1600, new Map(WEEK.map((d) => [d, day(1950)])))!
    expect(over.header).toEqual({ kind: 'red', n: 700 })
  })
  it('整週都在未來（週一在今天之後）→ null', () => {
    expect(weekBudget(WEEK, '2026-11-22', 1850, 1600, new Map())).toBe(null)
  })
  it('目標週中改了：照現在的目標算（不追溯）', () => {
    const w = weekBudget(WEEK, THU, 2000, 1600, map({ '2026-11-23': day(1850), '2026-11-24': day(1850), '2026-11-25': day(1850) }))!
    expect(w.budget).toBe(14000)
    expect(w.header).toEqual({ kind: 'under', n: 450 })
  })
})

describe('askSkip：什麼時候問沒吃／補記（AC 6、7）', () => {
  it('過去的日子三餐都問、點心不問', () => {
    expect(ALL.map((m) => askSkip(m, '2026-11-24', THU, 8))).toEqual([true, true, true])
    expect(askSkip('snack', '2026-11-24', THU, 8)).toBe(false)
  })
  it('今天：早餐過 11 點、午餐過 15 點，晚餐不問', () => {
    expect(askSkip('breakfast', THU, THU, 10)).toBe(false)
    expect(askSkip('breakfast', THU, THU, 11)).toBe(true)
    expect(askSkip('lunch', THU, THU, 14)).toBe(false)
    expect(askSkip('lunch', THU, THU, 15)).toBe(true)
    expect(askSkip('dinner', THU, THU, 23)).toBe(false)
  })
  it('未來不問', () => {
    expect(askSkip('breakfast', '2026-11-27', THU, 23)).toBe(false)
  })
})

describe('dayIntakeFromRows', () => {
  it('份量乘進去、記下哪幾餐有紀錄', () => {
    const m = dayIntakeFromRows([
      { eaten_on: '2026-11-24', qty: 2, kcal: 100, meal: 'breakfast' },
      { eaten_on: '2026-11-24', qty: '1', kcal: '300', meal: 'lunch' },
      { eaten_on: '2026-11-25', qty: 1, kcal: 50, meal: 'snack' },
    ])
    expect(m.get('2026-11-24')!.kcal).toBe(500)
    expect([...m.get('2026-11-24')!.logged]).toEqual(['breakfast', 'lunch'])
    expect([...m.get('2026-11-25')!.logged]).toEqual(['snack'])
  })
})

describe('mergeSkips：本機按的疊在抓到的上面（review S2）', () => {
  it('抓到晚餐、本機按早餐 → 兩餐都算；本機取消晚餐 → 只剩早餐', () => {
    const fetched = new Set<MainMeal>(['dinner'])
    expect([...mergeSkips(fetched, { added: new Set(['breakfast']), removed: new Set() })].sort()).toEqual(['breakfast', 'dinner'])
    expect([...mergeSkips(fetched, { added: new Set(['breakfast']), removed: new Set(['dinner']) })]).toEqual(['breakfast'])
    expect([...mergeSkips(fetched, undefined)]).toEqual(['dinner'])
  })
})

describe('msToNextAskBoundary：下一個 11 點、15 點或午夜（review N4）', () => {
  const ms = (h: number, m = 0) => msToNextAskBoundary(new Date(2026, 10, 25, h, m))
  it('早上 → 11 點；中午 → 15 點；下午 → 午夜', () => {
    expect(ms(10, 59)).toBe(60_000)
    expect(ms(11, 0)).toBe(4 * 3600_000)
    expect(ms(14, 30)).toBe(30 * 60_000)
    expect(ms(23, 0)).toBe(3600_000)
  })
})

describe('missedMeals：這週卡底下「這週 N 餐沒記」（v2.166）', () => {
  it('今天以前三餐空著又沒按沒吃的加總；最早那天是點了要跳去的', () => {
    const m = missedMeals(WEEK, THU, map({
      '2026-11-23': day(1850),
      '2026-11-24': day(1000, ['breakfast', 'lunch']),
      '2026-11-25': day(400, ['breakfast']),
    }))
    expect(m).toEqual({ n: 3, first: '2026-11-24' })
  })
  it('查不到的過去日子＝三餐都沒記；跟 weekBudget 的「沒記完」同一天', () => {
    const byDate = map({ '2026-11-24': day(1850), '2026-11-25': day(1850) })
    expect(missedMeals(WEEK, THU, byDate)).toEqual({ n: 3, first: '2026-11-23' })
    const w = weekBudget(WEEK, THU, 1850, 1600, byDate)!
    expect(w.days.filter((d) => d.unlogged).map((d) => d.date)).toEqual(['2026-11-23'])
  })
  it('按了沒吃的不算；點心不算', () => {
    expect(missedMeals(WEEK, THU, map({
      '2026-11-23': day(1850),
      '2026-11-24': day(1000, ['breakfast', 'lunch', 'snack'], ['dinner']),
      '2026-11-25': day(1850),
    }))).toBeNull()
  })
  it('今天與之後不算：今天本來就先照目標佔位', () => {
    expect(missedMeals(WEEK, THU, map({
      '2026-11-23': day(1850),
      '2026-11-24': day(1850),
      '2026-11-25': day(1850),
      '2026-11-26': day(0, []),
    }))).toBeNull()
  })
  it('整週都在過去（看上週）：七天都算', () => {
    expect(missedMeals(WEEK, '2026-12-01', map({}))).toEqual({ n: 21, first: '2026-11-23' })
  })
})
