import { describe, expect, it } from 'vitest'
import { countedWorkoutDates, defaultWeekIndex, gapTexts, weeklyRows, WEEK_FULL_DAYS, type WeekRow } from './weeklyCompare'
import { emptyTrainingDb, type TrainingDb } from './training'
import { dailyKcalFromRows } from './baseline'

// 2026-11-16 是週一，2026-11-20 是週五
const TODAY = '2026-11-20'

const base = { daily: [], workoutDates: [], trend: [] }

describe('weeklyRows：週的切法', () => {
  it('從範圍起點那週的週一切起、每週一列，頭尾被範圍與今天切掉', () => {
    // 11/04 是週三：第一週 11/02–11/08 只算 11/04 起；最後一週 11/16–11/22 只算到今天
    const rows = weeklyRows({ ...base, from: '2026-11-04', today: TODAY })
    expect(rows.map((r) => [r.monday, r.from, r.to, r.current])).toEqual([
      ['2026-11-02', '2026-11-04', '2026-11-08', false],
      ['2026-11-09', '2026-11-09', '2026-11-15', false],
      ['2026-11-16', '2026-11-16', '2026-11-20', true],
    ])
  })

  it('跨月：10/29（週四）起，第一週是 10/26 那週', () => {
    const rows = weeklyRows({ ...base, from: '2026-10-29', today: '2026-11-03' })
    expect(rows.map((r) => r.monday)).toEqual(['2026-10-26', '2026-11-02'])
    expect(rows[0].from).toBe('2026-10-29')
    expect(rows[0].to).toBe('2026-11-01')
  })

  it('今天剛好是週日：那週已過完、不算進行中', () => {
    const rows = weeklyRows({ ...base, from: '2026-11-16', today: '2026-11-22' })
    expect(rows).toHaveLength(1)
    expect(rows[0].current).toBe(false)
  })

  it('起點在今天之後：沒有列', () => {
    expect(weeklyRows({ ...base, from: '2026-11-21', today: TODAY })).toEqual([])
  })
})

describe('weeklyRows：攝取只算記完整的天', () => {
  // 記完整＝午、晚餐都有記（同回推）。kcal 是單份快照 × qty
  const daily = dailyKcalFromRows([
    { eaten_on: '2026-11-09', qty: 1, kcal: 600, meal: 'lunch' },
    { eaten_on: '2026-11-09', qty: 2, kcal: 500, meal: 'dinner' }, // 11/09 完整：1600
    { eaten_on: '2026-11-10', qty: 1, kcal: 900, meal: 'lunch' }, // 只有午餐：不算
    { eaten_on: '2026-11-11', qty: 1, kcal: 800, meal: 'dinner' }, // 只有晚餐：不算
    { eaten_on: '2026-11-12', qty: 1, kcal: 300, meal: 'breakfast' },
    { eaten_on: '2026-11-12', qty: 1, kcal: 700, meal: 'lunch' },
    { eaten_on: '2026-11-12', qty: 1, kcal: 1000, meal: 'dinner' }, // 11/12 完整：2000
    { eaten_on: '2026-11-15', qty: 1, kcal: 1, meal: 'lunch' },
    { eaten_on: '2026-11-15', qty: 1, kcal: 2000, meal: 'dinner' }, // 11/15（週日）完整：2001
    { eaten_on: '2026-11-16', qty: 1, kcal: 5000, meal: 'lunch' },
    { eaten_on: '2026-11-16', qty: 1, kcal: 5000, meal: 'dinner' }, // 下一週，不能算進 11/09 那週
  ])
  const rows = weeklyRows({ ...base, daily, from: '2026-11-09', today: TODAY })

  it('平均只除記完整的天數，四捨五入', () => {
    // (1600 + 2000 + 2001) / 3 = 1867
    expect(rows[0].fullDays).toBe(3)
    expect(rows[0].avgKcal).toBe(1867)
  })

  it('下一週的紀錄不會算進上一週', () => {
    expect(rows[1].fullDays).toBe(1)
    expect(rows[1].avgKcal).toBe(10000)
  })

  it('一天都沒記完整：平均是 null，不是 0', () => {
    const only = weeklyRows({ ...base, daily: dailyKcalFromRows([{ eaten_on: '2026-11-10', qty: 1, kcal: 900, meal: 'lunch' }]), from: '2026-11-09', today: TODAY })
    expect(only[0].fullDays).toBe(0)
    expect(only[0].avgKcal).toBeNull()
  })

  it('範圍起點之前的日子不算（半週）', () => {
    const half = weeklyRows({ ...base, daily, from: '2026-11-13', today: TODAY })
    expect(half[0].fullDays).toBe(1) // 只剩 11/15
    expect(half[0].avgKcal).toBe(2001)
  })

  it('完整週門檻是 4 天（沿用回推）', () => {
    expect(WEEK_FULL_DAYS).toBe(4)
  })
})

describe('weeklyRows：訓練次數', () => {
  it('同一天兩次算兩次，範圍外的不算', () => {
    const rows = weeklyRows({ ...base, workoutDates: ['2026-11-08', '2026-11-10', '2026-11-10', '2026-11-16'], from: '2026-11-09', today: TODAY })
    expect(rows.map((r) => r.workouts)).toEqual([2, 1])
  })
})

