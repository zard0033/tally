/* 三大營養素那排的左右邊界必須跟上方的熱量欄位切齊。
   會有這條，是因為它真的壞過：那排的動效掛勾第一版取名 `macros`，跟首頁那排營養素
   （Today.tsx 的 `.macros`，帶 `padding: 0 var(--s-5) var(--s-4)`）撞名，白吃了人家的左右內距，
   表單這排憑空內縮——**型別、lint、97 條單元測試、76 條 e2e 全綠，是使用者用實機看出來的**。

   所以這條鎖的不是「class 叫什麼」而是「有沒有對齊」：量兩個元素的實際 rect。
   下次再有人取一個撞名的 class、或替 `.field-row` 加上不該加的內距，這裡會紅。 */
import { test, expect } from '@playwright/test'
import { openApp } from './harness'

test('新增食物表單：三大營養素那排與熱量欄位左右切齊', async ({ page }) => {
  await openApp(page)
  await page.locator('.tab[aria-label="設定"]').click()
  await page.locator('.entry-row', { hasText: '食品庫管理' }).click()
  await page.locator('.lib-fab[aria-label="新增食物"]').click()

  const kcal = page.locator('.form-lock > .field-float').first()
  const macros = page.locator('.form-lock .form-macros')
  await expect(macros).toBeVisible()

  const a = (await kcal.boundingBox())!
  const b = (await macros.boundingBox())!
  // 容差 1px：留給 devicePixelRatio 的次像素捨入，擋不住任何真的內距（最小的 --s-4 也有 12px）。
  expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(b.x + b.width - (a.x + a.width))).toBeLessThanOrEqual(1)
})
