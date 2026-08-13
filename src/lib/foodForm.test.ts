import { describe, expect, it } from 'vitest'
import { readingToForm, type LabelReading } from './foodForm'

/** 校準階段那張伯朗奶茶隨身包的真實讀數（spec.md「接縫」節）。 */
const BROWN: LabelReading = {
  name: '伯朗奶茶-減糖香濃原味(三合一)',
  basis: 'per_serving',
  serving_g: 17,
  kcal: 82,
  protein_g: 0.4,
  fat_g: 3.6,
  carb_g: 12.1,
}

describe('readingToForm', () => {
  it('每份＋有公克數 → 品名接上「（每份 17g）」', () => {
    expect(readingToForm(BROWN)).toEqual({
      name: '伯朗奶茶-減糖香濃原味(三合一)（每份 17g）',
      kcal: '82',
      protein: '0.4',
      fat: '3.6',
      carb: '12.1',
    })
  })

  it('每份但標示沒印公克數 → 只寫「（每份）」，不用兩欄比值回推', () => {
    expect(readingToForm({ ...BROWN, serving_g: null }).name)
      .toBe('伯朗奶茶-減糖香濃原味(三合一)（每份）')
  })

  it('讀的是每 100 公克那欄 → 標籤要說清楚，否則 82 大卡是一份還是一百克無從得知', () => {
    expect(readingToForm({ ...BROWN, basis: 'per_100g', serving_g: null }).name)
      .toBe('伯朗奶茶-減糖香濃原味(三合一)（每100克）')
  })

  it('品名讀不到 → 只留括號，使用者在前面補打（比整欄留白好用）', () => {
    expect(readingToForm({ ...BROWN, name: null }).name).toBe('（每份 17g）')
  })

  it('不碰店家——標示上沒有店家，那欄是使用者自己的分類', () => {
    expect(readingToForm(BROWN)).not.toHaveProperty('vendor')
  })

  it('數字一律轉成字串（表單欄位吃的是字串）', () => {
    const f = readingToForm({ ...BROWN, kcal: 559.1, protein_g: 0, fat_g: 25.1, carb_g: 70.8 })
    expect([f.kcal, f.protein, f.fat, f.carb]).toEqual(['559.1', '0', '25.1', '70.8'])
  })
})
