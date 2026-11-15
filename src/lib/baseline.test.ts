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
  insufficientShortfalls,
  maintenanceAdvice,
  segmentedFit,
  type AdviceContext,
  type BaselineResult,
  type DailyKcal,
  type WeightPoint,
} from './baseline'
import { shiftDate } from './dates'

/* 全部用合成資料、顯式傳入窗尾日期，不依賴系統時鐘——否則測試會在跨月／跨年那幾天
   自己變成另一個案例。窗口＝END 往前 28 天（含 END），今天（END+1）不在裡面。 */
const END = '2026-10-11'
const dayAt = (i: number) => shiftDate(END, -i) // i=0 是窗尾，i=27 是窗首

const log = (days: number, kcal: number): DailyKcal[] =>
  Array.from({ length: days }, (_, i) => ({ date: dayAt(i), kcal, complete: true }))

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
    expect(BASELINE_NEEDS).toEqual({ loggedDays: 21, weighIns: 4, weightSpanDays: 14, recentDays: 4 })
  })
})

describe('estimateMaintenance — 什麼算「有記」、什麼在窗口外', () => {
  it('午、晚餐沒記齊的日子不完整：不進平均，也不算有記天數（就算合計很高）', () => {
    // 21 天完整（1800）緊接 7 天不完整（只記早午餐，合計 1500）——後者若被算進去，平均會被拉低
    const logs = [...log(21, 1800), ...Array.from({ length: 7 }, (_, i) => ({ date: dayAt(21 + i), kcal: 1500, complete: false }))]
    const r = estimateMaintenance(logs, weightsAt(75, 0), END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.loggedDays).toBe(21)
      expect(r.maintenance).toBeCloseTo(1800, 0)
    }
  })

  it('完整只看午、晚餐有沒有記，不看合計多少（舊的「合計 ≥ 1000」拿掉了）', () => {
    const r = estimateMaintenance(log(28, 900), weightsAt(75, 0), END)
    expect(r.status).toBe('ok')
  })

  it('窗口之外（今天、窗首前一天）的攝取與體重完全不影響結果', () => {
    const base = estimateMaintenance(log(28, 1800), weightsAt(75, 0), END)
    const polluted = estimateMaintenance(
      [...log(28, 1800), { date: shiftDate(END, 1), kcal: 5000, complete: true }, { date: dayAt(28), kcal: 5000, complete: true }],
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
  it('同一天多筆：單份 kcal × qty 加總；午、晚餐都有記才算完整', () => {
    const rows = [
      { eaten_on: '2026-10-10', qty: 1, kcal: 500, meal: 'lunch' },
      { eaten_on: '2026-10-10', qty: 2, kcal: 150, meal: 'dinner' },
    ]
    expect(dailyKcalFromRows(rows)).toEqual([{ date: '2026-10-10', kcal: 800, complete: true }])
  })

  it('只記早餐、午餐、點心（沒有晚餐）不完整', () => {
    const rows = [
      { eaten_on: '2026-10-10', qty: 1, kcal: 500, meal: 'breakfast' },
      { eaten_on: '2026-10-10', qty: 1, kcal: 900, meal: 'lunch' },
      { eaten_on: '2026-10-10', qty: 1, kcal: 300, meal: 'snack' },
    ]
    expect(dailyKcalFromRows(rows)[0].complete).toBe(false)
  })

  it('不同天分開；qty 可以是小數', () => {
    const rows = [
      { eaten_on: '2026-10-10', qty: 0.5, kcal: 400, meal: 'lunch' },
      { eaten_on: '2026-10-11', qty: 1, kcal: 300, meal: 'lunch' },
    ]
    const got = dailyKcalFromRows(rows)
    expect(got).toHaveLength(2)
    expect(got.find((d) => d.date === '2026-10-10')?.kcal).toBe(200)
    expect(got.find((d) => d.date === '2026-10-11')?.kcal).toBe(300)
  })

  it('數字欄位以字串回來也要算（numeric 欄位在 PostgREST 可能是字串）', () => {
    expect(dailyKcalFromRows([{ eaten_on: '2026-10-10', qty: '1.5', kcal: '200', meal: 'dinner' }])).toEqual([
      { date: '2026-10-10', kcal: 300, complete: false },
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
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal, complete: true }))
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
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal, complete: true }))
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

describe('insufficientShortfalls', () => {
  const insufficient = (loggedDays: number, weighIns: number, weightSpanDays: number, recentDays = 7, settlingUntil: string | null = null) =>
    ({ status: 'insufficient', loggedDays, weighIns, weightSpanDays, recentDays, settlingUntil }) as const

  it('記錄天數與體重筆數都不夠 → 兩項，順序固定；跨度不再補一句', () => {
    expect(insufficientShortfalls(insufficient(18, 2, 0))).toEqual([
      { kind: 'loggedDays', have: 18, need: 21 },
      { kind: 'weighIns', have: 2, need: 4 },
    ])
  })
  it('筆數夠了、跨度只有 9 天 → 缺跨度', () => {
    expect(insufficientShortfalls(insufficient(21, 4, 9))).toEqual([{ kind: 'weightSpanDays', have: 9, need: 14 }])
  })
  it('只缺體重筆數（記錄與跨度都夠）', () => {
    expect(insufficientShortfalls(insufficient(25, 3, 20))).toEqual([{ kind: 'weighIns', have: 3, need: 4 }])
  })
  it('邊界值剛好達標 → 沒有缺項', () => {
    expect(insufficientShortfalls(insufficient(21, 4, 14, 4))).toEqual([])
  })
  it('最近 7 天完整不到 4 天 → 缺「最近一週」，排在最後', () => {
    expect(insufficientShortfalls(insufficient(24, 6, 20, 3))).toEqual([{ kind: 'recentDays', have: 3, need: 4 }])
  })
  it('剛開始訓練 → 排在最前面，其他缺項照列', () => {
    expect(insufficientShortfalls(insufficient(10, 4, 20, 7, '2026-11-08'))).toEqual([
      { kind: 'settling', until: '2026-11-08' },
      { kind: 'loggedDays', have: 10, need: 21 },
    ])
  })
})

/* 每日目標省心（spec.md「每日目標省心：小改自動、大改才問」）。預期值全部手算：
   體重每週一筆（窗尾、往前 7／14／21 天）⇒ Σ(x − x̄)² ＝ 2 × (10.5² ＋ 3.5²) ＝ 245，
   理論 1 SE ＝ 0.4 × 7700 ÷ √245 ＝ 196.77 → 比較時捨入成 197（spec 表「每週 1 次 ±197」）。體重持平 ⇒ 殘差 0、維持熱量＝平均攝取。 */
const TODAY_ADV = shiftDate(END, 1)
const weekly = (kgs: readonly number[] = [75, 75, 75, 75]): WeightPoint[] => [21, 14, 7, 0].map((i, n) => ({ date: dayAt(i), kg: kgs[n] }))
const okAt = (kcal: number, ws = weekly()) => {
  const r = estimateMaintenance(log(28, kcal), ws, END)
  if (r.status !== 'ok') throw new Error(`前提不成立：${r.status}`)
  return r
}
/** 已改用回推、沒變動過、BMR 遠低於目標：只剩三段判斷在作用 */
const ctx = (inUseTdee: number, over: Partial<AdviceContext> = {}): AdviceContext => ({
  inUseTdee, usingFormula: false, changedOn: null, today: TODAY_ADV, bmr: 1000, targetOffset: -500, ...over,
})

describe('有效標準誤差＝max(殘差, 理論)', () => {
  it('體重持平：殘差是 0，取理論值 0.4 × 7700 ÷ √245', () => {
    const r = okAt(2000)
    expect(r.low).toBe(r.high)
    expect(r.se).toBeCloseTo(3080 / Math.sqrt(245), 6)
    expect(r.se).toBeCloseTo(196.77, 2)
  })
  it('每天一筆（28 筆）：Σ(x − x̄)² ＝ 28 × (28² − 1) ÷ 12 ＝ 1827，1 SE ≈ 72（spec 表「每天 ±72」）', () => {
    const daily: WeightPoint[] = Array.from({ length: 28 }, (_, i) => ({ date: dayAt(i), kg: 75 }))
    expect(okAt(2000, daily).se).toBeCloseTo(3080 / Math.sqrt(1827), 6)
    expect(okAt(2000, daily).se).toBeCloseTo(72.06, 2)
  })
  it('體重上下抖：殘差比理論大就取殘差', () => {
    // 75、76.5、73.5、75：斜率 −10.5 ÷ 245 kg/天，SSE 4.05，殘差 SE ＝ √(4.05 ÷ 2 ÷ 245) × 7700 ＝ 700.04 > 196.77
    const r = okAt(2000, weekly([75, 76.5, 73.5, 75]))
    expect(r.maintenance).toBeCloseTo(2330, 6)
    expect(r.se).toBeCloseTo(700.04, 2)
    expect(r.se).toBeCloseTo(r.high - r.maintenance, 6)
  })
})

describe('maintenanceAdvice：三段（1 SE 內不動、2 SE 內自動移一半、超過才問）', () => {
  const r = okAt(2000) // 維持熱量 2000、SE 197
  it('|d| 剛好等於 1 SE 不動，兩邊都是', () => {
    expect(maintenanceAdvice(r, ctx(2197))).toMatchObject({ kind: 'same', next: 2099 }) // round(2197 − 98.5)
    expect(maintenanceAdvice(r, ctx(1803)).kind).toBe('same')
  })
  it('超過 1 SE 一卡就自動，寫入的是往回推值移一半', () => {
    expect(maintenanceAdvice(r, ctx(2198))).toMatchObject({ kind: 'auto', next: 2099 }) // 2198 − 198 ÷ 2
    expect(maintenanceAdvice(r, ctx(1802))).toMatchObject({ kind: 'auto', next: 1901 })
  })
  it('|d| 剛好等於 2 SE 還是自動', () => {
    expect(maintenanceAdvice(r, ctx(2394))).toMatchObject({ kind: 'auto', next: 2197 }) // d ＝ −394
    expect(maintenanceAdvice(r, ctx(1606))).toMatchObject({ kind: 'auto', next: 1803 })
  })
  it('超過 2 SE 才問；問的時候按改用也是移一半', () => {
    expect(maintenanceAdvice(r, ctx(2395))).toMatchObject({ kind: 'ask', next: 2198 }) // round(2395 − 197.5)
    expect(maintenanceAdvice(r, ctx(1605))).toMatchObject({ kind: 'ask', next: 1803 }) // round(1605 ＋ 197.5)
  })
  it('比捨入後的整數：回推 1999.6 對現用 2000 是 d ＝ 0', () => {
    const r2 = { ...r, maintenance: 1999.6 }
    expect(maintenanceAdvice(r2, ctx(2000))).toMatchObject({ kind: 'same', next: 2000 })
  })
  it('SE 取殘差時門檻跟著變寬：差 600 卡仍在 1 SE（700）內，不動', () => {
    const noisy = okAt(2000, weekly([75, 76.5, 73.5, 75])) // 維持熱量 2330、SE 700
    expect(maintenanceAdvice(noisy, ctx(1730)).kind).toBe('same')
    expect(maintenanceAdvice(noisy, ctx(1629)).kind).toBe('auto') // d ＝ 701
  })
})

describe('maintenanceAdvice：第一次從公式換過去、低於 BMR、冷卻', () => {
  const r = okAt(2000)
  it('用公式時差距超過 1 SE 一律問（就算落在自動的區間）', () => {
    expect(maintenanceAdvice(r, ctx(2198, { usingFormula: true }))).toMatchObject({ kind: 'ask', next: 2099 })
    expect(maintenanceAdvice(r, ctx(2300, { usingFormula: true })).kind).toBe('ask')
  })
  it('用公式時差距在 1 SE 內也不問', () => {
    expect(maintenanceAdvice(r, ctx(2197, { usingFormula: true })).kind).toBe('same')
  })
  it('自動後目標會低於 BMR 改成問：2300 → 2150，目標 2150 − 500 ＝ 1650', () => {
    expect(maintenanceAdvice(r, ctx(2300, { bmr: 1650 }))).toMatchObject({ kind: 'auto', next: 2150 })
    expect(maintenanceAdvice(r, ctx(2300, { bmr: 1651 }))).toMatchObject({ kind: 'ask', next: 2150 })
    expect(maintenanceAdvice(r, ctx(2300, { bmr: null })).kind).toBe('auto')
  })
  it('往上調不問 BMR：1700 → 1850，目標 1850 − 500 ＝ 1350 雖然還低於 BMR 1600，但是往安全的方向（review）', () => {
    expect(maintenanceAdvice(r, ctx(1700, { bmr: 1600 }))).toMatchObject({ kind: 'auto', next: 1850 })
  })
  it('移一半的值夾在 800–5000（資料庫 check 的範圍）：公式 9000 → 一半是 5500，寫 5000', () => {
    expect(maintenanceAdvice(r, ctx(9000, { usingFormula: true }))).toMatchObject({ kind: 'ask', next: 5000 })
  })
  it('七天內不會調第二次、也不問；第七天起照常', () => {
    expect(maintenanceAdvice(r, ctx(2300, { changedOn: shiftDate(TODAY_ADV, -6) })).kind).toBe('same')
    expect(maintenanceAdvice(r, ctx(2300, { changedOn: shiftDate(TODAY_ADV, -7) })).kind).toBe('auto')
    // 差很多、或剛改回公式，七天內一樣不問
    expect(maintenanceAdvice(r, ctx(2500, { changedOn: TODAY_ADV })).kind).toBe('same')
    expect(maintenanceAdvice(r, ctx(2500, { usingFormula: true, changedOn: shiftDate(TODAY_ADV, -3) })).kind).toBe('same')
  })
  it('記錄不夠回 lacking、不可能的結果回 suspect，冷卻與否都一樣（不動也不問）', () => {
    const lacking: BaselineResult = { status: 'insufficient', loggedDays: 20, weighIns: 3, weightSpanDays: 14, recentDays: 7, settlingUntil: null }
    const suspect: BaselineResult = { status: 'implausible', maintenance: 5760, slopeKgPerWeek: -4, reason: 'slope' }
    expect(maintenanceAdvice(lacking, ctx(2000))).toEqual({ kind: 'lacking', result: lacking })
    expect(maintenanceAdvice(suspect, ctx(2000))).toEqual({ kind: 'suspect', result: suspect })
    expect(maintenanceAdvice(lacking, ctx(2000, { changedOn: TODAY_ADV })).kind).toBe('lacking')
  })
  it('回溯到舊的一段照樣顯示，但最新窗口不夠就是 lacking，不會變成可以改用', () => {
    // 窗尾往前第 30～80 天天天記、體重持平；最新 28 天完全沒記
    const old: DailyKcal[] = Array.from({ length: 50 }, (_, i) => ({ date: dayAt(30 + i), kcal: 1800, complete: true }))
    const oldWeights: WeightPoint[] = Array.from({ length: 8 }, (_, i) => ({ date: dayAt(30 + i * 7), kg: 75 }))
    const { current, shown } = baselineWithFallback(old, oldWeights, TODAY_ADV)
    expect(shown?.stale).toBe(true)
    expect(shown?.result.status).toBe('ok')
    expect(maintenanceAdvice(current, ctx(2000)).kind).toBe('lacking')
  })
})

/* 2026-11-14 修四項（spec.md「減重回饋圈 review」）。②③④ 的案例：最新窗口不再整窗平均、最近一週要夠、開始訓練後頭 28 天不用。 */
describe('最新窗口只用完整記錄最多的一連串（修 ②）', () => {
  const TODAY = shiftDate(END, 1)
  const run = (from: number, to: number, kcal = 1800): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal, complete: true }))

  it('整天沒記的三天把窗口切開：只用後面那串，前面那串的體重不參與', () => {
    // 完整：27..25、21..0（中間 24..22 整天沒記）。前面那段體重 77，後面持平 75——整窗迴歸會算出在掉、維持熱量偏高
    const logs = [...run(27, 25), ...run(21, 0)]
    const weights: WeightPoint[] = [{ date: dayAt(27), kg: 77 }, { date: dayAt(25), kg: 77 }]
    for (let o = 21; o >= 0; o -= 3) weights.push({ date: dayAt(o), kg: 75 })
    const r = estimateMaintenance(logs, weights, END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.from).toBe(dayAt(21))
      expect(r.end).toBe(END)
      expect(r.loggedDays).toBe(22)
      expect(r.maintenance).toBeCloseTo(1800, 0)
    }
    expect(baselineWithFallback(logs, weights, TODAY).shown?.from).toBe(dayAt(21))
  })

  it('窗口裡最長的一串不到 21 天：資料不足，記錄天數報的是那一串的', () => {
    const logs = [...run(27, 14), ...run(10, 0)] // 14 天＋11 天，中間空 3 天
    const r = estimateMaintenance(logs, weightsAt(75, 0), END)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(r.loggedDays).toBe(14)
  })
})

