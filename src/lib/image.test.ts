import { describe, expect, it } from 'vitest'
import { fitWithin } from './image'

describe('fitWithin', () => {
  it('直式手機照片縮到長邊 1200（實際校準用的那張 IMG_5610）', () => {
    expect(fitWithin(2268, 4032, 1200)).toEqual({ w: 675, h: 1200 })
  })

  it('橫式照片也認長邊，不是只看高度', () => {
    expect(fitWithin(4032, 2268, 1200)).toEqual({ w: 1200, h: 675 })
  })

  it('已經比上限小就原樣回傳——不放大（放大不生細節，只讓 token 變多）', () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ w: 800, h: 600 })
  })

  it('剛好等於上限不動', () => {
    expect(fitWithin(1200, 900, 1200)).toEqual({ w: 1200, h: 900 })
  })

  it('正方形', () => {
    expect(fitWithin(3000, 3000, 1200)).toEqual({ w: 1200, h: 1200 })
  })

  it('極端長寬比：短邊四捨五入會變 0 時夾到 1，否則 canvas 會拋錯', () => {
    expect(fitWithin(4000, 3, 1200)).toEqual({ w: 1200, h: 1 })
  })
})
