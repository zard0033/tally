import { describe, expect, it } from 'vitest'
import { uuidV5 } from './uuid'

const NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

describe('uuidV5', () => {
  // 對照值全部取自 Python 的 uuid.uuid5（獨立實作），不是拿自己的輸出當答案
  it.each([
    ['python.org', '886313e1-3b8a-5372-9b90-0c9aee199e5d'],
    ['tally', 'e916defa-1404-51d2-850a-93ce0ea57871'],
    ['a'.repeat(39), '5824f981-4282-59d4-9716-acb6d741350e'], // namespace＋name＝55 位元組：補位剛好塞進同一個區塊
    ['a'.repeat(40), '39f39c20-db47-5131-8879-62f8f67f9014'], // 56 位元組：補位被擠到第二個區塊
    ['a'.repeat(100), '56596f37-716c-57a9-a735-2561f8608390'], // 多個區塊
    ['腿推舉', '223b4770-4f26-5c44-b195-57e8275c253f'], // 中文以 UTF-8 編碼
  ])('%s 與參考實作一致', (name, expected) => {
    expect(uuidV5(NAMESPACE_DNS, name)).toBe(expected)
  })

  it('同樣輸入永遠同樣輸出；不同名字、不同 namespace 輸出不同', () => {
    const a = uuidV5(NAMESPACE_DNS, 'x')
    expect(uuidV5(NAMESPACE_DNS, 'x')).toBe(a)
    expect(uuidV5(NAMESPACE_DNS, 'y')).not.toBe(a)
    expect(uuidV5('00000000-0000-0000-0000-000000000000', 'x')).not.toBe(a)
  })

  it('namespace 不是 UUID 要丟錯，不默默算出一個', () => {
    expect(() => uuidV5('not-a-uuid', 'x')).toThrow()
  })
})