describe('最近一週完整不到 4 天就暫停（修 ③）', () => {
  const TODAY = shiftDate(END, 1)
  const run = (from: number, to: number): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal: 1800, complete: true }))

  it('最近 7 天只有 3 天完整：不出新數字；畫面沿用那一段、標舊', () => {
    const r = baselineWithFallback(run(27, 4), weightsAt(75, 0), TODAY)
    expect(r.current.status).toBe('insufficient')
    if (r.current.status === 'insufficient') {
      expect(r.current.recentDays).toBe(3)
      expect(r.current.loggedDays).toBe(24)
      expect(insufficientShortfalls(r.current)).toEqual([{ kind: 'recentDays', have: 3, need: 4 }])
    }
    expect(r.shown?.stale).toBe(true)
    expect(r.shown?.end).toBe(dayAt(4))
    expect(maintenanceAdvice(r.current, ctx(2000)).kind).toBe('lacking')
  })

  it('剛好 4 天完整就照算', () => {
    const r = estimateMaintenance(run(27, 3), weightsAt(75, 0), END)
    expect(r.status).toBe('ok')
  })
})

describe('開始訓練後頭 28 天不用（修 ④）', () => {
  const TODAY = shiftDate(END, 1)
  const run = (from: number, to: number): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal: 1800, complete: true }))
  const weighEvery = (from: number, to: number, kg: (o: number) => number): WeightPoint[] => {
    const out: WeightPoint[] = []
    for (let o = from; o >= to; o -= 3) out.push({ date: dayAt(o), kg: kg(o) })
    return out
  }

  it('窗尾還在頭 28 天裡：最新窗口說「剛開始訓練」；回溯到訓練前那段，訓練後體重跳起來的水分不影響', () => {
    const start = dayAt(20)
    // 訓練前持平 75；開始訓練後兩週內漲 1.5 kg（水分、肝醣）
    const weights = weighEvery(62, 0, (o) => (o > 20 ? 75 : 75 + Math.min(1.5, (20 - o) * 0.1)))
    const r = baselineWithFallback(run(60, 0), weights, TODAY, { trainingStart: start })
    expect(r.current.status).toBe('insufficient')
    if (r.current.status === 'insufficient') {
      // 最快算得出來的那天＝排除段最後一天（start＋27）再過 21 天
      expect(r.current.settlingUntil).toBe(shiftDate(start, 27 + 21))
      expect(insufficientShortfalls(r.current)[0]).toEqual({ kind: 'settling', until: shiftDate(start, 27 + 21) })
    }
    expect(r.shown?.stale).toBe(true)
    expect(r.shown?.from).toBe(dayAt(60))
    expect(r.shown?.end).toBe(dayAt(21))
    expect(r.shown?.result.maintenance).toBeCloseTo(1800, 0)
  })

  it('不給開始訓練的日期：照舊整段都用（訓練後的上漲把維持熱量拉低）', () => {
    const weights = weighEvery(62, 0, (o) => (o > 20 ? 75 : 75 + Math.min(1.5, (20 - o) * 0.1)))
    const r = baselineWithFallback(run(60, 0), weights, TODAY)
    expect(r.current.status).toBe('ok')
    if (r.current.status === 'ok') expect(r.current.maintenance).toBeLessThan(1800)
  })

  it('開始訓練已經超過 28 天：排除的那段在窗口外，最新窗口照算', () => {
    const r = estimateMaintenance(run(27, 0), weightsAt(75, 0), END, { trainingStart: dayAt(60) })
    expect(r.status).toBe('ok')
  })
})

