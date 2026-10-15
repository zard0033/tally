import { describe, expect, it } from 'vitest'
import { project, shouldDismiss } from './sheetPhysics'

describe('project：放手後「會滑到哪」', () => {
  it('速度 0 不位移，方向跟著速度走', () => {
    expect(project(0)).toBe(0)
    expect(project(500)).toBeGreaterThan(0)
    expect(project(-500)).toBeLessThan(0)
    expect(project(-500)).toBeCloseTo(-project(500), 9)
  })

  it('速度愈快滑得愈遠（成正比）', () => {
    expect(project(1000)).toBeCloseTo(project(500) * 2, 9)
  })

  it('800 px/s 約滑 79px（decelerationRate 0.99）', () => {
    expect(project(800)).toBeCloseTo(79.2, 1)
  })
})

describe('shouldDismiss：往下拖放手，關還是回彈', () => {
  const H = 400

  it('慢慢拖一小段 → 回彈', () => {
    expect(shouldDismiss({ offset: 40, velocity: 0, height: H })).toBe(false)
  })

  it('慢慢拖過高度的 35% → 關', () => {
    expect(shouldDismiss({ offset: 150, velocity: 0, height: H })).toBe(true)
    expect(shouldDismiss({ offset: 139, velocity: 0, height: H })).toBe(false)
  })

  it('只拖一點但甩得快 → 關（輕輕一甩就夠）', () => {
    expect(shouldDismiss({ offset: 30, velocity: 900, height: H })).toBe(true)
  })

  it('速度夠快但幾乎沒動（手抖／點擊）→ 不關', () => {
    expect(shouldDismiss({ offset: 4, velocity: 900, height: H })).toBe(false)
  })

  it('拖到一半再用中等速度放手：位移加上投射超過 35% → 關', () => {
    expect(shouldDismiss({ offset: 100, velocity: 600, height: H })).toBe(true) // 100 + 59 > 140
    expect(shouldDismiss({ offset: 100, velocity: 300, height: H })).toBe(false) // 100 + 30 < 140
  })

  it('往上拖或往上甩 → 永遠不關', () => {
    expect(shouldDismiss({ offset: -50, velocity: -1000, height: H })).toBe(false)
    expect(shouldDismiss({ offset: 0, velocity: -2000, height: H })).toBe(false)
  })

  it('往下拖到一半、但放手時往上甩 → 不關（承接手指的方向）', () => {
    expect(shouldDismiss({ offset: 200, velocity: -1200, height: H })).toBe(false)
  })

  it('已拖過門檻，但放手瞬間手指在往上 → 仍不關（只靠投射抵銷不到的情況）', () => {
    // 300 遠超過 140 門檻；速度只有 −100，投射才 −10，靠數字算會關；方向相反要擋下來
    expect(shouldDismiss({ offset: 300, velocity: -100, height: H })).toBe(false)
  })
})
