/* 份量微調（spec「份量微調＋類型壓縮…」，使用者 2026-11-23 核可）：記一餐時依類型按幾顆鈕，從食品庫那一筆的基準值推算。
   純邏輯、不碰 DOM。數字出處見 spec 那一節的表格；標「假設」的四個（一分糖 15%、少飯 1/3、麵少／加麵、去皮 80 卡）使用者同意先用。
   紀錄（intake）存調整後的單份快照＋mods 代碼；食品庫那一筆不動。 */

export interface Macros {
  kcal: number
  protein: number
  fat: number
  carb: number
}

/** 判斷哪些鈕適用要看的食物欄位。 */
export interface ModTarget {
  name: string
  category: string | null
}

type Group = 'cup' | 'sweet' | 'top' | 'rice' | 'noodle' | 'main' | 'skin'

interface ModDef {
  code: string
  group: Group
  label: string
}

/** 甜度：基準無糖；比例 × 大杯全糖 45 g。 */
const SWEET: { code: string; label: string; ratio: number }[] = [
  { code: 'sweet:one', label: '一分糖', ratio: 0.15 },
  { code: 'sweet:slight', label: '微糖', ratio: 0.35 },
  { code: 'sweet:half', label: '半糖', ratio: 0.55 },
  { code: 'sweet:less', label: '少糖', ratio: 0.8 },
  { code: 'sweet:full', label: '全糖', ratio: 1 },
]
/** 大杯全糖的糖克數。 */
export const FULL_SUGAR_G = 45
/** 中杯＝大杯的倍數。 */
export const MEDIUM_CUP = 0.7

/** 加配料一份（不隨杯型縮）。 */
const TOPPINGS: { code: string; label: string; m: Macros }[] = [
  { code: 'top:pearl', label: '珍珠', m: { kcal: 165, protein: 0, fat: 0, carb: 41 } },
  { code: 'top:jelly', label: '寒天', m: { kcal: 60, protein: 0, fat: 0, carb: 15 } },
  { code: 'top:jade', label: '白玉', m: { kcal: 190, protein: 0, fat: 0, carb: 48 } },
  { code: 'top:coconut', label: '椰果', m: { kcal: 90, protein: 0, fat: 0, carb: 22 } },
  { code: 'top:grass', label: '仙草', m: { kcal: 65, protein: 0.3, fat: 0, carb: 16 } },
  { code: 'top:aiyu', label: '愛玉', m: { kcal: 30, protein: 0, fat: 0, carb: 7.5 } },
]

/** 白飯：食藥署 A0550601 每 100 g；一個便當最多 250 g。 */
const RICE_PER_100: Macros = { kcal: 183, protein: 3.1, fat: 0.3, carb: 41 }
export const RICE_MAX_G = 250
const RICE: { code: string; label: string; frac: number }[] = [
  { code: 'rice:less', label: '少飯', frac: 1 / 3 },
  { code: 'rice:half', label: '半飯', frac: 1 / 2 },
  { code: 'rice:none', label: '不要飯', frac: 1 },
]

/** 熟麵：國健署代換表每 100 g 約 117／3.3／0／25；一碗最多 300 g。 */
const NOODLE_PER_100: Macros = { kcal: 117, protein: 3.3, fat: 0, carb: 25 }
export const NOODLE_MAX_G = 300
const NOODLE: { code: string; label: string; frac: number }[] = [
  { code: 'noodle:less', label: '麵少', frac: -1 / 3 },
  { code: 'noodle:more', label: '加麵', frac: 1 / 2 },
]

/** 健康餐盒加主菜一份（spec「健康餐盒加主菜」，使用者 2026-11-23 核可）：食藥署每 100 g × 一份克數。
    份量照源食健康餐盒公開的生重（雞胸 100、雞腿 150、牛 100、豬 100、鮭 120）；鯛魚 100 g 熟重與蛋一顆是假設。 */
