import { describe, expect, it } from 'vitest'
import {
  BASELINE_NEEDS,
  LOOKBACK_DAYS,
  baselineFetchRange,
  baselineWindow,
  baselineWithFallback,
  dailyKcalFromRows,
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

describe('dailyKcalFromRows', () => {
  it('同一天多筆：單份 kcal × qty 加總', () => {
    const rows = [
      { eaten_on: '2026-10-10', qty: 1, kcal: 500 },
      { eaten_on: '2026-10-10', qty: 2, kcal: 150 },
    ]
    expect(dailyKcalFromRows(rows)).toEqual([{ date: '2026-10-10', kcal: 800 }])
  })

  it('不同天分開；qty 可以是小數', () => {
    const rows = [
      { eaten_on: '2026-10-10', qty: 0.5, kcal: 400 },
      { eaten_on: '2026-10-11', qty: 1, kcal: 300 },
    ]
    const got = dailyKcalFromRows(rows)
    expect(got).toHaveLength(2)
    expect(got.find((d) => d.date === '2026-10-10')?.kcal).toBe(200)
    expect(got.find((d) => d.date === '2026-10-11')?.kcal).toBe(300)
  })

  it('數字欄位以字串回來也要算（numeric 欄位在 PostgREST 可能是字串）', () => {
    expect(dailyKcalFromRows([{ eaten_on: '2026-10-10', qty: '1.5', kcal: '200' }])).toEqual([
      { date: '2026-10-10', kcal: 300 },
    ])
  })

  it('沒有資料回空陣列', () => {
    expect(dailyKcalFromRows([])).toEqual([])
  })
})

/* 守門只抓「生理上不可能」的結果（每週變化超過 1.5 kg、維持熱量落在 800–5000 之外、算出非有限數），
   **不宣稱抓得到所有打錯的體重**：一筆離群值放在窗口中間時槓桿小，只會把結果推到「看起來合理但錯」
   的地方（探針：第 3 筆 57.5 → 1008 卡、第 4 筆 → 2592 卡），那是這個方法抓不到的，卡片的依據行
   與 spec 的誤差來源有寫。 */
describe('estimateMaintenance — 離譜的結果寧可說資料有誤', () => {
  const xs = [27, 22, 17, 12, 7, 2] // 6 筆，橫跨 25 天
  const six = (kgs: number[]): WeightPoint[] => xs.map((x, i) => ({ date: dayAt(x), kg: kgs[i] }))
  const flat = [75.5, 75.5, 75.5, 75.5, 75.5, 75.5]
  const withAt = (idx: number, kg: number) => flat.map((k, i) => (i === idx ? kg : k))

  it('最後一筆打錯（57.5）：斜率每週 −3.6 kg，不給數字，原因標 slope', () => {
    const r = estimateMaintenance(log(28, 1800), six(withAt(5, 57.5)), END)
    expect(r.status).toBe('implausible')
    if (r.status === 'implausible') expect(r.reason).toBe('slope')
  })

  it('第一筆打錯：會算出負的維持熱量，不給數字', () => {
    const r = estimateMaintenance(log(28, 1800), six(withAt(0, 57.5)), END)
    expect(r.status).toBe('implausible')
  })

  it('多打一個 0（750 kg）', () => {
    const r = estimateMaintenance(log(28, 1800), six(withAt(5, 750)), END)
    expect(r.status).toBe('implausible')
  })

  it('體重是 NaN：不讓 "約 NaN 卡" 上畫面，原因標 non-finite', () => {
    const r = estimateMaintenance(log(28, 1800), six(withAt(2, NaN)), END)
    expect(r.status).toBe('implausible')
    if (r.status === 'implausible') expect(r.reason).toBe('non-finite')
  })

  it('正常的每週掉 0.5 kg 不被誤判', () => {
    const r = estimateMaintenance(log(28, 1700), weightsAt(77, -0.5), END)
    expect(r.status).toBe('ok')
  })

  it('界在每週 1.5 kg：1.4 還算合理、1.6 就不算', () => {
    expect(estimateMaintenance(log(28, 2500), weightsAt(77, -1.4), END).status).toBe('ok')
    expect(estimateMaintenance(log(28, 2500), weightsAt(77, -1.6), END).status).toBe('implausible')
  })

  it('維持熱量低於 800：斜率合理（每週 +1.0 kg）但攝取少得離譜，不給數字', () => {
    // 1100 − (1.0 × 1100) ＝ 0，斜率本身沒超界，只有範圍那道能抓到
    const r = estimateMaintenance(log(28, 1100), weightsAt(75, 1.0), END)
    expect(r.status).toBe('implausible')
    if (r.status === 'implausible') expect(r.reason).toBe('range')
  })

  it('維持熱量高於 5000：斜率合理（每週 −1.0 kg）但攝取高得離譜，不給數字', () => {
    const r = estimateMaintenance(log(28, 4500), weightsAt(75, -1.0), END)
    expect(r.status).toBe('implausible')
    if (r.status === 'implausible') expect(r.reason).toBe('range')
  })

  it('飲食記錄打錯（平均 5500 卡、體重持平）：原因是 range，不是體重——畫面才不會叫人去查體重', () => {
    const r = estimateMaintenance(log(28, 5500), weightsAt(75, 0), END)
    expect(r.status).toBe('implausible')
    if (r.status === 'implausible') {
      expect(r.reason).toBe('range')
      expect(r.slopeKgPerWeek).toBeCloseTo(0, 5)
    }
  })

  it('implausible 帶著算出來的數字，讓畫面能說「為什麼不給」', () => {
    const r = estimateMaintenance(log(28, 1800), six(withAt(5, 57.5)), END)
    if (r.status === 'implausible') expect(r.slopeKgPerWeek).toBeCloseTo(-3.6, 1)
    else throw new Error('前提不成立：應該是 implausible')
  })
})

describe('baselineWindow', () => {
  it('窗尾是昨天、窗首往前 27 天（共 28 天，含窗尾）', () => {
    expect(baselineWindow('2026-10-12')).toEqual({ from: '2026-09-14', end: '2026-10-11' })
  })
  it('跨月與跨年', () => {
    expect(baselineWindow('2026-01-02')).toEqual({ from: '2025-12-05', end: '2026-01-01' })
  })
})

/* 回溯（spec AC 11–12）。偏移量一律是「距離窗尾（昨天＝END）幾天前」：offset 0＝END。
   最新窗口不夠時，往回找有記天數最多的合格窗口——**不是最近一個合格窗口**，因為停止記錄後的前幾天
   窗口仍有 ≥ 21 天有記、體重卻已經開始漲，會把結果拉低。 */
describe('baselineWithFallback', () => {
  const TODAY = shiftDate(END, 1)
  const logOffsets = (from: number, to: number, kcal = 1800): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal }))
  const weighEvery = (from: number, to: number, step = 3, kg = 75): WeightPoint[] => {
    const out: WeightPoint[] = []
    for (let o = from; o >= to; o -= step) out.push({ date: dayAt(o), kg })
    return out
  }

  it('最新窗口夠用：就用它，不回溯、不標舊', () => {
    const r = baselineWithFallback(log(28, 1800), weightsAt(75, 0), TODAY)
    expect(r.current.status).toBe('ok')
    expect(r.shown?.stale).toBe(false)
    expect(r.shown?.end).toBe(END)
  })

  it('最近一段沒記：往回找到記錄完整的那段，標舊並帶起訖日期', () => {
    // 記錄只有 offset 57..30（正好 28 天），之後完全沒記
    const r = baselineWithFallback(logOffsets(57, 30), weighEvery(60, 27), TODAY)
    expect(r.current.status).toBe('insufficient')
    expect(r.shown).not.toBeNull()
    expect(r.shown?.stale).toBe(true)
    expect(r.shown?.end).toBe(dayAt(30))
    expect(r.shown?.from).toBe(dayAt(57))
    expect(r.shown?.result.maintenance).toBeCloseTo(1800, 0)
  })

  it('取有記天數最多的，不是最近一個合格的（停記後前幾天窗口仍 ≥ 21 天有記）', () => {
    const r = baselineWithFallback(logOffsets(57, 30), weighEvery(60, 27), TODAY)
    // 窗尾在 offset 29..24 的窗口都還有 ≥ 21 天有記（合格），但有記天數少於 28
    expect(r.shown?.result.loggedDays).toBe(28)
    expect(r.shown?.end).toBe(dayAt(30))
  })

  it('連續 40 天記錄：用整段，不切成 28 天；窗尾落在最後有記的那天', () => {
    const r = baselineWithFallback(logOffsets(70, 31), weighEvery(72, 28), TODAY)
    expect(r.shown?.from).toBe(dayAt(70))
    expect(r.shown?.end).toBe(dayAt(31))
    expect(r.shown?.result.loggedDays).toBe(40)
  })

  it('兩串記錄有記天數同分時取較近的', () => {
    // 80..60 與 50..30 各 21 天，中間隔 9 天
    const logs = [...logOffsets(80, 60), ...logOffsets(50, 30)]
    const r = baselineWithFallback(logs, weighEvery(82, 28), TODAY)
    expect(r.shown?.result.loggedDays).toBe(21)
    expect(r.shown?.end).toBe(dayAt(30))
  })

  it(`超過 ${LOOKBACK_DAYS} 天前的記錄不回溯`, () => {
    const r = baselineWithFallback(logOffsets(130, 103), weighEvery(132, 100), TODAY)
    expect(r.current.status).toBe('insufficient')
    expect(r.shown).toBeNull()
  })

  it('取有記天數最多：停記後體重在漲時，maintenance 不被停記後的天數拉低（有記 28 天、其後每天 +0.07 kg）', () => {
    // 28 天連續記錄在 offset 57..30，體重到 offset 30 都是 75，其後每天 +0.07。
    // 若取「最近一個合格窗口」（窗尾 offset 24 附近，仍有 ≥ 21 天有記），斜率會被停記後的上升拉高 → 約 1700。
    const weights: WeightPoint[] = []
    for (let o = 60; o >= 1; o -= 3) weights.push({ date: dayAt(o), kg: o >= 30 ? 75 : 75 + (30 - o) * 0.07 })
    const r = baselineWithFallback(logOffsets(57, 30), weights, TODAY)
    expect(r.shown?.end).toBe(dayAt(30))
    expect(r.shown?.result.maintenance).toBeCloseTo(1800, 0)
  })

  it('記錄只有 24 天連續：涵蓋整段的窗口同分，要挑窗尾在最後有記那天的（誤差最小），不是最近的', () => {
    // 記錄 offset 60..37（24 天）。窗尾在 offset 33..37 的窗口都涵蓋全部 24 天，有記天數同分；
    // 窗尾越靠近今天，窗口尾端包進越多「停記後體重在漲」的天數。
    const logs = logOffsets(60, 37)
    const weights: WeightPoint[] = []
    for (let o = 63; o >= 1; o -= 3) weights.push({ date: dayAt(o), kg: o >= 37 ? 75 : 75 + (37 - o) * 0.07 })
    const r = baselineWithFallback(logs, weights, TODAY)
    expect(r.shown?.result.loggedDays).toBe(24)
    expect(r.shown?.end).toBe(dayAt(37))
    expect(r.shown?.result.maintenance).toBeCloseTo(1800, 0)
  })

  it('停記後第一筆體重跳 +1 kg 再持平：同樣不該被拉低', () => {
    const logs = logOffsets(60, 37)
    const weights: WeightPoint[] = []
    for (let o = 63; o >= 1; o -= 3) weights.push({ date: dayAt(o), kg: o >= 37 ? 75 : 76 })
    const r = baselineWithFallback(logs, weights, TODAY)
    expect(r.shown?.end).toBe(dayAt(37))
    expect(r.shown?.result.maintenance).toBeCloseTo(1800, 0)
  })

  it('回溯上限的邊界：窗尾最遠 90 天——117..97 的 21 天找得到，118..98 找不到', () => {
    // 窗尾最遠在 offset 90，窗口涵蓋 offset 117..90。118 在它之外，所以整段記錄裝不進任何窗口。
    const near = baselineWithFallback(logOffsets(117, 97), weighEvery(119, 95), TODAY)
    expect(near.shown).not.toBeNull()
    const far = baselineWithFallback(logOffsets(118, 98), weighEvery(120, 96), TODAY)
    expect(far.shown).toBeNull()
  })

  it('最新窗口是「資料有誤」時不回溯——不用乾淨的舊資料把錯誤蓋掉', () => {
    // 最新窗口：全記、但最後一筆體重打錯；更早還有一段乾淨的記錄
    const logs = [...log(28, 1800), ...logOffsets(90, 60)]
    const weights = [...weightsAt(75.5, 0, 5).slice(0, -1), { date: dayAt(2), kg: 57.5 }, ...weighEvery(90, 60)]
    const r = baselineWithFallback(logs, weights, TODAY)
    expect(r.current.status).toBe('implausible')
    expect(r.shown).toBeNull()
  })
})

