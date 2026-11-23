import { describe, expect, it } from 'vitest'
import { BLANK_FOOD_FORM, MACRO_MAX, NO_VENDOR, addAliases, aliasHit, byFoodName, foodMatches, foodToForm, groupByVendor, readingToForm, validateFoodForm, type LabelReading } from './foodForm'

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
      verified: true,
    })
  })

  it('不碰別名——重拍一張標示不該洗掉使用者加的別名', () => {
    expect(readingToForm(BROWN)).not.toHaveProperty('aliases')
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

describe('foodMatches', () => {
  const f = { name: '雞胸餐盒', vendor: 'Ａ店' }
  it('空字串與空白全部命中', () => {
    expect(foodMatches(f, '')).toBe(true)
    expect(foodMatches(f, '   ')).toBe(true)
  })
  it('比對品名與店家，不分大小寫', () => {
    expect(foodMatches(f, '餐盒')).toBe(true)
    expect(foodMatches({ name: 'Latte', vendor: 'Cafe' }, 'cAFe')).toBe(true)
    expect(foodMatches(f, '牛排')).toBe(false)
  })
  it('沒有店家時只比品名', () => {
    expect(foodMatches({ name: '雞胸餐盒', vendor: null }, 'a店')).toBe(false)
  })
  it('也比對別名：「中薯」找得到「麥當勞薯條（中）」；沒帶別名（舊呼叫端）照舊', () => {
    expect(foodMatches({ name: '麥當勞薯條（中）', vendor: '麥當勞', aliases: ['中薯', 'Fries'] }, '中薯')).toBe(true)
    expect(foodMatches({ name: '麥當勞薯條（中）', vendor: '麥當勞', aliases: ['中薯', 'Fries'] }, 'fries')).toBe(true)
    expect(foodMatches({ name: '麥當勞薯條（中）', vendor: '麥當勞', aliases: [] }, '中薯')).toBe(false)
  })
})

describe('addAliases', () => {
  it('照頓號、逗號切開，去空白、去重、丟掉空的，不跟已有的重複', () => {
    expect(addAliases(['中薯'], ' 薯條、中薯，,Fries ')).toEqual(['中薯', '薯條', 'Fries'])
  })
  it('空字串不加；不改動傳進來的陣列', () => {
    const cur = ['a']
    expect(addAliases(cur, '  ')).toEqual(['a'])
    addAliases(cur, 'b')
    expect(cur).toEqual(['a'])
  })
})

describe('foodToForm', () => {
  it('來源、別名帶進表單', () => {
    const f = { name: 'x', vendor: null, kcal: 1, protein: 2, fat: 3, carb: 4, verified: false, aliases: ['y'] }
    expect(foodToForm(f)).toMatchObject({ verified: false, aliases: ['y'] })
    expect(foodToForm({ ...f, verified: true }).verified).toBe(true)
  })
})

describe('aliasHit', () => {
  const tea = { name: '手搖飲（無糖純茶＋寒天，大杯）', vendor: null, aliases: ['紅萱波波', '麻古 紅萱波波'] }
  it('只靠別名對上才回別名；品名或店家對上就不回', () => {
    expect(aliasHit(tea, '麻古')).toBe('麻古 紅萱波波')
    expect(aliasHit(tea, '紅萱')).toBe('紅萱波波')
    expect(aliasHit(tea, '寒天')).toBe(null)
    expect(aliasHit({ ...tea, vendor: '麻古' }, '麻古')).toBe(null)
    expect(aliasHit(tea, ' ')).toBe(null)
    expect(aliasHit(tea, '珍珠')).toBe(null)
  })
})

describe('byFoodName', () => {
  it('同名回 0，不同名依 zh-Hant 排序', () => {
    expect(byFoodName({ name: '雞胸' }, { name: '雞胸' })).toBe(0)
    // 碼位順序「三」在「八」前面，筆畫順序相反：拿掉 zh-Hant 這條就會紅
    const sorted = [{ name: '三商' }, { name: '八方' }].sort(byFoodName)
    expect(sorted.map((x) => x.name)).toEqual(['八方', '三商'])
  })
})

describe('groupByVendor', () => {
  const f = (name: string, vendor: string | null) => ({ name, vendor })
  it('NO_VENDOR 就是畫面上的「通用（不分店家）」', () => {
    expect(NO_VENDOR).toBe('通用（不分店家）')
  })
  it('店家照筆畫序（八方 2 畫在三商 3 畫前，與碼位序相反）、未標店家固定最後，組內依品名', () => {
    const groups = groupByVendor([f('e', '三商'), f('b', null), f('d', '八方'), f('a', null), f('c', '三商')])
    expect(groups.map((g) => g.vendor)).toEqual(['八方', '三商', NO_VENDOR])
    expect(groups.map((g) => g.items.map((x) => x.name))).toEqual([['d'], ['c', 'e'], ['a', 'b']])
  })
  it('只有未標店家 → 一組；空清單 → 沒有組', () => {
    expect(groupByVendor([f('a', null)])).toEqual([{ vendor: NO_VENDOR, items: [f('a', null)] }])
    expect(groupByVendor([])).toEqual([])
  })
  it('不改動傳進來的陣列', () => {
    const list = [f('b', null), f('a', null)]
    groupByVendor(list)
    expect(list.map((x) => x.name)).toEqual(['b', 'a'])
  })
})

describe('validateFoodForm', () => {
  const ok = { ...BLANK_FOOD_FORM, name: '雞胸', kcal: '120', protein: '25' }

  it('品名與熱量必填，營養素留空當 0', () => {
    expect(validateFoodForm(ok)).toEqual({
      food: { name: '雞胸', vendor: null, kcal: 120, protein: 25, fat: 0, carb: 0, verified: true, aliases: [] },
    })
    expect(validateFoodForm({ ...ok, name: ' ' })).toEqual({ error: '品名要填' })
    expect(validateFoodForm({ ...ok, kcal: '' })).toEqual({ error: '熱量要填數字' })
    expect(validateFoodForm({ ...ok, kcal: '-1' })).toEqual({ error: '熱量要填數字' })
    expect(validateFoodForm({ ...ok, fat: 'x' })).toEqual({ error: '營養素要填數字或留空' })
  })

  it('上界對齊 DB 的 numeric(6,2)（9999.99）：剛好在界上可以，多一點就擋在送出前', () => {
    expect(MACRO_MAX).toBe(9999.99)
    expect('food' in validateFoodForm({ ...ok, kcal: '9999.99', protein: '9999.99', fat: '9999.99', carb: '9999.99' })).toBe(true)
    expect(validateFoodForm({ ...ok, kcal: '10000' })).toEqual({ error: '熱量要填 0 到 9999.99 之間的數字' })
    for (const key of ['protein', 'fat', 'carb'] as const) {
      expect(validateFoodForm({ ...ok, [key]: '10000' })).toEqual({ error: '營養素要填 0 到 9999.99 之間的數字或留空' })
    }
  })

  describe('來源', () => {
    const src = (f: typeof ok) => {
      const v = validateFoodForm(f)
      return 'food' in v ? v.food.verified : v.error
    }
    it('新增預設官方標示；拍標示讀進來也是官方標示', () => {
      expect(src(ok)).toBe(true)
      expect(src({ ...BLANK_FOOD_FORM, ...readingToForm(BROWN) })).toBe(true)
    })
    it('照表單選的，改數字不自動變（編輯舊食物）', () => {
      expect(src({ ...ok, verified: false, kcal: '999' })).toBe(false)
      expect(src({ ...ok, verified: true, kcal: '999' })).toBe(true)
    })
  })

  describe('別名', () => {
    it('別名去空白去重；超過 10 個或單個超過 40 字擋下', () => {
      const v = validateFoodForm({ ...ok, aliases: [' 中薯 ', '中薯', '薯條'] })
      expect('food' in v && v.food.aliases).toEqual(['中薯', '薯條'])
      expect(validateFoodForm({ ...ok, aliases: Array.from({ length: 11 }, (_, i) => `a${i}`) })).toEqual({ error: '別名最多 10 個' })
      expect('food' in validateFoodForm({ ...ok, aliases: ['字'.repeat(40)] })).toBe(true)
      expect(validateFoodForm({ ...ok, aliases: ['字'.repeat(41)] })).toEqual({ error: '每個別名最多 40 個字' })
    })
  })
})
