/* 迴歸鎖：某餐刪到剩最後一筆時，退場動畫要真的跑，不能整段被同一個 render 卸載。
   2026-07-31 修好前的壞法：items.length 一到 0，MealNode 的 done 立刻翻假，
   AnimatePresence 連機會都沒有，.item 直接消失、.todo-row 瞬間出現。 */
import { test, expect } from '@playwright/test'
import { grabPoint, leg, openApp, slowDrag } from './harness'

test('某餐最後一筆刪除——退場動畫要跑完才切成待記錄，不能瞬間跳過去', async ({ page }) => {
  await openApp(page)
  // fixture 裡 breakfast（id 101）本來就是該餐唯一一筆
  const g = await grabPoint(page)
  await slowDrag(page, g, leg(g, { x: g.x - 90, y: g.y }))
  await page.waitForTimeout(300)
  await page.locator('.item-delete').first().click()

  const breakfastNode = page.locator('.node').first()
  const item = page.locator('.item[data-row="101"]')

  // 剛點完的當下（快照，不能用會重試的 expect）：那一列還在 DOM 裡淡出，
  // 還不該已經切成「待記錄」——這正是壞掉時會落空的斷言。
  expect(await item.count(), '點下刪除的瞬間，那一列應該還在淡出，不該已經被整段卸載').toBe(1)
  expect(await breakfastNode.locator('.todo-row').count(), '這個當下不該已經切成待記錄').toBe(0)

  // 退場動畫（DUR.mid=220ms）跑完之後才切過去
  await expect(breakfastNode.locator('.todo-row')).toHaveCount(1, { timeout: 2000 })
  await expect(item).toHaveCount(0)
})
