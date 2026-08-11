/* 資料層：改用 supabase-js（取代 legacy/app.js 手接的約 80 行 REST + OAuth）。
   session 存取／refresh／逾期偵測交給 supabase-js 內建的 autoRefreshToken／persistSession，
   legacy 手刻的 session store、refreshSession、validToken、consumeAuthRedirect 因此整段作廢，
   不在這裡搬——這是「換底層函式庫」帶來的刻意行為變更，不是遺漏。
   lib 內禁止碰 window／document：組 redirectTo 這種事留給呼叫端（UI／入口層）做，
   這裡只接受組好的字串。 */
import { createClient, type Session, type AuthChangeEvent } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'
import type { Profile } from './formulas'
/* 型別匯入不會產生循環：meals.ts 是純常數與純函式，不反向依賴 api.ts。
   收斂成 MealKey 而不是裸 string，讓非法餐別在 TS 邊界就擋掉，不必等 DB 約束
   （precommit review 的 code 與 security 兩個維度各提了一次）。 */
import type { MealKey } from './meals'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/* 逾時是必要件不是保險：連上了但不回的失敗形態，fetch 對它永遠不 reject。
   數值照 legacy DB_TIMEOUT。只掛在資料 CRUD 上，auth 呼叫（signInWithOAuth/getSession）不掛。
   AbortSignal.timeout 逾時產生 DOMException{name:'TimeoutError'}，postgrest-js 組出的
   error.message 形如 'TimeoutError: signal timed out'（不是 AbortError），unwrap() 原樣拋出，
   App 的 friendlyError 靠這個字串辨識。 */
const DB_TIMEOUT = 8000
const dbSignal = () => AbortSignal.timeout(DB_TIMEOUT)

/** {data,error} 一律在這裡拆開丟出，呼叫端只管 try/catch，跟 legacy db() 的用法一致。 */
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('Supabase 回傳空資料')
  return result.data
}

/* ═══════════ Auth ═══════════ */

/** redirectTo 由呼叫端組（location.origin + import.meta.env.BASE_URL）。 */
export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new Error(error.message)
  return data.session
}

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  return supabase.auth.onAuthStateChange(callback)
}

/* ═══════════ foods ═══════════ */

export interface Food {
  id: number
  name: string
  vendor: string | null
  kcal: number
  protein: number
  fat: number
  carb: number
  archived: boolean
}

export interface NewFood {
  name: string
  vendor: string | null
  kcal: number
  protein: number
  fat: number
  carb: number
}

const FOOD_COLS = 'id,name,vendor,kcal,protein,fat,carb,archived'

/** 今日頁記一筆的挑選清單只給使用中的食物——封存是「以後不再用」的宣告，
 *  不該讓它繼續冒出來讓人選到。 */
export async function listFoods(): Promise<Food[]> {
  return unwrap(await supabase.from('foods').select(FOOD_COLS).eq('archived', false).abortSignal(dbSignal()))
}

/** 食品庫管理頁「已封存」分頁專用，其餘畫面不需要看到已封存的食物。 */
export async function listArchivedFoods(): Promise<Food[]> {
  return unwrap(await supabase.from('foods').select(FOOD_COLS).eq('archived', true).abortSignal(dbSignal()))
}

export async function createFood(food: NewFood): Promise<Food> {
  const rows = unwrap<Food[]>(await supabase.from('foods').insert(food).select(FOOD_COLS).abortSignal(dbSignal()))
  const row = rows[0]
  /* 沒拿到新列就不能往下選取。食物其實已經建立了，講清楚讓呼叫端能引導使用者重開清單找到它 */
  if (!row) throw new Error('食物已建立，但沒拿到回傳資料')
  return row
}

/** 就地編輯與封存/復原共用一支：封存只是把 archived 這一欄改掉，不是真的刪列
 *  （intake.food_id 是 restrict 外鍵，歷史紀錄要保留可查）。 */
export async function updateFood(id: number, patch: Partial<NewFood & { archived: boolean }>): Promise<void> {
  const { error } = await supabase.from('foods').update(patch).eq('id', id).abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}

/* ═══════════ intake ═══════════ */

export interface IntakeRow {
  id: number
  meal: string
  qty: number
  kcal: number
  protein: number
  fat: number
  carb: number
  /** 這一筆自己的品名快照。null＝沿用 foods 的品名（絕大多數紀錄都是 null，加這欄時
   *  刻意不回填）。有值代表使用者為這一筆改過名（「雞排便當（去皮）」），
   *  之後食品庫再改品名也不會回頭改寫它——與 kcal/protein/fat/carb 同一套快照語意。 */
  name: string | null
  foods: { name: string; vendor: string | null } | null
}

/** 營養值取 intake 自己的快照欄，不取 foods——改食物庫的營養值不該改寫過去的紀錄。 */
export async function listIntake(date: string): Promise<IntakeRow[]> {
  /* foods 是多對一（每筆 intake 對一個 food），但沒有 Database schema 時 postgrest-js
     推不出關聯基數，型別預設當作陣列——實際回傳仍是單一物件，用明確泛型覆寫成真實形狀 */
  return unwrap(await supabase
    .from('intake')
    .select<'id,meal,qty,kcal,protein,fat,carb,name,foods(name,vendor)', IntakeRow>(
      'id,meal,qty,kcal,protein,fat,carb,name,foods(name,vendor)',
    )
    .eq('eaten_on', date)
    .order('created_at', { ascending: true })
    .abortSignal(dbSignal()))
}

