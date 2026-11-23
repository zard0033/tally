import { describe, expect, it } from 'vitest'
import { applyMods, calcLineOf, groupsFor, normalizeMods, noodleGramsOf, riceGramsOf, suffixOf, summaryOf, toggleMod } from './portionMods'

const drink = { name: '手搖飲（無糖純茶＋珍珠，大杯）', category: '飲料' }
const pearlTea = { kcal: 165, protein: 0, fat: 0, carb: 41 }
const bento = { name: '排骨便當（滷）', category: '便當' }
const bentoM = { kcal: 858, protein: 33.8, fat: 25.8, carb: 119.5 }

describe('groupsFor', () => {
  it('飲料＝杯型、甜度、配料；便當與丼飯類＝飯量；品名有麵的麵食＝麵量；雞腿雞排鴨鵝＝去皮', () => {
    expect(groupsFor(drink)).toEqual(['cup', 'sweet', 'top'])
    expect(groupsFor(bento)).toEqual(['rice'])
    expect(groupsFor({ name: '滷肉飯', category: '丼飯類' })).toEqual(['rice'])
    expect(groupsFor({ name: '牛肉烏龍麵', category: '麵食' })).toEqual(['noodle'])
    expect(groupsFor({ name: '水餃（10顆）', category: '麵食' })).toEqual([])
    expect(groupsFor({ name: '滷雞腿便當', category: '便當' })).toEqual(['rice', 'skin'])
    expect(groupsFor({ name: '燒鴨腿便當', category: '便當' })).toEqual(['rice', 'skin'])
    // 健康餐盒整類出加主菜；品名含雞腿的同時出去皮
    expect(groupsFor({ name: '雞胸餐盒', category: '健康餐盒' })).toEqual(['main'])
    expect(groupsFor({ name: '雞腿餐盒', category: '健康餐盒' })).toEqual(['main', 'skin'])
    // review：鴨血不是帶皮的部位；壽司歸丼飯類但沒有可減的白飯
    expect(groupsFor({ name: '麻辣鴨血臭豆腐', category: '其他正餐' })).toEqual([])
    expect(groupsFor({ name: '鴨肉飯', category: '丼飯類' })).toEqual(['rice', 'skin'])
    expect(groupsFor({ name: '壽司', category: '丼飯類' })).toEqual([])
    expect(groupsFor({ name: '乳清', category: null })).toEqual([])
  })
})

describe('normalizeMods／toggleMod', () => {
  it('清掉不認得與不適用的、單選組只留最後一個、照固定順序', () => {
    expect(normalizeMods(['sweet:half', 'x', 'rice:half', 'cup:m', 'sweet:slight', 'top:pearl', 'top:pearl'], drink)).toEqual(['cup:m', 'sweet:slight', 'top:pearl'])
    expect(normalizeMods([1, null, 'rice:none'], bento)).toEqual(['rice:none'])
  })
  it('單選組按同一顆取消、按別顆換；配料可複選', () => {
    expect(toggleMod(['sweet:half'], 'sweet:half', drink)).toEqual([])
    expect(toggleMod(['sweet:half'], 'sweet:slight', drink)).toEqual(['sweet:slight'])
    expect(toggleMod(['top:pearl'], 'top:jelly', drink)).toEqual(['top:pearl', 'top:jelly'])
  })
})

describe('applyMods', () => {
  it('AC1：珍珠純茶 中杯＋微糖＝165×0.7＋微糖 11.025 g', () => {
    const { result } = applyMods(pearlTea, ['cup:m', 'sweet:slight'], drink)
    expect(result).toEqual({ kcal: 159.6, protein: 0, fat: 0, carb: 39.7 })
  })
  it('AC2：配料不隨中杯縮', () => {
    const { result } = applyMods({ kcal: 0, protein: 0, fat: 0, carb: 0 }, ['cup:m', 'top:pearl'], { name: '無糖純茶', category: '飲料' })
    expect(result.kcal).toBe(165)
  })
  it('大杯全糖＝加 45 g 糖', () => {
    expect(applyMods(pearlTea, ['sweet:full'], drink).result).toMatchObject({ kcal: 345, carb: 86 })
  })
  it('AC3：排骨便當半飯扣 125 g 白飯（228.75 卡）', () => {
    expect(riceGramsOf(bentoM)).toBe(250)
    const { result } = applyMods(bentoM, ['rice:half'], bento)
    expect(result.kcal).toBe(629.3)
    expect(result.carb).toBe(68.3)
  })
  it('AC3：丼飯類碳水 70 g 的滷肉飯，白飯＝70÷0.41 克，半飯扣一半', () => {
    const lu = { kcal: 500, protein: 15, fat: 17, carb: 70 }
    expect(riceGramsOf(lu)).toBeCloseTo(170.73, 2)
    expect(applyMods(lu, ['rice:half'], { name: '滷肉飯', category: '丼飯類' }).result.carb).toBe(35)
  })
  it('不要飯不會減到負數', () => {
    expect(applyMods({ kcal: 100, protein: 1, fat: 1, carb: 80 }, ['rice:none'], bento).result).toEqual({ kcal: 0, protein: 0, fat: 0.4, carb: 0 })
  })
  it('麵少扣 1/3、加麵加 1/2；熟麵最多 300 g', () => {
    const beef = { kcal: 600, protein: 30, fat: 20, carb: 80 }
    const f = { name: '牛肉麵', category: '麵食' }
    expect(noodleGramsOf(beef)).toBe(300)
    expect(applyMods(beef, ['noodle:less'], f).result.kcal).toBe(483)
    expect(applyMods(beef, ['noodle:more'], f).result.kcal).toBe(775.5)
  })
  it('去皮 −80 卡、−1.5 蛋白質、−8 脂肪', () => {
    expect(applyMods({ kcal: 848, protein: 39.8, fat: 25.8, carb: 111.5 }, ['skin:off'], { name: '滷雞腿便當', category: '便當' }).result).toEqual({ kcal: 768, protein: 38.3, fat: 17.8, carb: 111.5 })
  })
  it('沒按任何鈕＝原值', () => {
    expect(applyMods(bentoM, [], bento).result).toEqual(bentoM)
  })
})

