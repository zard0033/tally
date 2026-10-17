import { describe, expect, it } from 'vitest'
import { EXERCISE_CATALOG, EXTRA_EXERCISES, autoSeedOps, catalogInsertOps, catalogKey, catalogToAdd, glyphOf } from './exerciseCatalog'
import { MUSCLE_GROUPS, PRESET_EXERCISES, foldName, presetExerciseId, type Row } from './training'

// 不引入 node 模組（tsconfig 只有 vite/client 型別）：用 Vite 的 glob 讀圖——`?inline` 給 base64 data URI，可以算大小、驗檔頭
const images = import.meta.glob<string>('../assets/exercises/*.webp', { eager: true, query: '?inline', import: 'default' })
const imageMap = Object.values(
  import.meta.glob<Record<string, string>>('../../scripts/exercise-images.json', { eager: true, import: 'default' }),
)[0]
/** 該帳號原始的 16 個預設動作（App 自己預填過的樣子）。 */
const coreRows = (u: string): Row[] =>
  PRESET_EXERCISES.map((p) => ({ id: presetExerciseId(u, p.key), user_id: u, name: p.name, muscle_group: p.muscle_group, tips: null, archived: false }))
const fileKey = (path: string) => path.replace(/^.*\//, '').replace(/\.webp$/, '')
/** data URI → 位元組數與前 12 個位元組（latin1 字串） */
function inspect(dataUri: string) {
  const bin = atob(dataUri.slice(dataUri.indexOf(',') + 1))
  return { size: bin.length, head: bin.slice(0, 12) }
}

describe('動作目錄', () => {
  it('既有 16 個預填動作原封不動（歷史資料靠它們的 key 與 id）', () => {
    expect(PRESET_EXERCISES.map((p) => `${p.key}|${p.name}|${p.muscle_group}`)).toEqual([
      'leg-press|腿推舉|legs',
      'leg-extension|腿屈伸|legs',
      'leg-curl|腿彎舉|legs',
      'calf-raise|小腿提踵|legs',
      'hip-abduction|髖外展|legs',
      'hip-adduction|髖內收|legs',
      'lat-pulldown|滑輪下拉|back',
      'seated-row|坐姿划船|back',
      'back-extension|背伸展機|back',
      'chest-press|坐姿胸推|chest',
      'pec-fly|蝴蝶機夾胸|chest',
      'shoulder-press|肩推|shoulder',
      'reverse-fly|反向蝴蝶機|shoulder',
      'biceps-curl|二頭彎舉（機械）|arms',
      'triceps-pushdown|三頭下壓（滑輪）|arms',
      'ab-crunch|腹部捲曲機|core',
    ])
    expect(EXERCISE_CATALOG.slice(0, 16)).toEqual(PRESET_EXERCISES)
  })

  it('150 個：key 是 kebab-case 且不重複、名稱不重複、肌群都在七類且每類都有', () => {
    expect(EXERCISE_CATALOG).toHaveLength(150)
    expect(EXTRA_EXERCISES).toHaveLength(134)
    const keys = EXERCISE_CATALOG.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    // 用與 checkExercise 相同的 foldName 比：全形半形、大小寫、空白不同但視為同名的也算重複
    const names = EXERCISE_CATALOG.map((p) => foldName(p.name))
    expect(new Set(names).size).toBe(names.length)
    for (const p of EXERCISE_CATALOG) expect(MUSCLE_GROUPS).toContain(p.muscle_group)
    for (const g of MUSCLE_GROUPS) expect(EXERCISE_CATALOG.some((p) => p.muscle_group === g)).toBe(true)
  })

  it('要點一律留空：目錄不替使用者寫動作要領', () => {
    for (const r of catalogToAdd('u1', [])) expect(r.tips).toBeNull()
  })
})

describe('示意圖檔案', () => {
  it('目錄裡每個動作都有圖、也都在對照表裡；沒有多餘的圖或對照', () => {
    const keys = EXERCISE_CATALOG.map((p) => p.key).sort()
    expect(Object.keys(imageMap).sort()).toEqual(keys)
    expect(Object.keys(images).map(fileKey).sort()).toEqual(keys)
  })

  it('圖是真的 webp、每張 ≤ 20KB（離線 precache 的預算）', () => {
    for (const [path, uri] of Object.entries(images)) {
      const { size, head } = inspect(uri)
      expect(size, fileKey(path)).toBeLessThanOrEqual(20 * 1024)
      expect(head.slice(0, 4), fileKey(path)).toBe('RIFF')
      expect(head.slice(8, 12), fileKey(path)).toBe('WEBP')
    }
  })

  it('對照表的資料集 id 不重複（一個動作一張自己的圖）', () => {
    const ids = Object.values(imageMap)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('catalogKey（由列反推是哪個預設動作）', () => {
  const row = (userId: string, key: string, extra: Record<string, unknown> = {}): Row => ({
    id: presetExerciseId(userId, key),
    user_id: userId,
    name: 'x',
    ...extra,
  })

  it('預設動作的列回它的 key；改名、封存、寫了要點都不影響', () => {
    expect(catalogKey(row('u1', 'leg-press'))).toBe('leg-press')
    expect(catalogKey(row('u1', 'barbell-squat', { name: '我的深蹲', archived: true, tips: '腳尖外開' }))).toBe('barbell-squat')
  })

  it('使用者自建的動作、缺 user_id 的列、別的帳號的 id 都回 null', () => {
    expect(catalogKey({ id: '11111111-1111-4111-8111-111111111111', user_id: 'u1', name: '自建' })).toBeNull()
    expect(catalogKey({ id: presetExerciseId('u1', 'leg-press'), name: 'x' })).toBeNull()
    // id 是 u1 算出來的，列卻說自己屬於 u2：對不上
    expect(catalogKey({ id: presetExerciseId('u1', 'leg-press'), user_id: 'u2', name: 'x' })).toBeNull()
  })

  it('id 的演算法鎖死：字面值取自 Python 的 uuid.uuid5（獨立實作），namespace 或組字格式一改就紅', () => {
    // 這串 id 同時決定「預填會不會重複」與「圖對不對得上」：改了它，既有帳號的 150 張圖會悄悄退成肌群單字
    const u = '00000000-0000-0000-0000-000000000001'
    expect(presetExerciseId(u, 'leg-press')).toBe('b560053d-4662-5165-9b70-01896120fc1e')
    expect(presetExerciseId(u, 'barbell-squat')).toBe('54a8d7cc-c000-5491-a958-7c4747688023')
    expect(presetExerciseId(u, 'ab-crunch')).toBe('0fe71eb6-1255-5cce-87cc-aeef1b7c16c9')
    expect(catalogKey({ id: 'b560053d-4662-5165-9b70-01896120fc1e', user_id: u, name: 'x' })).toBe('leg-press')
  })

  it('目錄裡 150 個 id 對同一個帳號都不撞', () => {
    const ids = EXERCISE_CATALOG.map((p) => presetExerciseId('u1', p.key))
    expect(new Set(ids).size).toBe(150)
  })
})

describe('catalogToAdd（補齊預設動作）', () => {
  it('一個都沒有：補全部 150 個，且內容與目錄一致', () => {
    const rows = catalogToAdd('u1', [])
    expect(rows).toHaveLength(150)
    expect(rows[0]).toMatchObject({ name: '腿推舉', muscle_group: 'legs', user_id: 'u1', archived: false })
    expect(rows.map((r) => r.id)).toEqual(EXERCISE_CATALOG.map((p) => presetExerciseId('u1', p.key)))
  })

  it('已經預填過 16 個：只補其餘 134 個', () => {
    const have = coreRows('u1')
    const rows = catalogToAdd('u1', have)
    expect(rows).toHaveLength(134)
    expect(rows.map((r) => r.id)).toEqual(EXTRA_EXERCISES.map((p) => presetExerciseId('u1', p.key)))
  })

  it('使用者改過名、封存過的預設動作算「已有」，不會被補回預設值', () => {
    const edited: Row = { id: presetExerciseId('u1', 'leg-press'), user_id: 'u1', name: '我的腿推', archived: true }
    const rows = catalogToAdd('u1', [edited])
    expect(rows.map((r) => r.id)).not.toContain(edited.id)
    expect(rows).toHaveLength(149)
  })

  it('補完再補一次是空的（冪等）；自建的、名稱不撞的動作不影響補齊', () => {
    const custom: Row = { id: 'custom-1', user_id: 'u1', name: '我的自建動作' }
    const first = catalogToAdd('u1', [custom])
    expect(first).toHaveLength(150)
    expect(catalogToAdd('u1', [custom, ...first])).toEqual([])
  })

  it('名稱與既有動作重複的不補（checkExercise 禁止同名，補進去之後兩列都存不了，而且動作不能真刪）', () => {
    const custom: Row = { id: 'custom-1', user_id: 'u1', name: '槓鈴臥推' }
    const rows = catalogToAdd('u1', [custom])
    expect(rows).toHaveLength(149)
    expect(rows.map((r) => r.name)).not.toContain('槓鈴臥推')
    // 比對規則同 checkExercise：全形半形、大小寫、空白不同也算同名
    expect(catalogToAdd('u1', [{ id: 'c2', user_id: 'u1', name: '  ｅｚ  槓彎舉 ' }]).map((r) => r.name)).not.toContain('EZ 槓彎舉')
    // 已封存的同名也算（checkExercise 連封存的都比）
    expect(catalogToAdd('u1', [{ id: 'c3', user_id: 'u1', name: '棒式', archived: true }]).map((r) => r.name)).not.toContain('棒式')
  })

  it('預設動作被改名成目錄裡別的動作的名字：那個目錄項目不補，被改名的那列自己因 id 已在也不補', () => {
    const renamed: Row = { id: presetExerciseId('u1', 'leg-press'), user_id: 'u1', name: '槓鈴深蹲' }
    const names = catalogToAdd('u1', [renamed]).map((r) => r.name)
    expect(names).not.toContain('槓鈴深蹲') // 名稱被佔了
    expect(names).not.toContain('腿推舉') // 它自己的 id 已在
    expect(names).toHaveLength(148)
  })

  it('id 含 userId：兩個帳號補出來的 id 完全不撞', () => {
    const a = catalogToAdd('u1', []).map((r) => r.id)
    const b = catalogToAdd('u2', []).map((r) => r.id)
    expect(new Set([...a, ...b]).size).toBe(300)
  })
})

describe('catalogInsertOps', () => {
  it('每個缺的一筆 insert 進 exercises，一律 ignoreDuplicates（本機底過期時不能蓋掉伺服器上改過的列）', () => {
    const ops = catalogInsertOps('u1', coreRows('u1'))
    expect(ops).toHaveLength(134)
    for (const o of ops) {
      expect(o.op).toBe('insert')
      expect(o.table).toBe('exercises')
      expect(o.ignoreDuplicates).toBe(true)
      expect(o.payload).toMatchObject({ id: o.rowId, user_id: 'u1', tips: null, archived: false })
    }
    expect(new Set(ops.map((o) => o.rowId)).size).toBe(134)
  })

  it('沒有缺的就是空陣列', () => {
    expect(catalogInsertOps('u1', catalogToAdd('u1', []))).toEqual([])
  })
})

describe('autoSeedOps（開 App 載入完自動補）', () => {
  const U = 'u1'

  it('空庫（新帳號）：補整份 150 個，離線也補（沒有從伺服器載到也一樣）', () => {
    expect(autoSeedOps(U, [], true)).toHaveLength(150)
    expect(autoSeedOps(U, [], false)).toHaveLength(150)
  })

  it('已有全部 16 個原始預設動作、且是從伺服器載到的：補其餘 134 個', () => {
    const ops = autoSeedOps(U, coreRows(U), true)
    expect(ops).toHaveLength(134)
    expect(ops.map((o) => o.rowId)).toEqual(EXTRA_EXERCISES.map((p) => presetExerciseId(U, p.key)))
    for (const o of ops) expect(o.ignoreDuplicates).toBe(true)
  })

  it('不是從伺服器載到的（本機快取可能比伺服器舊）：非空庫不補', () => {
    expect(autoSeedOps(U, coreRows(U), false)).toEqual([])
  })

  it('只缺 1 個原始預設動作（不是 App 預填出來的庫）：不補', () => {
    expect(autoSeedOps(U, coreRows(U).slice(1), true)).toEqual([])
  })

  it('從零自建、沒有任何預設動作：不補（那是他刻意建的庫，不該突然多 150 個）', () => {
    expect(autoSeedOps(U, [{ id: 'c1', user_id: U, name: '我的動作' }], true)).toEqual([])
  })

  it('別的帳號的預設動作 id 不算：id 含 userId', () => {
    expect(autoSeedOps(U, coreRows('u2'), true)).toEqual([])
  })

  it('預設動作被改名、封存過仍算「有」，不會被補回預設值；撞名的目錄項目不補', () => {
    const rows = coreRows(U)
    rows[0] = { ...rows[0], name: '我的腿推', archived: true }
    rows.push({ id: 'c1', user_id: U, name: '槓鈴臥推' })
    const ops = autoSeedOps(U, rows, true)
    expect(ops.map((o) => o.rowId)).not.toContain(rows[0].id)
    expect(ops).toHaveLength(133) // 134 個裡「槓鈴臥推」撞名
  })

  it('補完再載入一次是空的（冪等）：不會每次開 App 都寫', () => {
    const first = autoSeedOps(U, coreRows(U), true)
    const after = [...coreRows(U), ...first.map((o) => ({ ...o.payload, id: o.rowId }) as Row)]
    expect(autoSeedOps(U, after, true)).toEqual([])
    expect(autoSeedOps(U, [...autoSeedOps(U, [], true).map((o) => ({ ...o.payload, id: o.rowId }) as Row)], true)).toEqual([])
  })
})

describe('glyphOf', () => {
  it('肌群單字：七類各一字，資料異常落在「他」', () => {
    expect(MUSCLE_GROUPS.map((g) => glyphOf(g))).toEqual(['胸', '背', '腿', '肩', '臂', '腹', '他'])
    expect(glyphOf('legs')).toBe('腿')
    expect(glyphOf('???')).toBe('他')
    expect(glyphOf(undefined)).toBe('他')
  })
})
