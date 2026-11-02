import { describe, expect, it } from 'vitest'
import { clampReleaseVelocity, shouldOpenSwipe } from './swipePhysics'

describe('shouldOpenSwipe', () => {
  it('位移超過 24 才算開啟，剛好 24 不算', () => {
    expect(shouldOpenSwipe(-25, 0)).toBe(true)
    expect(shouldOpenSwipe(-24, 0)).toBe(false)
    expect(shouldOpenSwipe(-12, 0)).toBe(false)
  })

  it('速度超過 320 往左甩，只要有動就開', () => {
    expect(shouldOpenSwipe(-1, -321)).toBe(true)
    expect(shouldOpenSwipe(-1, -320)).toBe(false)
  })

  it('列沒動時速度再快都不開：那是縱向甩動的雜訊', () => {
    expect(shouldOpenSwipe(0, -1000)).toBe(false)
  })
})

describe('clampReleaseVelocity', () => {
  it('兩個方向都夾在 1500 內，範圍內不動', () => {
    expect(clampReleaseVelocity(-3000)).toBe(-1500)
    expect(clampReleaseVelocity(3000)).toBe(1500)
    expect(clampReleaseVelocity(-800)).toBe(-800)
  })
})