describe('v2.137 review：剛開始訓練與資料不足時說的話', () => {
  const run = (from: number, to: number): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal: 1800, complete: true }))
  const every3 = (from: number, to: number): WeightPoint[] => {
    const out: WeightPoint[] = []
    for (let o = from; o >= to; o -= 3) out.push({ date: dayAt(o), kg: 75 })
    return out
  }

  it('天天記、10 天前開始訓練（訓練前那串只有 17 天）：只說剛開始訓練，不說「最近 7 天還差」', () => {
    const r = estimateMaintenance(run(60, 0), every3(60, 0), END, { trainingStart: dayAt(10) })
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.recentDays).toBe(7)
      const kinds = insufficientShortfalls(r).map((s) => s.kind)
      expect(kinds[0]).toBe('settling')
      expect(kinds).not.toContain('recentDays')
    }
  })

  it('最快哪天算得出來是真的：排除段結束後再 21 天整串湊滿就算，差一天就還在等', () => {
    // 開始訓練在 dayAt(48)：排除 48..21，20..0 正好 21 天 ⇒ 算得出來
    expect(estimateMaintenance(run(60, 0), every3(60, 0), END, { trainingStart: dayAt(48) }).status).toBe('ok')
    // 晚一天開始：只湊得出 20 天 ⇒ 還在等，而且說的是「剛開始訓練」，不是叫人接回記錄
    const r = estimateMaintenance(run(60, 0), every3(60, 0), END, { trainingStart: dayAt(47) })
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.settlingUntil).toBe(shiftDate(END, 1))
      expect(insufficientShortfalls(r)[0].kind).toBe('settling')
    }
  })

  it('記錄還不夠時，體重筆數報整個窗口的：體重量在另一串裡的人不會被說「體重還差」', () => {
    // A：27..13（15 天）、空 3 天、B：9..0（10 天）；體重 8 筆全在 B
    const logs = [...run(27, 13), ...run(9, 0)]
    const weights: WeightPoint[] = Array.from({ length: 8 }, (_, i) => ({ date: dayAt(i), kg: 75 }))
    const r = estimateMaintenance(logs, weights, END)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.loggedDays).toBe(15)
      expect(r.weighIns).toBe(8)
      expect(insufficientShortfalls(r).map((s) => s.kind)).not.toContain('weighIns')
    }
  })
})

