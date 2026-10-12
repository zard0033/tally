import { describe, expect, it } from 'vitest'
import {
  BASELINE_NEEDS,
  estimateMaintenance,
  expectedWeeklyChangeKg,
  type DailyKcal,
  type WeightPoint,
} from './baseline'
import { shiftDate } from './dates'

/* 全部用合成資料、顯式傳入窗尾日期，不依賴系統時鐘——否則測試會在跨月／跨年那幾天
   自己變成另一個案例。窗口＝END 往前 28 天（含 END），今天（END+1）不在裡面。 */
const END = '2026-10-11'
const dayAt = (i: number) => shiftDate(END, -i) // i=0 是窗尾，i=27 是窗首

const log = (days: number, kcal: number): DailyKcal[] =>
  Array.from({ length: days }, (_, i) => ({ date: dayAt(i), kcal }))

/** 窗首到窗尾每 everyDays 天一筆，體重以 slopePerWeek（kg/週）線性變化 */
const weightsAt = (start: number, slopePerWeek: number, everyDays = 3, noise: number[] = []): WeightPoint[] => {
  const out: WeightPoint[] = []
  for (let i = 27, n = 0; i >= 0; i -= everyDays, n++) {
    out.push({ date: dayAt(i), kg: start + (slopePerWeek / 7) * (27 - i) + (noise[n % Math.max(noise.length, 1)] ?? 0) })
  }
  return out
}

describe('estimateMaintenance — 算出來的數字', () => {
  it('體重持平：維持熱量＝平均攝取', () => {
    const r = estimateMaintenance(log(28, 1800), weightsAt(75, 0), END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.maintenance).toBeCloseTo(1800, 0)
  })

  it('體重每週掉 0.3 kg：吃的比燒的少 330 卡/天，維持熱量＝攝取＋330', () => {
    const r = estimateMaintenance(log(28, 1700), weightsAt(77, -0.3), END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.maintenance).toBeCloseTo(1700 + 330, 0)
  })

  it('體重每週漲 0.3 kg：維持熱量＝攝取－330', () => {
    const r = estimateMaintenance(log(28, 2200), weightsAt(75, 0.3), END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.maintenance).toBeCloseTo(2200 - 330, 0)
  })

  it('無雜訊時區間收斂到點；有雜訊時區間包住估計值', () => {
    const clean = estimateMaintenance(log(28, 1800), weightsAt(75, -0.2), END)
    const noisy = estimateMaintenance(log(28, 1800), weightsAt(75, -0.2, 3, [0.4, -0.5, 0.3, -0.2, 0.6]), END)
    expect(clean.status).toBe('ok')
    expect(noisy.status).toBe('ok')
    if (clean.status === 'ok') {
      expect(clean.low).toBeCloseTo(clean.maintenance, 0)
      expect(clean.high).toBeCloseTo(clean.maintenance, 0)
    }
    if (noisy.status === 'ok') {
      expect(noisy.low).toBeLessThan(noisy.maintenance)
      expect(noisy.high).toBeGreaterThan(noisy.maintenance)
    }
  })
})

describe('estimateMaintenance — 資料不足就不給數字', () => {
  it('有記天數 20 < 21', () => {
    const r = estimateMaintenance(log(20, 1800), weightsAt(75, 0), END)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(r.loggedDays).toBe(20)
  })

  it('體重只有 3 筆 < 4', () => {
    const r = estimateMaintenance(log(28, 1800), weightsAt(75, 0, 13), END) // i=27,14,1 → 3 筆
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(r.weighIns).toBe(3)
  })

  it('體重 4 筆但只橫跨 9 天 < 14', () => {
    const w: WeightPoint[] = [0, 3, 6, 9].map((i) => ({ date: dayAt(i), kg: 75 }))
    const r = estimateMaintenance(log(28, 1800), w, END)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.weighIns).toBe(4)
      expect(r.weightSpanDays).toBe(9)
    }
  })

  it('門檻值就是 spec 寫的那三個數（改門檻要連 spec 一起改）', () => {
    expect(BASELINE_NEEDS).toEqual({ loggedDays: 21, weighIns: 4, weightSpanDays: 14 })
  })
})

describe('estimateMaintenance — 什麼算「有記」、什麼在窗口外', () => {
  it('單日合計 < 1000 卡視為沒記完：不進平均，也不算有記天數', () => {
    const logs = [...log(21, 1800), ...Array.from({ length: 7 }, (_, i) => ({ date: dayAt(21 + i), kcal: 500 }))]
    const r = estimateMaintenance(logs, weightsAt(75, 0), END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.loggedDays).toBe(21)
      expect(r.maintenance).toBeCloseTo(1800, 0) // 500 的那 7 天若被算進去會拉到 1500
    }
  })

  it('剛好 1000 卡算有記（邊界在「< 1000」）', () => {
    const r = estimateMaintenance(log(28, 1000), weightsAt(75, 0), END)
    expect(r.status).toBe('ok')
  })

  it('窗口之外（今天、窗首前一天）的攝取與體重完全不影響結果', () => {
    const base = estimateMaintenance(log(28, 1800), weightsAt(75, 0), END)
    const polluted = estimateMaintenance(
      [...log(28, 1800), { date: shiftDate(END, 1), kcal: 5000 }, { date: dayAt(28), kcal: 5000 }],
      [...weightsAt(75, 0), { date: shiftDate(END, 1), kg: 99 }, { date: dayAt(28), kg: 50 }],
      END,
    )
    expect(polluted).toEqual(base)
  })
})

describe('expectedWeeklyChangeKg', () => {
  it('上限低於維持熱量 → 負值（會瘦）：1780 vs 1637 約 −0.13 kg/週', () => {
    expect(expectedWeeklyChangeKg(1780, 1637)).toBeCloseTo(-0.13, 2)
  })

  it('上限高於維持熱量 → 正值（會胖）', () => {
    expect(expectedWeeklyChangeKg(1700, 1900)).toBeGreaterThan(0)
  })

  it('上限等於維持熱量 → 0', () => {
    expect(expectedWeeklyChangeKg(1800, 1800)).toBe(0)
  })
})