const MAINS: { code: string; label: string; m: Macros }[] = [
  { code: 'main:chicken', label: '雞胸', m: { kcal: 117, protein: 23.3, fat: 1.9, carb: 0.6 } }, // I0402402 生 100 g
  { code: 'main:thigh', label: '雞腿', m: { kcal: 247.5, protein: 29.7, fat: 13.35, carb: 0 } }, // I0404501 生 150 g
  { code: 'main:beef', label: '牛肉', m: { kcal: 139, protein: 19.8, fat: 6, carb: 0 } }, // 牛腱 I0108301 生 100 g
  { code: 'main:pork', label: '豬肉', m: { kcal: 139, protein: 21.1, fat: 5.4, carb: 0 } }, // 小里肌 I0306101 生 100 g
  { code: 'main:salmon', label: '鮭魚', m: { kcal: 208.8, protein: 24.84, fat: 11.4, carb: 0 } }, // J0402402 生 120 g
  { code: 'main:fish', label: '鯛魚', m: { kcal: 130, protein: 23.4, fat: 3.3, carb: 1.3 } }, // J0412101 水煮 100 g
  { code: 'main:egg', label: '蛋', m: { kcal: 79, protein: 7.7, fat: 5.1, carb: 0.9 } }, // 水煮蛋 K0111101 一顆 55 g
]

/** 去皮：雞腿帶皮與去皮的差（推算，假設）。 */
const SKIN_OFF: Macros = { kcal: -80, protein: -1.5, fat: -8, carb: 0 }

const DEFS: ModDef[] = [
  { code: 'cup:m', group: 'cup', label: '中杯' },
  ...SWEET.map((s) => ({ code: s.code, group: 'sweet' as const, label: s.label })),
  ...TOPPINGS.map((t) => ({ code: t.code, group: 'top' as const, label: t.label })),
  ...RICE.map((r) => ({ code: r.code, group: 'rice' as const, label: r.label })),
  ...NOODLE.map((n) => ({ code: n.code, group: 'noodle' as const, label: n.label })),
  ...MAINS.map((m) => ({ code: m.code, group: 'main' as const, label: m.label })),
  { code: 'skin:off', group: 'skin', label: '去皮' },
]
const DEF = new Map(DEFS.map((d) => [d.code, d]))

/** 飯量適用的類型（壓縮後的名字）。 */
const RICE_CATEGORIES = ['便當', '丼飯類']
/* 只認帶皮的部位（v2.156 review：原本 /鴨/ 會讓「麻辣鴨血臭豆腐」出去皮鈕） */
const SKIN_RE = /雞腿|雞排|鴨腿|鴨肉|烤鴨|燒鴨|鵝肉|鵝腿/
/** 歸在飯類卻沒有可減的白飯：壽司、飯糰（v2.156 review） */
const NO_RICE_RE = /壽司|飯糰/

/** 這樣食物有哪幾組微調（照顯示順序）。 */
export function groupsFor(f: ModTarget): Group[] {
  const out: Group[] = []
  if (f.category === '飲料') out.push('cup', 'sweet', 'top')
  if (f.category !== null && RICE_CATEGORIES.includes(f.category) && !NO_RICE_RE.test(f.name)) out.push('rice')
  // 麵量只給品名有「麵」的：餃類併進麵食後，水餃鍋貼不該出麵量
  if (f.category === '麵食' && f.name.includes('麵')) out.push('noodle')
  // 加主菜整類都出、不看品名（使用者 2026-11-23：加的主菜不固定，會混搭）
  if (f.category === '健康餐盒') out.push('main')
  if (SKIN_RE.test(f.name)) out.push('skin')
  return out
}

export const hasMods = (f: ModTarget): boolean => groupsFor(f).length > 0

/** 各組的選項（給畫面排鈕）。 */
export function optionsOf(group: Group): { code: string; label: string }[] {
  return DEFS.filter((d) => d.group === group).map(({ code, label }) => ({ code, label }))
}

/** 單選的組：同組只留最後一個。配料與加主菜可複選；去皮是開關。 */
const SINGLE: Group[] = ['cup', 'sweet', 'rice', 'noodle', 'skin']