describe('量法斷點：共用斜率、各段自己的截距（v2.138）', () => {
  /** 28 天每 3 天一筆、體重持平 75；offset ≤ shiftAt 的那幾筆整段 +2（換電池後讀數平移），brkAt 那筆標斷點 */
  const shifted = (shiftAt: number, brk: boolean): WeightPoint[] => {
    const out: WeightPoint[] = []
    for (let o = 27; o >= 0; o -= 3) out.push({ date: dayAt(o), kg: o <= shiftAt ? 77 : 75, ...(brk && o === shiftAt ? { brk: true } : {}) })
    return out
  }

  it('換電池讀數整段 +2：不標斷點會當成在變胖、回推偏低；標了就回到平均攝取', () => {
    const plain = estimateMaintenance(log(28, 1800), shifted(12, false), END)
    const marked = estimateMaintenance(log(28, 1800), shifted(12, true), END)
    expect(plain.status).toBe('ok')
    expect(marked.status).toBe('ok')
    if (plain.status === 'ok') expect(plain.maintenance).toBeLessThan(1800 - 300)
    if (marked.status === 'ok') {
      expect(marked.maintenance).toBeCloseTo(1800, 0)
      expect(marked.weighIns).toBe(10)
    }
  })

  it('每多一段就多用掉一筆體重：4 筆切成兩段只剩 3 筆可用，資料不足', () => {
    const w: WeightPoint[] = [
      { date: dayAt(27), kg: 75 }, { date: dayAt(18), kg: 75 },
      { date: dayAt(9), kg: 77, brk: true }, { date: dayAt(0), kg: 77 },
    ]
    const r = estimateMaintenance(log(28, 1800), w, END)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(r.weighIns).toBe(3)
  })

  it('斷點標在這段的第一筆上不算切段（前面沒有東西可比）', () => {
    const w = weightsAt(75, 0).map((p, i) => (i === 0 ? { ...p, brk: true } : p))
    const r = estimateMaintenance(log(28, 1800), w, END)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.weighIns).toBe(w.length)
  })

  it('segmentedFit：只有一段時就是普通最小平方；兩段平移不影響斜率', () => {
    const line = [0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1, seg: 0 }))
    expect(segmentedFit(line).slope).toBeCloseTo(2, 10)
    const two = [...line, ...[4, 5, 6, 7].map((x) => ({ x, y: 2 * x + 11, seg: 1 }))]
    expect(segmentedFit(two).slope).toBeCloseTo(2, 10)
    expect(segmentedFit(two).k).toBe(2)
  })
})