describe('健康餐盒加主菜', () => {
  const box = { name: '雞胸餐盒', category: '健康餐盒' }
  const boxM = { kcal: 610, protein: 45, fat: 14, carb: 78 }
  it('AC1：壯壯雞胸餐盒＋雞胸＝727／68.3／15.9／78.6，後綴（＋雞胸）', () => {
    expect(applyMods(boxM, ['main:chicken'], box).result).toEqual({ kcal: 727, protein: 68.3, fat: 15.9, carb: 78.6 })
    expect(suffixOf(['main:chicken'], box)).toBe('（＋雞胸）')
  })
  it('AC2：可複選，牛肉＋鯛魚兩份都加；同一顆不重複', () => {
    expect(normalizeMods(['main:fish', 'main:beef', 'main:beef'], box)).toEqual(['main:beef', 'main:fish'])
    expect(applyMods(boxM, ['main:beef', 'main:fish'], box).result).toEqual({ kcal: 879, protein: 88.2, fat: 23.3, carb: 79.3 })
    expect(toggleMod(['main:beef'], 'main:fish', box)).toEqual(['main:beef', 'main:fish'])
    expect(toggleMod(['main:beef', 'main:fish'], 'main:beef', box)).toEqual(['main:fish'])
  })
  it('AC3：非健康餐盒不出、存了也清掉', () => {
    expect(normalizeMods(['main:chicken'], bento)).toEqual([])
    expect(normalizeMods(['main:egg'], drink)).toEqual([])
  })
  it('雞腿 150 g、鮭魚 120 g、蛋一顆、豬用小里肌', () => {
    const z = { kcal: 0, protein: 0, fat: 0, carb: 0 }
    expect(applyMods(z, ['main:thigh'], box).result).toEqual({ kcal: 247.5, protein: 29.7, fat: 13.4, carb: 0 })
    expect(applyMods(z, ['main:salmon'], box).result).toEqual({ kcal: 208.8, protein: 24.8, fat: 11.4, carb: 0 })
    expect(applyMods(z, ['main:egg'], box).result).toEqual({ kcal: 79, protein: 7.7, fat: 5.1, carb: 0.9 })
    expect(applyMods(z, ['main:pork'], box).result).toEqual({ kcal: 139, protein: 21.1, fat: 5.4, carb: 0 })
  })
  it('摘要與算式；跟去皮並存', () => {
    expect(summaryOf([], box)).toBe('沒加主菜')
    expect(summaryOf(['main:chicken', 'main:egg'], box)).toBe('＋雞胸・＋蛋')
    expect(calcLineOf(boxM, ['main:chicken'], box)).toBe('610 ＋ 雞胸 117 ＝ 727 卡')
    const thighBox = { name: '雞腿餐盒', category: '健康餐盒' }
    expect(summaryOf(['skin:off'], thighBox)).toBe('沒加主菜・去皮')
    expect(suffixOf(['main:beef', 'skin:off'], thighBox)).toBe('（＋牛肉・去皮）')
  })
})

describe('文字', () => {
  it('摘要永遠寫現在狀態', () => {
    expect(summaryOf([], drink)).toBe('大杯・無糖')
    expect(summaryOf(['cup:m', 'sweet:slight', 'top:jelly'], drink)).toBe('中杯・微糖・＋寒天')
    expect(summaryOf([], bento)).toBe('正常飯量')
    expect(summaryOf(['rice:half'], bento)).toBe('半飯')
    expect(summaryOf(['skin:off'], { name: '滷雞腿便當', category: '便當' })).toBe('正常飯量・去皮')
    expect(summaryOf([], { name: '牛肉麵', category: '麵食' })).toBe('正常麵量')
  })
  it('品名後綴只寫有調的', () => {
    expect(suffixOf([], drink)).toBe('')
    expect(suffixOf(['cup:m', 'sweet:slight', 'top:pearl'], drink)).toBe('（中杯・微糖・＋珍珠）')
  })
  it('算式', () => {
    expect(calcLineOf(pearlTea, ['cup:m', 'sweet:slight'], drink)).toBe('165 × 0.7 ＋ 微糖 11 g ＝ 160 卡')
    expect(calcLineOf(bentoM, ['rice:half'], bento)).toBe('858 − 半飯 229 ＝ 629 卡')
    expect(calcLineOf(bentoM, [], bento)).toBe(null)
  })
})