describe('baselineWithFallback — 一連串記錄的界線', () => {
  const TODAY = shiftDate(END, 1)
  const logOffsets = (from: number, to: number, kcal = 1800): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal }))
  const weighEvery = (from: number, to: number, step = 3, kg = 75): WeightPoint[] => {
    const out: WeightPoint[] = []
    for (let o = from; o >= to; o -= step) out.push({ date: dayAt(o), kg })
    return out
  }

  it('中間漏記兩天仍是同一串：15＋14 天 ＝ 29 天', () => {
    const logs = [...logOffsets(60, 46), ...logOffsets(43, 30)] // 漏 45、44
    const r = baselineWithFallback(logs, weighEvery(62, 28), TODAY)
    expect(r.shown?.from).toBe(dayAt(60))
    expect(r.shown?.end).toBe(dayAt(30))
    expect(r.shown?.result.loggedDays).toBe(29)
  })

  it('漏記三天就斷成兩串，各自不到 21 天 ⇒ 找不到', () => {
    const logs = [...logOffsets(60, 46), ...logOffsets(42, 30)] // 漏 45、44、43
    const r = baselineWithFallback(logs, weighEvery(62, 28), TODAY)
    expect(r.shown).toBeNull()
  })

  it('每週只有一筆體重：用整段所有體重，不被切成每窗 4 筆的窗口', () => {
    // 49 天連續記錄、每 7 天一筆體重 → 整段 8 筆；若切成 28 天窗口，每窗只有 4–5 筆
    const logs = logOffsets(80, 32)
    const r = baselineWithFallback(logs, weighEvery(80, 32, 7), TODAY)
    expect(r.shown?.result.loggedDays).toBe(49)
    expect(r.shown?.result.weighIns).toBe(7)
    expect(r.shown?.from).toBe(dayAt(80))
    expect(r.shown?.end).toBe(dayAt(32))
  })

  it('整段的估計不會被窗口切法左右：體重持平 ⇒ 維持熱量＝平均攝取', () => {
    const r = baselineWithFallback(logOffsets(80, 32), weighEvery(80, 32, 7), TODAY)
    expect(r.shown?.result.maintenance).toBeCloseTo(1800, 0)
  })
})

describe('baselineFetchRange', () => {
  it('最新窗口往前再加回溯天數；窗尾是昨天', () => {
    const { from, end } = baselineFetchRange('2026-10-12')
    expect(end).toBe('2026-10-11')
    // 窗首 2026-09-14，再往前 90 天
    expect(from).toBe(shiftDate('2026-09-14', -LOOKBACK_DAYS))
  })
})