describe('weeklyRows：體重趨勢變化', () => {
  const trend = [
    { date: '2026-11-01', trend: 79 },
    { date: '2026-11-10', trend: 78.6 },
    { date: '2026-11-13', trend: 78.4 },
    { date: '2026-11-19', trend: 78.7 },
  ]

  it('這週最後一筆的趨勢 − 這週以前最後一筆的趨勢', () => {
    const rows = weeklyRows({ ...base, trend, from: '2026-11-02', today: TODAY })
    // 11/02 那週沒量 → null；11/09 那週：78.4 − 79；11/16 那週：78.7 − 78.4
    expect(rows[0].trend).toBeNull()
    expect(rows[0].trendDelta).toBeNull()
    expect(rows[1].trend).toBe(78.4)
    expect(rows[1].trendDelta).toBeCloseTo(-0.6, 10)
    expect(rows[2].trendDelta).toBeCloseTo(0.3, 10)
  })

  it('範圍第一週拿範圍以前的趨勢來比（趨勢是全部歷史算的）', () => {
    const rows = weeklyRows({ ...base, trend, from: '2026-11-09', today: TODAY })
    expect(rows[0].trendDelta).toBeCloseTo(-0.6, 10)
  })

  it('變化跨了幾週：中間沒量的週累積進來，要寫出週數', () => {
    const rows = weeklyRows({ ...base, trend, from: '2026-11-02', today: TODAY })
    // 11/09 那週：11/13 對 11/01 相隔 12 天 → 2 週；11/16 那週：11/19 對 11/13 相隔 6 天 → 1 週；沒量的週 null
    expect(rows.map((r) => r.deltaWeeks)).toEqual([null, 2, 1])
  })

  it('這週有量、但之前從沒量過：變化是 null', () => {
    const rows = weeklyRows({ ...base, trend: [{ date: '2026-11-10', trend: 78.6 }], from: '2026-11-09', today: TODAY })
    expect(rows[0].trend).toBe(78.6)
    expect(rows[0].trendDelta).toBeNull()
    expect(rows[0].deltaWeeks).toBeNull()
  })
})

describe('countedWorkoutDates', () => {
  const db = (over: Partial<Record<keyof TrainingDb, Record<string, unknown>[]>>): TrainingDb =>
    ({ ...emptyTrainingDb(), ...over }) as unknown as TrainingDb

  it('有打勾組或有記有氧分鐘才算一次；什麼都沒做的不算', () => {
    const d = db({
      workouts: [
        { id: 'w1', performed_on: '2026-11-10' }, // 有打勾組
        { id: 'w2', performed_on: '2026-11-11' }, // 組都沒打勾
        { id: 'w3', performed_on: '2026-11-12' }, // 只有有氧、記了分鐘
        { id: 'w4', performed_on: '2026-11-13' }, // 有氧卡但沒記分鐘
        { id: 'w5', performed_on: '2026-11-10' }, // 同一天第二次
      ],
      workout_exercises: [
        { id: 'e1', workout_id: 'w1', minutes: null },
        { id: 'e2', workout_id: 'w2', minutes: null },
        { id: 'e3', workout_id: 'w3', minutes: 30 },
        { id: 'e4', workout_id: 'w4', minutes: null },
        { id: 'e5', workout_id: 'w5', minutes: null },
      ],
      workout_sets: [
        { id: 's1', workout_exercise_id: 'e1', done: false },
        { id: 's2', workout_exercise_id: 'e1', done: true },
        { id: 's3', workout_exercise_id: 'e2', done: false },
        { id: 's4', workout_exercise_id: 'e5', done: true },
      ],
    })
    expect(countedWorkoutDates(d).sort()).toEqual(['2026-11-10', '2026-11-10', '2026-11-12'])
  })
})

describe('defaultWeekIndex', () => {
  const r = (current: boolean) => ({ current }) as WeekRow
  it('最後一週還沒過完：指上週', () => {
    expect(defaultWeekIndex([r(false), r(false), r(true)])).toBe(1)
  })
  it('最後一週已過完：指它', () => {
    expect(defaultWeekIndex([r(false), r(false)])).toBe(1)
  })
  it('只有進行中的這週：指這週', () => {
    expect(defaultWeekIndex([r(true)])).toBe(0)
  })
  it('沒有列：-1', () => {
    expect(defaultWeekIndex([])).toBe(-1)
  })
})

describe('gapTexts：「沒記」只在連續沒記那一段的中間寫一次', () => {
  const r = (avg: number | null) => ({ avgKcal: avg }) as WeekRow
  it('14 週以內：每段一個「沒記」，放在中間那週（偶數長度取前一半）', () => {
    // 段：[0..3]（中間 1）、[5]、[7..8]（中間 7）
    const rows = [null, null, null, null, 2000, null, 1900, null, null].map(r)
    expect(gapTexts(rows)).toEqual(['', '沒記', '', '', '', '沒記', '', '沒記', ''])
  })
  it('週很多時，一欄寬的段寫一槓、夠寬的段照寫「沒記」', () => {
    // 28 週：一欄只有 14 週時的一半寬，單週的段放不下兩個字；兩週的段剛好放得下
    const rows = Array.from({ length: 28 }, (_, i) => r(i === 3 || i === 10 || i === 11 ? null : 2000))
    const t = gapTexts(rows)
    expect(t[3]).toBe('–')
    expect(t[10]).toBe('沒記')
    expect(t[11]).toBe('')
    expect(t.filter((x) => x !== '')).toHaveLength(2)
  })
  it('全部都有記：沒有字', () => {
    expect(gapTexts([r(1), r(2)])).toEqual(['', ''])
  })
})