describe('量法斷點 review（v2.138）', () => {
  const run = (from: number, to: number): DailyKcal[] =>
    Array.from({ length: from - to + 1 }, (_, i) => ({ date: dayAt(from - i), kcal: 1800, complete: true }))

  it('跨度看各段自己的跨度加總：斷點兩側各量三天（2＋2 天）、中間隔很久，不算跨 14 天', () => {
    const w: WeightPoint[] = [
      { date: dayAt(27), kg: 75.0 }, { date: dayAt(26), kg: 75.4 }, { date: dayAt(25), kg: 75.2 },
      { date: dayAt(2), kg: 76.0, brk: true }, { date: dayAt(1), kg: 76.3 }, { date: dayAt(0), kg: 76.1 },
    ]
    const r = estimateMaintenance(log(28, 1800), w, END)
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') expect(insufficientShortfalls(r).map((s) => s.kind)).toContain('weightSpanDays')
  })

  it('記錄還不夠時報的體重筆數也扣掉斷點佔用的：4 筆切兩段報 3 筆，現在就說缺', () => {
    const w: WeightPoint[] = [
      { date: dayAt(27), kg: 75 }, { date: dayAt(20), kg: 75 },
      { date: dayAt(14), kg: 76, brk: true }, { date: dayAt(0), kg: 76 },
    ]
    const r = estimateMaintenance([...run(27, 13)], w, END) // 只有 15 天完整
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.weighIns).toBe(3)
      expect(insufficientShortfalls(r).map((s) => s.kind)).toContain('weighIns')
    }
  })
})

