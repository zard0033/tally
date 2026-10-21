/* 肌群狀態回前景重取「現在」（Analysis.tsx 的 RecoveryList）。
   獨立成檔：`page.clock` 會接管整頁計時器，放進 analysis.spec.ts 會干擾那邊不接管時鐘的其他條。
   時鐘照常流動地裝上、要跳時間用 `setFixedTime`（只改 Date.now；理由見 rest-timer.spec.ts 開頭，不用 fastForward）。
   資料：肩膀（窗口 24 小時）今天、3 組、結束 12 小時前 → 開頁時恢復中、還需約 12 小時；
   把現在撥快 13 小時並觸發 visibilitychange 後 → 可再練（沒有事件時畫面不動）。 */
import { test, expect } from '@playwright/test'
import { FIX, TODAY } from './fixtures'
import { openApp } from './harness'

const HOUR = 3600_000
const SH = 'bbbbbbbb-0000-4000-8000-000000000005'

function shoulderFix(): typeof FIX {
  const now = Date.now()
  return {
    ...FIX,
    exercises: [{ id: SH, name: '肩推', muscle_group: 'shoulder', tips: null, archived: false, created_at: '2026-10-01T00:00:00.000Z' }],
    workouts: [{
      id: 'r3', performed_on: TODAY, started_at: new Date(now - 13 * HOUR).toISOString(),
      ended_at: new Date(now - 12 * HOUR).toISOString(), routine_id: null,
    }],
    workout_exercises: [{ id: 'r3-e0', workout_id: 'r3', exercise_id: SH, position: 0 }],
    workout_sets: [1, 2, 3].map((n) => ({ id: `r3-s${n}`, workout_exercise_id: 'r3-e0', set_no: n, weight_kg: 50, reps: 8, done: true })),
  }
}

test('肌群狀態：回到前景（visibilitychange）重取現在，恢復中變可再練；還在背景時不動', async ({ page }) => {
  await page.clock.install({ time: Date.now() })
  await openApp(page, {}, shoulderFix())
  await page.locator('.tab[aria-label="訓練"]').click()
  await page.locator('[data-action="open-analysis"]').click()
  await page.locator('.seg button', { hasText: '肌群狀態' }).click()
  const shoulder = page.locator('[data-section="recovery-list"] .tr-row[data-group="shoulder"]')
  await expect(shoulder).toHaveAttribute('data-state', 'recovering')
  await expect(shoulder.locator('.an-state')).toContainText('12')

  // 時間過了 13 小時，但沒有回前景的事件：畫面仍是舊的
  const p = await page.evaluate(() => Date.now())
  await page.clock.setFixedTime(p + 13 * HOUR)
  await page.waitForTimeout(400)
  await expect(shoulder, '沒有 visibilitychange，不該自己更新').toHaveAttribute('data-state', 'recovering')

  // 回到前景：重算
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(shoulder).toHaveAttribute('data-state', 'ready')
  await expect(shoulder.locator('.an-state')).toHaveText('可再練')
})
