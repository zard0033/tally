import { describe, expect, it } from 'vitest'
import { conflicts, duplicateCheck, exactMatch, keysOf, nearMatch, normalizeKey, pickBest, recencyRank, similarity, splitSegments, type MatchFood } from './foodMatch'

const food = (id: number, name: string, vendor: string | null = null, extra: Partial<MatchFood> = {}): MatchFood => ({
  id, name, vendor, aliases: [], source: 'unknown', archived: false, ...extra,
})

describe('foodMatch', () => {
  it('正規化：全形轉半形、去空白、英文小寫', () => {
    expect(normalizeKey(' 十八燒　油雞腿飯 ')).toBe('十八燒油雞腿飯')
    expect(normalizeKey('Ｑ-Burger 蛋堡')).toBe('q-burger蛋堡')
  })

  it('切段：照標點切，不照「和」「跟」切，空段丟掉', () => {
    expect(splitSegments('十八燒油雞腿飯、茶葉蛋')).toEqual(['十八燒油雞腿飯', '茶葉蛋'])
    expect(splitSegments('雙牛堡，薯條;可樂／紅茶+蛋\n鍋貼、、')).toEqual(['雙牛堡', '薯條', '可樂', '紅茶', '蛋', '鍋貼'])
    expect(splitSegments('和風沙拉跟紅茶')).toEqual(['和風沙拉跟紅茶'])
  })

  it('比對鍵：品名、店家＋品名、別名、店家＋別名', () => {
    expect(keysOf({ name: '薯條', vendor: '麥當勞', aliases: ['中薯'] }).sort()).toEqual(['中薯', '薯條', '麥當勞中薯', '麥當勞薯條'].sort())
    expect(keysOf({ name: '茶葉蛋', vendor: null, aliases: [] })).toEqual(['茶葉蛋'])
  })

  it('完全一樣：品名、店家＋品名、別名都對得上；封存的不算', () => {
    const foods = [food(1, '油雞腿飯', '十八燒'), food(2, '薯條', '麥當勞', { aliases: ['中薯'] }), food(3, '茶葉蛋', null, { archived: true })]
    const none = new Map<number, number>()
    expect(exactMatch('十八燒 油雞腿飯', foods, none)?.id).toBe(1)
    expect(exactMatch('油雞腿飯', foods, none)?.id).toBe(1)
    expect(exactMatch('中薯', foods, none)?.id).toBe(2)
    expect(exactMatch('茶葉蛋', foods, none)).toBeNull()
    expect(exactMatch('十八燒雞腿飯', foods, none)).toBeNull()
  })

  it('同名好幾筆：最近記過的優先，都沒記過才照來源（官方＞標示＞自己填＞粗估＞未標），再平手取先建的', () => {
    const egg711 = food(17, '茶葉蛋', '7-11', { source: 'unknown' })
    const eggGov = food(134, '茶葉蛋', null, { source: 'official' })
    const egg3 = food(200, '茶葉蛋', '全家', { source: 'official' })
    // 7-11 那筆最近記過 → 壓過官方的通用版
    expect(pickBest([eggGov, egg711], new Map([[17, 3]]))?.id).toBe(17)
    expect(pickBest([eggGov, egg711], new Map([[17, 3], [134, 1]]))?.id).toBe(134)
    // 都沒記過 → 官方
    expect(pickBest([egg711, eggGov], new Map())?.id).toBe(134)
    // 同來源同沒記過 → id 小的
    expect(pickBest([egg3, eggGov], new Map())?.id).toBe(134)
    expect(pickBest([], new Map())).toBeNull()
  })

  it('最近記過的順序：照傳進來的順序，同一筆只記第一次', () => {
    expect(recencyRank([{ food_id: 5 }, { food_id: 9 }, { food_id: 5 }])).toEqual(new Map([[5, 0], [9, 1]]))
  })

  it('相似度：雙字組 Dice；短的（≥3 字）整段包含在長的裡算 0.9', () => {
    expect(similarity('十八燒雞腿飯', '十八燒油雞腿飯')).toBeCloseTo(8 / 11)
    expect(similarity('雞腿飯', '十八燒油雞腿飯')).toBe(0.9)
    expect(similarity('蛋', '蛋餅')).toBe(0)
  })

  it('互斥詞：兩邊各在同一組的左右兩側才算；左側優先（「不加糖」仍算無糖那側）', () => {
    expect(conflicts('無糖綠茶', '全糖綠茶')).toBe(true)
    expect(conflicts('炸雞腿', '烤雞腿')).toBe(true)
    expect(conflicts('全糖紅茶', '半糖紅茶')).toBe(true)
    expect(conflicts('不加糖豆漿', '無糖豆漿')).toBe(false)
    expect(conflicts('去皮雞胸', '雞胸')).toBe(false)
    expect(conflicts('炸雞腿', '水煎包')).toBe(false)
  })

  it('相近：取分數最高的一筆；完全一樣的不算、互斥詞擋掉、封存的不算、不到 0.5 不算', () => {
    const foods = [
      food(1, '油雞腿飯', '十八燒'),
      food(2, '全糖綠茶', '50嵐'),
      food(3, '烤雞腿', null),
      food(4, '無糖豆漿', null),
      food(5, '十八燒雞腿飯', null, { archived: true }),
    ]
    const none = new Map<number, number>()
    expect(nearMatch('十八燒雞腿飯', foods, none)?.id).toBe(1)
    expect(nearMatch('無糖綠茶', foods, none)).toBeNull()
    expect(nearMatch('炸雞腿', foods, none)).toBeNull()
    expect(nearMatch('不加糖豆漿', foods, none)?.id).toBe(4)
    expect(nearMatch('油雞腿飯', foods, none)).toBeNull() // 完全一樣是 exactMatch 的事
    expect(nearMatch('牛肉麵', foods, none)).toBeNull()
  })

  it('相近只比 3 個字以上的：「地瓜球」不提示「地瓜」，兩個字的句子也不提示', () => {
    const foods = [food(1, '地瓜', null), food(2, '香蕉', null)]
    expect(nearMatch('地瓜球', foods, new Map())).toBeNull()
    expect(nearMatch('香蕉', foods, new Map())).toBeNull()
  })

  describe('新增時查重', () => {
    const foods = [food(17, '茶葉蛋', '7-11'), food(39, '薯條', '麥當勞', { aliases: ['中薯'] }), food(50, '滷蛋', null), food(60, '舊的', null, { archived: true })]
    it('同店家同品名擋下（含空白、全形差異）', () => {
      expect(duplicateCheck({ name: '茶葉蛋 ', vendor: '7-11' }, foods).block?.id).toBe(17)
      expect(duplicateCheck({ name: '滷蛋', vendor: null }, foods).block?.id).toBe(50)
    })
    it('別名也算品名：新的品名撞到舊的別名、新的別名撞到舊的品名都擋', () => {
      expect(duplicateCheck({ name: '中薯', vendor: '麥當勞' }, foods).block?.id).toBe(39)
      expect(duplicateCheck({ name: '薯條（中）', vendor: '麥當勞', aliases: ['薯條'] }, foods).block?.id).toBe(39)
    })
    it('品名一樣、店家不同：只提醒', () => {
      const r = duplicateCheck({ name: '茶葉蛋', vendor: '全家' }, foods)
      expect(r.block).toBeNull()
      expect(r.note?.id).toBe(17)
    })
    it('編輯時排除自己；封存的不算；沒撞名兩個都是 null', () => {
      expect(duplicateCheck({ name: '茶葉蛋', vendor: '7-11' }, foods, 17)).toEqual({ block: null, note: null })
      expect(duplicateCheck({ name: '舊的', vendor: null }, foods)).toEqual({ block: null, note: null })
      expect(duplicateCheck({ name: '牛肉麵', vendor: null }, foods)).toEqual({ block: null, note: null })
    })
  })
})