export interface RecentIntakeRow {
  meal: string
  food_id: number
  qty: number
}

/** 常吃排序用：按 eaten_on 由新到舊撈最近 limit 筆。 */
export async function listRecentIntake(limit = 120): Promise<RecentIntakeRow[]> {
  return unwrap(await supabase
    .from('intake')
    .select('meal,food_id,qty')
    .order('eaten_on', { ascending: false })
    .order('id', { ascending: false }) // 同日多筆時「最近一次」才有定義（review 抓的）
    .limit(limit)
    .abortSignal(dbSignal()))
}

export interface NewIntake {
  eaten_on: string
  meal: string
  food_id: number
  qty: number
  kcal: number
  protein: number
  fat: number
  carb: number
}

/** 存單份營養快照（不乘 qty）：改食物庫的營養值不該改寫過去的紀錄。 */
export async function createIntake(rows: NewIntake[]): Promise<{ id: number }[]> {
  return unwrap(await supabase.from('intake').insert(rows).select('id').abortSignal(dbSignal()))
}

export async function deleteIntake(id: number): Promise<void> {
  const { error } = await supabase.from('intake').delete().eq('id', id).abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}

/** 改份量：只更新 qty 這一欄。kcal/protein/fat/carb 是單份快照，qty 不影響它們，
 *  渲染時才用 qty 相乘（Today.tsx），所以不需要一併重算或重寫營養值欄位。 */
export async function updateIntakeQty(id: number, qty: number): Promise<void> {
  const { error } = await supabase.from('intake').update({ qty }).eq('id', id).abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}

/** 改餐別：同樣只動一欄。餐別不影響營養快照，也不影響 eaten_on——
 *  「記錯餐別」與「記錯日期」是兩件事，後者刻意不給編輯入口（刪掉重記更直觀，
 *  且改日期會讓那一筆離開當前畫面，需要另一套「已移到 8/2」的回饋設計）。 */
export async function updateIntakeMeal(id: number, meal: MealKey): Promise<void> {
  const { error } = await supabase.from('intake').update({ meal }).eq('id', id).abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}

/** 這一筆自己的品名與營養值（「今天這份雞排便當去了皮」）。**只動 intake 這一列，
 *  絕不碰 foods**——那正是這個功能存在的理由：調整當天實際吃的量，不污染食品庫的標準值。
 *  呼叫端一次只送一欄（編輯區各欄 blur 時各自 commit），與 updateIntakeQty/Meal 同慣例。
 *  name 送 null＝清掉快照、顯示退回 foods 的品名。 */
export type IntakeDetailPatch = Partial<Pick<IntakeRow, 'name' | 'kcal' | 'protein' | 'fat' | 'carb'>>

export async function updateIntakeDetail(id: number, patch: IntakeDetailPatch): Promise<void> {
  const { error } = await supabase.from('intake').update(patch).eq('id', id).abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}

/* ═══════════ weight ═══════════ */

export interface Weight {
  weight_kg: number
  measured_on: string
  body_fat_pct: number | null
}

/** body_fat_pct 一併撈：目標計算（Katch-McArdle）要用最新一筆的體脂率，
 *  沒有就是沒有，呼叫端不再往回找更舊的值（見 formulas.ts computeTargets 註解）。 */
export async function getLatestWeight(): Promise<Weight | null> {
  const rows = unwrap<Weight[]>(await supabase
    .from('weight')
    .select('weight_kg,measured_on,body_fat_pct')
    .order('measured_on', { ascending: false })
    .limit(1)
    .abortSignal(dbSignal()))
  return rows[0] ?? null
}

/** 體重趨勢（sparkline＋獨立頁）用：由舊到新排序，量小（記錄頻率頂多一天一筆）不分頁。 */
export async function listWeights(limit = 90): Promise<Weight[]> {
  const rows = unwrap<Weight[]>(await supabase
    .from('weight')
    .select('weight_kg,measured_on,body_fat_pct')
    .order('measured_on', { ascending: false })
    .limit(limit)
    .abortSignal(dbSignal()))
  return rows.reverse()
}

export interface NewWeight {
  user_id: string
  measured_on: string
  weight_kg: number
  body_fat_pct: number | null
}

/**
 * 同一天再記一次是覆蓋，不是新增一筆——schema 有 unique(user_id, measured_on)。
 * onConflict 不可省：主鍵是 identity id、body 沒帶 id，預設的衝突目標綁在主鍵上永遠不會命中，
 * 接著就會撞上那條 unique 約束報 23505（legacy 已修過這個 bug，語意照搬）。
 */
export async function upsertWeight(weight: NewWeight): Promise<void> {
  const { error } = await supabase
    .from('weight')
    .upsert(weight, { onConflict: 'user_id,measured_on' })
    .abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}

/* ═══════════ profile ═══════════ */

export interface ProfileRow extends Profile {
  user_id: string
}

export async function getProfile(): Promise<ProfileRow | null> {
  const rows = unwrap<ProfileRow[]>(await supabase.from('profile').select('*').limit(1).abortSignal(dbSignal()))
  return rows[0] ?? null
}

/** 只負責寫入，欄位驗證（出生年範圍、自訂目標必填等）交給呼叫端先做。 */
export async function updateProfile(userId: string, patch: Partial<ProfileRow>): Promise<void> {
  const { error } = await supabase.from('profile').update(patch).eq('user_id', userId).abortSignal(dbSignal())
  if (error) throw new Error(error.message)
}
