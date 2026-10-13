import { describe, expect, it } from 'vitest'
import {
  addMonths,
  ageFromYear,
  dayLabel,
  isMonthBeyond,
  isPlannable,
  localDate,
  maxPlanDate,
  monthBounds,
  monthDay,
  monthGrid,
  monthKeyOf,
  monthTitle,
  shiftDate,
  weekDates,
  weekdayDate,
} from './dates'

describe('localDate', () => {
  it('本地時區 yyyy-mm-dd，不受 UTC 偏移影響', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('shiftDate', () => {
  it('跨月', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('跨年', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('閏日', () => {
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29')
  })
})

/* v2.47：可檢視範圍的上界。**測的是「界在明天」這個規則本身**，不是 shiftDate
   （那個上面已經測過了）——所以每條都顯式傳入 today，不依賴系統時鐘，
   否則測試會在跨月／跨年那幾天自己變成另一個案例。 */
describe('maxPlanDate', () => {
  it('就是明天', () => {
    expect(maxPlanDate('2026-07-28')).toBe('2026-07-29')
  })
  it('跨月', () => {
    expect(maxPlanDate('2026-02-28')).toBe('2026-03-01')
  })
  it('跨年', () => {
    expect(maxPlanDate('2025-12-31')).toBe('2026-01-01')
  })
  it('閏年的 2/28 往前是 2/29，不是 3/1', () => {
    expect(maxPlanDate('2024-02-28')).toBe('2024-02-29')
  })
  it('不帶參數時以今天為基準（界會跟著午夜自己移動）', () => {
    expect(maxPlanDate()).toBe(shiftDate(localDate(), 1))
  })
})

/* v2.47（deep review 補）：「這天還能不能改變結果」。**兩個畫面問同一件事**——今日頁的
   主數字、記一筆 sheet 的確認列，所以它必須只有一份定義。同樣顯式傳 today，不吃系統時鐘。 */
describe('isPlannable', () => {
  it('今天為真', () => {
    expect(isPlannable('2026-07-28', '2026-07-28')).toBe(true)
  })
  it('明天為真——這正是 v2.47 開放的那一天', () => {
    expect(isPlannable('2026-07-29', '2026-07-28')).toBe(true)
  })
  it('昨天為假', () => {
    expect(isPlannable('2026-07-27', '2026-07-28')).toBe(false)
  })
  it('純字串比較，跨月不會出錯', () => {
    expect(isPlannable('2026-03-01', '2026-02-28')).toBe(true)
    expect(isPlannable('2026-02-28', '2026-03-01')).toBe(false)
  })
})

describe('weekdayDate', () => {
  it('格式為「週N M/D」、不帶年份', () => {
    expect(weekdayDate('2026-07-28')).toBe('週二 7/28')
  })
  it('跨年也不受影響（純字串解析，不經過 UTC 轉換）', () => {
    expect(weekdayDate('2025-12-31')).toBe('週三 12/31')
    expect(weekdayDate('2026-01-01')).toBe('週四 1/1')
  })
  it('個位數月/日不補零', () => {
    expect(weekdayDate('2026-03-05')).toBe('週四 3/5')
  })
})

describe('ageFromYear', () => {
  it('今年減出生年', () => {
    expect(ageFromYear(1993, new Date(2026, 6, 29))).toBe(33)
  })
  it('無效輸入（NaN）回 NaN，不擋、不丟錯——由呼叫端（computeTargets → App.tsx 的 kcal 檢查）守門', () => {
    expect(Number.isNaN(ageFromYear(NaN, new Date(2026, 6, 29)))).toBe(true)
  })
})

describe('monthDay', () => {
  it('去掉年份與前導零：2026-09-06 → 9/6', () => {
    expect(monthDay('2026-09-06')).toBe('9/6')
  })
  it('兩位數月日不變：2026-12-25 → 12/25', () => {
    expect(monthDay('2026-12-25')).toBe('12/25')
  })
})

/* v2.53 週列／月曆。全部顯式給日期，不吃系統時鐘。2026-10-13 是週二、10/1 是週四、10/31 是週六。 */
describe('weekDates', () => {
  it('週中任一天都回同一週，週一到週日', () => {
    const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
    expect(weekDates('2026-10-13')).toEqual(week)
    expect(weekDates('2026-10-12')).toEqual(week)
    expect(weekDates('2026-10-18')).toEqual(week)
  })
  it('週日屬於前面那一週，不是下一週的開頭', () => {
    expect(weekDates('2026-10-18')[0]).toBe('2026-10-12')
  })
  it('跨月、跨年', () => {
    expect(weekDates('2026-10-01')[0]).toBe('2026-09-28')
    expect(weekDates('2026-01-01')[0]).toBe('2025-12-29')
  })
})

describe('monthBounds', () => {
  it('每月最後一天含閏日', () => {
    expect(monthBounds('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthBounds('2026-02').to).toBe('2026-02-28')
    expect(monthBounds('2024-02').to).toBe('2024-02-29')
  })
})

describe('addMonths', () => {
  it('跨年進退位', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-10', 0)).toBe('2026-10')
  })
})

describe('monthGrid', () => {
  it('前面補 null 到 1 號的星期（週四＝補三格），之後是每一天', () => {
    const g = monthGrid('2026-10')
    expect(g.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(g).toHaveLength(3 + 31)
    expect(g[g.length - 1]).toBe('2026-10-31')
  })
  it('1 號是週一就不補', () => {
    expect(monthGrid('2026-06')[0]).toBe('2026-06-01')
  })
  it('1 號是週日補六格', () => {
    expect(monthGrid('2026-02').slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-02-01'])
  })
})

describe('monthKeyOf／monthTitle', () => {
  it('取月份鍵與標題', () => {
    expect(monthKeyOf('2026-10-13')).toBe('2026-10')
    expect(monthTitle('2026-10')).toBe('2026 年 10 月')
  })
})

describe('dayLabel', () => {
  it('星期、今天、有紀錄三個後綴各自獨立', () => {
    expect(dayLabel('2026-10-13', '2026-10-13', true)).toBe('10月13日 週二，今天，有紀錄')
    expect(dayLabel('2026-10-12', '2026-10-13', false)).toBe('10月12日 週一')
    expect(dayLabel('2026-10-14', '2026-10-13', true)).toBe('10月14日 週三，有紀錄')
  })
})

describe('isMonthBeyond', () => {
  it('下個月第一天晚於上界才算超過；上界剛好是下個月 1 號就還沒超過', () => {
    expect(isMonthBeyond('2026-11', '2026-10-31')).toBe(true) // 今天 10/30 → 明天 10/31，11 月整個超過
    expect(isMonthBeyond('2026-11', '2026-11-01')).toBe(false) // 今天 10/31 → 明天 11/1，11 月可看
    expect(isMonthBeyond('2026-10', '2026-10-14')).toBe(false)
  })
})
