import { describe, expect, it } from 'vitest'
import { dayIndex, isoOfDay, niceDomain, rangeStart, trendPoints, xDomain, xTicks, yTicks, type TrendRow } from './weightTrend'

const row = (measured_on: string, weight_kg: number | string, body_fat_pct: number | string | null = null): TrendRow =>
  ({ weight_kg, measured_on, body_fat_pct })

describe('dayIndex／isoOfDay', () => {
  it('互為反運算，跨月跨年閏日都對', () => {
    for (const iso of ['2026-10-20', '2026-01-01', '2024-02-29', '2025-12-31']) {
      expect(isoOfDay(dayIndex(iso))).toBe(iso)
    }
    expect(dayIndex('2026-03-01') - dayIndex('2026-02-28')).toBe(1)
    expect(dayIndex('2024-03-01') - dayIndex('2024-02-28')).toBe(2)
  })
})

describe('rangeStart', () => {
  it('30 天＝今天加前 29 天；全部沒有下界', () => {
    expect(rangeStart('30', '2026-10-20')).toBe('2026-09-21')
    expect(rangeStart('90', '2026-10-20')).toBe('2026-07-23')
    expect(rangeStart('all', '2026-10-20')).toBeNull()
  })
})

describe('trendPoints', () => {
  it('7 日平均是日曆窗口（含當天往前 7 天），不是最近 7 筆', () => {
    // 10/1 80、10/4 82、10/8 84：10/8 的窗口是 10/2–10/8，只含 82 與 84（10/1 在窗外）
    const pts = trendPoints([row('2026-10-01', 80), row('2026-10-04', 82), row('2026-10-08', 84)], 'all', '2026-10-08')
    expect(pts.map((p) => p.avg)).toEqual([80, 81, 83])
  })

  it('窗口邊界：往前第 7 天在窗外、第 6 天在窗內', () => {
    const inWin = trendPoints([row('2026-10-01', 80), row('2026-10-07', 90)], 'all', '2026-10-07')
    expect(inWin[1].avg).toBe(85) // 10/7 往前含當天 7 天＝10/1–10/7
    const outWin = trendPoints([row('2026-10-01', 80), row('2026-10-08', 90)], 'all', '2026-10-08')
    expect(outWin[1].avg).toBe(90) // 10/1 距 10/8 是 7 天，掉出窗口
  })

  it('平均先對全部歷史算再切範圍，範圍第一天的窗口是完整的', () => {
    const rows = [row('2026-10-17', 80), row('2026-10-19', 82), row('2026-10-20', 84)]
    const pts = trendPoints(rows, '30', '2026-10-20')
    expect(pts).toHaveLength(3)
    // 把範圍縮到只剩最後一天不可能（最短 30 天），改驗歷史很舊的列被切掉但仍參與平均
    const old = trendPoints([row('2026-08-01', 70), ...rows], '30', '2026-10-20')
    expect(old.map((p) => p.date)).toEqual(['2026-10-17', '2026-10-19', '2026-10-20'])
    expect(old[0].avg).toBe(80)
  })

  it('範圍切片依今天往前數，不是依最後一筆', () => {
    const rows = [row('2026-08-30', 80), row('2026-09-20', 81), row('2026-09-21', 82), row('2026-10-20', 83)]
    expect(trendPoints(rows, '30', '2026-10-20').map((p) => p.date)).toEqual(['2026-09-21', '2026-10-20'])
    expect(trendPoints(rows, 'all', '2026-10-20')).toHaveLength(4)
  })

  it('輸入亂序也由舊到新；PostgREST 的 numeric 字串照樣算', () => {
    const pts = trendPoints([row('2026-10-02', '81.5', '20.5'), row('2026-10-01', '80.5')], 'all', '2026-10-02')
    expect(pts.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(pts.map((p) => p.kg)).toEqual([80.5, 81.5])
    expect(pts[0].fat).toBeNull()
    expect(pts[1].fat).toBe(20.5)
    expect(pts[1].avg).toBe(81)
  })

  it('體重不是有限數字的列整筆丟掉；體脂壞掉當沒填', () => {
    const pts = trendPoints([row('2026-10-01', 'abc'), row('2026-10-02', 80, 'x')], 'all', '2026-10-02')
    expect(pts).toHaveLength(1)
    expect(pts[0].fat).toBeNull()
  })

  it('空輸入回空陣列', () => {
    expect(trendPoints([], 'all', '2026-10-20')).toEqual([])
  })
})

describe('xDomain／xTicks', () => {
  const pts = trendPoints([row('2026-09-30', 80), row('2026-10-10', 81)], 'all', '2026-10-20')

  it('固定範圍＝[起點, 今天]；全部＝[第一筆, 今天]；沒資料 null', () => {
    expect(xDomain(pts, '30', '2026-10-20')).toEqual([dayIndex('2026-09-21'), dayIndex('2026-10-20')])
    expect(xDomain(pts, 'all', '2026-10-20')).toEqual([dayIndex('2026-09-30'), dayIndex('2026-10-20')])
    expect(xDomain([], 'all', '2026-10-20')).toBeNull()
  })

  it('刻度含兩端、等距；範圍只有一天只給一個', () => {
    expect(xTicks(0, 30, 4)).toEqual([0, 10, 20, 30])
    expect(xTicks(5, 5)).toEqual([5])
  })
})

describe('yTicks', () => {
  it('依範圍大小選步長，刻度落在步長整數倍、含兩端（兩端本身是倍數時）', () => {
    expect(yTicks([76, 85])).toEqual([76, 78, 80, 82, 84])
    expect(yTicks([75, 79])).toEqual([75, 76, 77, 78, 79])
    expect(yTicks([60, 90])).toEqual([60, 65, 70, 75, 80, 85, 90])
    expect(yTicks([50, 120])).toEqual([50, 60, 70, 80, 90, 100, 110, 120])
  })

  it('下界不是步長倍數時從第一個倍數開始，不超出範圍', () => {
    expect(yTicks([61, 74])).toEqual([65, 70])
  })
})

describe('niceDomain', () => {
  it('上下留 pad 再對齊 step', () => {
    expect(niceDomain([75.9, 78.2], 0.3, 1)).toEqual([75, 79])
    expect(niceDomain([20.5, 22], 0.5, 1)).toEqual([20, 23])
  })

  it('資料剛好落在整數也會留出 pad，線不貼邊', () => {
    expect(niceDomain([76, 78], 0.3, 1)).toEqual([75, 79])
  })

  it('沒資料回 [0, 1]', () => {
    expect(niceDomain([], 0.3, 1)).toEqual([0, 1])
  })
})
