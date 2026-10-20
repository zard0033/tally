import { describe, expect, it } from 'vitest'
import {
  adjustEnd,
  firedOnTime,
  formatRest,
  overtimeText,
  parseEndAt,
  remainingMs,
  REST_SEC,
  startRest,
} from './restTimer'

const NOW = 1_000_000 // 任意的基準時間戳；預期值都是從它手算

describe('startRest／remainingMs', () => {
  it('結束時間點＝現在＋時長；剩餘＝結束點−現在', () => {
    expect(startRest(NOW, 90)).toBe(1_090_000)
    expect(remainingMs(1_090_000, NOW + 30_000)).toBe(60_000)
  })

  it('歸零後剩餘為負（超時多久）', () => {
    expect(remainingMs(1_090_000, 1_113_000)).toBe(-23_000)
  })
})

describe('formatRest（倒數：無條件進位）', () => {
  it('整分整秒', () => {
    expect(formatRest(90_000)).toBe('1:30')
    expect(formatRest(60_000)).toBe('1:00')
    expect(formatRest(59_000)).toBe('0:59')
    expect(formatRest(9_000)).toBe('0:09')
  })

  it('不到整秒進位：59.001 秒還是 1:00，1 毫秒還是 0:01', () => {
    expect(formatRest(59_001)).toBe('1:00')
    expect(formatRest(1)).toBe('0:01')
    expect(formatRest(60_001)).toBe('1:01')
  })

  it('0 與負數一律 0:00', () => {
    expect(formatRest(0)).toBe('0:00')
    expect(formatRest(-5_000)).toBe('0:00')
  })

  it('十分鐘上限也能顯示', () => {
    expect(formatRest(600_000)).toBe('10:00')
  })
})

describe('overtimeText（超時：無條件捨去）', () => {
  it('超時 23.999 秒是已過 0:23，23 秒整也是 0:23，24 秒整才是 0:24', () => {
    expect(overtimeText(-23_999)).toBe('休息結束 · 已過 0:23')
    expect(overtimeText(-23_000)).toBe('休息結束 · 已過 0:23')
    expect(overtimeText(-24_000)).toBe('休息結束 · 已過 0:24')
  })

  it('不滿 1 秒只寫休息結束（含剛好 0）', () => {
    expect(overtimeText(0)).toBe('休息結束')
    expect(overtimeText(-999)).toBe('休息結束')
    expect(overtimeText(-1_000)).toBe('休息結束 · 已過 0:01')
  })

  it('超過一分鐘用 m:ss', () => {
    expect(overtimeText(-65_000)).toBe('休息結束 · 已過 1:05')
  })
})

describe('adjustEnd（夾在剩餘 0～10 分鐘）', () => {
  it('＋15／−15 各加減 15 秒', () => {
    const end = NOW + 60_000
    expect(adjustEnd(end, 15, NOW)).toBe(NOW + 75_000)
    expect(adjustEnd(end, -15, NOW)).toBe(NOW + 45_000)
  })

  it('以現在起算：倒數走了一半再按，是從剩下的加減', () => {
    const end = NOW + 60_000
    expect(adjustEnd(end, 15, NOW + 20_000)).toBe(NOW + 20_000 + 55_000)
  })

  it('上限：剩 595 秒按＋15 剛好 600 秒；剩 598 秒按＋15 也停在 600 秒', () => {
    expect(adjustEnd(NOW + 595_000, 15, NOW)).toBe(NOW + 600_000)
    expect(adjustEnd(NOW + 598_000, 15, NOW)).toBe(NOW + 600_000)
  })

  it('剩 10 秒按−15：剩 0（結束），不會是負的', () => {
    expect(adjustEnd(NOW + 10_000, -15, NOW)).toBe(NOW)
  })

  it('已超時再按＋15：從 0 重新倒數 15 秒', () => {
    expect(adjustEnd(NOW - 23_000, 15, NOW)).toBe(NOW + 15_000)
  })

  it('已超時按−15：還是 0', () => {
    expect(adjustEnd(NOW - 23_000, -15, NOW)).toBe(NOW)
  })
})

describe('firedOnTime', () => {
  it('歸零不到 2 秒內回前景算準時；2 秒整起不算', () => {
    const end = NOW
    expect(firedOnTime(end, NOW)).toBe(true)
    expect(firedOnTime(end, NOW + 1_999)).toBe(true)
    expect(firedOnTime(end, NOW + 2_000)).toBe(false)
  })
})

describe('REST_SEC', () => {
  it('固定 1 分 30 秒', () => {
    expect(REST_SEC).toBe(90)
    expect(startRest(NOW, REST_SEC)).toBe(NOW + 90_000)
  })
})

describe('parseEndAt（sessionStorage 的結束時間點）', () => {
  it('還沒到期且在上限內：照收', () => {
    expect(parseEndAt(String(NOW + 30_000), NOW)).toBe(NOW + 30_000)
    expect(parseEndAt(String(NOW + 600_000), NOW)).toBe(NOW + 600_000)
  })

  it('已到期（含剛好等於現在）不復活', () => {
    expect(parseEndAt(String(NOW), NOW)).toBeNull()
    expect(parseEndAt(String(NOW - 1), NOW)).toBeNull()
  })

  it('比上限還遠是壞資料', () => {
    expect(parseEndAt(String(NOW + 600_001), NOW)).toBeNull()
  })

  it('沒有、空字串、不是數字、Infinity 都回 null', () => {
    expect(parseEndAt(null, NOW)).toBeNull()
    expect(parseEndAt('', NOW)).toBeNull()
    expect(parseEndAt('   ', NOW)).toBeNull()
    expect(parseEndAt('abc', NOW)).toBeNull()
    expect(parseEndAt('Infinity', NOW)).toBeNull()
  })
})