/** 清掉不認得的、這樣食物不適用的、重複的；單選組只留最後一個；照固定順序排（存進 DB 的順序穩定，比對才準）。 */
export function normalizeMods(codes: readonly unknown[], f: ModTarget): string[] {
  const groups = groupsFor(f)
  const picked = new Map<Group, string[]>()
  for (const c of codes) {
    if (typeof c !== 'string') continue
    const d = DEF.get(c)
    if (!d || !groups.includes(d.group)) continue
    const list = picked.get(d.group) ?? []
    if (SINGLE.includes(d.group)) picked.set(d.group, [c])
    else if (!list.includes(c)) picked.set(d.group, [...list, c])
  }
  const all = [...picked.values()].flat()
  return DEFS.map((d) => d.code).filter((c) => all.includes(c))
}

/** 切換一顆鈕：單選組按同一顆＝取消、按別顆＝換；配料與去皮是開關。 */
export function toggleMod(current: readonly string[], code: string, f: ModTarget): string[] {
  const d = DEF.get(code)
  if (!d) return [...current]
  if (current.includes(code)) return current.filter((c) => c !== code)
  const rest = SINGLE.includes(d.group) ? current.filter((c) => DEF.get(c)?.group !== d.group) : [...current]
  return normalizeMods([...rest, code], f)
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (m: Macros): Macros => ({
  kcal: round1(Math.max(0, m.kcal)),
  protein: round1(Math.max(0, m.protein)),
  fat: round1(Math.max(0, m.fat)),
  carb: round1(Math.max(0, m.carb)),
})
const add = (a: Macros, b: Macros, k = 1): Macros => ({
  kcal: a.kcal + b.kcal * k,
  protein: a.protein + b.protein * k,
  fat: a.fat + b.fat * k,
  carb: a.carb + b.carb * k,
})

/** 這筆的白飯克數：碳水大多來自飯，用碳水回推，最多 250 g。 */
export const riceGramsOf = (base: Macros): number => Math.min(RICE_MAX_G, Math.max(0, base.carb) / (RICE_PER_100.carb / 100))
/** 這碗的熟麵克數：同理，最多 300 g。 */
export const noodleGramsOf = (base: Macros): number => Math.min(NOODLE_MAX_G, Math.max(0, base.carb) / (NOODLE_PER_100.carb / 100))

/** 一步一步的調整（給展開後的算式用）。kcal 是這一步帶來的熱量變化；cup 是倍數那一步。 */
export interface ModStep {
  label: string
  /** 'mul'＝乘上倍數；'add'＝加或減熱量 */
  kind: 'mul' | 'add'
  value: number
  /** 甜度那一步的糖克數（算式寫「微糖 11 g」） */
  sugarG?: number
}

/** 套用微調：順序固定——杯型（整筆乘）→ 甜度（加糖）→ 配料（加，不縮）→ 飯量 → 麵量 → 加主菜 → 去皮。結果不低於 0、取到一位小數。 */
export function applyMods(base: Macros, codes: readonly string[], f: ModTarget): { result: Macros; steps: ModStep[] } {
  const mods = normalizeMods(codes, f)
  let v: Macros = { ...base }
  const steps: ModStep[] = []
  const medium = mods.includes('cup:m')
  if (medium) {
    v = { kcal: v.kcal * MEDIUM_CUP, protein: v.protein * MEDIUM_CUP, fat: v.fat * MEDIUM_CUP, carb: v.carb * MEDIUM_CUP }
    steps.push({ label: '中杯', kind: 'mul', value: MEDIUM_CUP })
  }
  for (const s of SWEET) {
    if (!mods.includes(s.code)) continue
    const g = FULL_SUGAR_G * s.ratio * (medium ? MEDIUM_CUP : 1)
    v = add(v, { kcal: g * 4, protein: 0, fat: 0, carb: g })
    steps.push({ label: s.label, kind: 'add', value: g * 4, sugarG: g })
  }
  for (const t of TOPPINGS) {
    if (!mods.includes(t.code)) continue
    v = add(v, t.m)
    steps.push({ label: t.label, kind: 'add', value: t.m.kcal })
  }
  for (const r of RICE) {
    if (!mods.includes(r.code)) continue
    const g = riceGramsOf(base) * r.frac
    v = add(v, RICE_PER_100, -g / 100)
    steps.push({ label: r.label, kind: 'add', value: (-g * RICE_PER_100.kcal) / 100 })
  }
  for (const n of NOODLE) {
    if (!mods.includes(n.code)) continue
    const g = noodleGramsOf(base) * n.frac
    v = add(v, NOODLE_PER_100, g / 100)
    steps.push({ label: n.label, kind: 'add', value: (g * NOODLE_PER_100.kcal) / 100 })
  }
  for (const m of MAINS) {
    if (!mods.includes(m.code)) continue
    v = add(v, m.m)
    steps.push({ label: m.label, kind: 'add', value: m.m.kcal })
  }
  if (mods.includes('skin:off')) {
    v = add(v, SKIN_OFF)
    steps.push({ label: '去皮', kind: 'add', value: SKIN_OFF.kcal })
  }
  return { result: clamp(v), steps }
}

/** 摘要那一行：永遠寫現在的狀態（使用者 2026-11-23：沒調過也寫「大杯・無糖」「正常飯量」）。 */
export function summaryOf(codes: readonly string[], f: ModTarget): string {
  const mods = normalizeMods(codes, f)
  const label = (c: string) => DEF.get(c)!.label
  const parts: string[] = []
  for (const g of groupsFor(f)) {
    const inGroup = mods.filter((c) => DEF.get(c)!.group === g)
    if (g === 'cup') parts.push(inGroup.length ? label(inGroup[0]) : '大杯')
    else if (g === 'sweet') parts.push(inGroup.length ? label(inGroup[0]) : '無糖')
    else if (g === 'top') parts.push(...inGroup.map((c) => `＋${label(c)}`))
    else if (g === 'main') parts.push(...(inGroup.length ? inGroup.map((c) => `＋${label(c)}`) : ['沒加主菜']))
    else if (g === 'rice') parts.push(inGroup.length ? label(inGroup[0]) : '正常飯量')
    else if (g === 'noodle') parts.push(inGroup.length ? label(inGroup[0]) : '正常麵量')
    else if (g === 'skin' && inGroup.length) parts.push('去皮')
  }
  return parts.length ? parts.join('・') : '帶皮'
}

/** 紀錄品名後面的括號：只寫有調的；沒調就空字串。 */
export function suffixOf(codes: readonly string[], f: ModTarget): string {
  const mods = normalizeMods(codes, f)
  if (!mods.length) return ''
  const label = (c: string) => DEF.get(c)!.label
  const plus = (c: string) => DEF.get(c)!.group === 'top' || DEF.get(c)!.group === 'main'
  return `（${mods.map((c) => (plus(c) ? `＋${label(c)}` : label(c))).join('・')}）`
}

/** 展開後最下面的算式：「165 × 0.7 ＋ 微糖 11 g ＝ 160 卡」。沒調就 null。 */
export function calcLineOf(base: Macros, codes: readonly string[], f: ModTarget): string | null {
  const { result, steps } = applyMods(base, codes, f)
  if (!steps.length) return null
  const fmt = (n: number) => String(Math.round(n))
  const parts = [fmt(base.kcal)]
  for (const s of steps) {
    if (s.kind === 'mul') parts.push(`× ${s.value}`)
    else if (s.sugarG !== undefined) parts.push(`＋ ${s.label} ${fmt(s.sugarG)} g`)
    else parts.push(`${s.value < 0 ? '−' : '＋'} ${s.label} ${fmt(Math.abs(s.value))}`)
  }
  return `${parts.join(' ')} ＝ ${fmt(result.kcal)} 卡`
}
