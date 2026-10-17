/* 動作庫的預設目錄：既有 16 個預填動作（`PRESET_EXERCISES`，新帳號首次預填）加上 134 個常見動作，共 150 個。
   每個動作有一張示意圖 `src/assets/exercises/<key>.webp`（來源與授權見 `scripts/build-exercise-images.mjs`，
   key→資料集 id 的對照在 `scripts/exercise-images.json`）。

   **id 與圖的對應不靠 schema**：預設動作的列 id 是確定性的（`presetExerciseId`：userId＋key 的 uuid v5），
   所以拿列上的 `user_id` 與 `id` 重算一次就知道它是哪個預設動作、該用哪張圖——使用者改名、封存、寫要點都不影響。
   使用者自己新增的動作 id 不在表裡，沒有圖。
   **開 App 載入完自動補**（`autoSeedOps`，不用按按鈕）：空庫補整份、已有 16 個原始預設動作的帳號補其餘缺的、從零自建的不補；
   insert-ignore，不動使用者改過或封存的列；**名稱與既有動作重複的不補**（`checkExercise` 的規則：名稱不能重複，含已封存的）。 */
import { MUSCLE_GROUPS, PRESET_EXERCISES, foldName, presetExerciseId, type MuscleGroup, type Row, type RowOp } from './training'

export interface CatalogExercise {
  readonly key: string
  readonly name: string
  readonly muscle_group: MuscleGroup
}

export const EXTRA_EXERCISES: readonly CatalogExercise[] = [
  { key: 'barbell-bench-press', name: '槓鈴臥推', muscle_group: 'chest' },
  { key: 'incline-barbell-bench-press', name: '上斜槓鈴臥推', muscle_group: 'chest' },
  { key: 'decline-barbell-bench-press', name: '下斜槓鈴臥推', muscle_group: 'chest' },
  { key: 'dumbbell-bench-press', name: '啞鈴臥推', muscle_group: 'chest' },
  { key: 'incline-dumbbell-press', name: '上斜啞鈴臥推', muscle_group: 'chest' },
  { key: 'decline-dumbbell-press', name: '下斜啞鈴臥推', muscle_group: 'chest' },
  { key: 'dumbbell-fly', name: '啞鈴飛鳥', muscle_group: 'chest' },
  { key: 'incline-dumbbell-fly', name: '上斜啞鈴飛鳥', muscle_group: 'chest' },
  { key: 'cable-crossover', name: '滑輪夾胸', muscle_group: 'chest' },
  { key: 'low-cable-crossover', name: '低位滑輪夾胸', muscle_group: 'chest' },
  { key: 'cable-chest-press', name: '滑輪胸推', muscle_group: 'chest' },
  { key: 'incline-chest-press-machine', name: '上斜胸推機', muscle_group: 'chest' },
  { key: 'decline-chest-press-machine', name: '下斜胸推機', muscle_group: 'chest' },
  { key: 'smith-bench-press', name: '史密斯臥推', muscle_group: 'chest' },
  { key: 'smith-incline-bench-press', name: '史密斯上斜臥推', muscle_group: 'chest' },
  { key: 'pushup', name: '伏地挺身', muscle_group: 'chest' },
  { key: 'pullup', name: '引體向上', muscle_group: 'back' },
  { key: 'chinup', name: '反握引體向上', muscle_group: 'back' },
  { key: 'close-grip-lat-pulldown', name: '窄握滑輪下拉', muscle_group: 'back' },
  { key: 'v-bar-pulldown', name: 'V 把下拉', muscle_group: 'back' },
  { key: 'underhand-pulldown', name: '反握滑輪下拉', muscle_group: 'back' },
  { key: 'one-arm-lat-pulldown', name: '單臂滑輪下拉', muscle_group: 'back' },
  { key: 'straight-arm-pulldown', name: '直臂下拉', muscle_group: 'back' },
  { key: 'barbell-row', name: '槓鈴俯身划船', muscle_group: 'back' },
  { key: 'reverse-grip-barbell-row', name: '反握槓鈴划船', muscle_group: 'back' },
  { key: 'dumbbell-row', name: '單臂啞鈴划船', muscle_group: 'back' },
  { key: 'two-dumbbell-row', name: '雙啞鈴俯身划船', muscle_group: 'back' },
  { key: 't-bar-row', name: 'T 槓划船', muscle_group: 'back' },
  { key: 'leverage-high-row', name: '高位划船機', muscle_group: 'back' },
  { key: 'leverage-iso-row', name: '單側划船機', muscle_group: 'back' },
  { key: 'smith-bent-over-row', name: '史密斯俯身划船', muscle_group: 'back' },
  { key: 'one-arm-seated-cable-row', name: '單臂坐姿滑輪划船', muscle_group: 'back' },
  { key: 'barbell-deadlift', name: '槓鈴硬舉', muscle_group: 'back' },
  { key: 'sumo-deadlift', name: '相撲硬舉', muscle_group: 'back' },
  { key: 'rack-pull', name: '架上硬舉', muscle_group: 'back' },
  { key: 'barbell-shrug', name: '槓鈴聳肩', muscle_group: 'back' },
  { key: 'dumbbell-shrug', name: '啞鈴聳肩', muscle_group: 'back' },
  { key: 'barbell-squat', name: '槓鈴深蹲', muscle_group: 'legs' },
  { key: 'front-squat', name: '前蹲舉', muscle_group: 'legs' },
  { key: 'smith-squat', name: '史密斯深蹲', muscle_group: 'legs' },
  { key: 'hack-squat', name: '哈克深蹲機', muscle_group: 'legs' },
  { key: 'goblet-squat', name: '高腳杯深蹲', muscle_group: 'legs' },
  { key: 'dumbbell-squat', name: '啞鈴深蹲', muscle_group: 'legs' },
  { key: 'bodyweight-squat', name: '徒手深蹲', muscle_group: 'legs' },
  { key: 'box-squat', name: '箱式深蹲', muscle_group: 'legs' },
  { key: 'barbell-lunge', name: '槓鈴弓步蹲', muscle_group: 'legs' },
  { key: 'dumbbell-lunge', name: '啞鈴弓步蹲', muscle_group: 'legs' },
  { key: 'walking-lunge', name: '槓鈴走路弓步', muscle_group: 'legs' },
  { key: 'dumbbell-rear-lunge', name: '啞鈴後跨弓步', muscle_group: 'legs' },
  { key: 'dumbbell-split-squat', name: '啞鈴分腿蹲', muscle_group: 'legs' },
  { key: 'dumbbell-step-up', name: '啞鈴登階', muscle_group: 'legs' },
  { key: 'barbell-step-up', name: '槓鈴登階', muscle_group: 'legs' },
  { key: 'smith-leg-press', name: '史密斯腿推', muscle_group: 'legs' },
  { key: 'narrow-leg-press', name: '窄站距腿推舉', muscle_group: 'legs' },
  { key: 'single-leg-extension', name: '單腿腿屈伸', muscle_group: 'legs' },
  { key: 'lying-leg-curl', name: '俯臥腿後彎舉', muscle_group: 'legs' },
  { key: 'standing-leg-curl', name: '站姿腿後彎舉', muscle_group: 'legs' },
  { key: 'romanian-deadlift', name: '羅馬尼亞硬舉', muscle_group: 'legs' },
  { key: 'stiff-leg-deadlift', name: '直腿硬舉', muscle_group: 'legs' },
  { key: 'dumbbell-stiff-leg-deadlift', name: '啞鈴直腿硬舉', muscle_group: 'legs' },
  { key: 'good-morning', name: '早安體前屈', muscle_group: 'legs' },
  { key: 'glute-ham-raise', name: '臀腿屈伸機', muscle_group: 'legs' },
  { key: 'hip-thrust', name: '槓鈴臀推', muscle_group: 'legs' },
  { key: 'glute-bridge', name: '槓鈴臀橋', muscle_group: 'legs' },
  { key: 'cable-kickback', name: '滑輪後踢腿', muscle_group: 'legs' },
  { key: 'cable-pull-through', name: '滑輪拉過', muscle_group: 'legs' },
  { key: 'seated-calf-raise', name: '坐姿小腿提踵', muscle_group: 'legs' },
  { key: 'standing-barbell-calf-raise', name: '槓鈴站姿小腿提踵', muscle_group: 'legs' },
  { key: 'smith-calf-raise', name: '史密斯小腿提踵', muscle_group: 'legs' },
  { key: 'dumbbell-calf-raise', name: '啞鈴站姿小腿提踵', muscle_group: 'legs' },
  { key: 'leg-press-calf-raise', name: '腿推機小腿推', muscle_group: 'legs' },
  { key: 'military-press', name: '站姿軍事推舉', muscle_group: 'shoulder' },
  { key: 'seated-barbell-press', name: '坐姿槓鈴肩推', muscle_group: 'shoulder' },
  { key: 'dumbbell-shoulder-press', name: '啞鈴肩推', muscle_group: 'shoulder' },
  { key: 'arnold-press', name: '阿諾推舉', muscle_group: 'shoulder' },
  { key: 'seated-dumbbell-press', name: '坐姿啞鈴肩推', muscle_group: 'shoulder' },
  { key: 'smith-shoulder-press', name: '史密斯肩推', muscle_group: 'shoulder' },
  { key: 'machine-shoulder-press', name: '器械軍事肩推', muscle_group: 'shoulder' },
  { key: 'side-lateral-raise', name: '啞鈴側平舉', muscle_group: 'shoulder' },
  { key: 'cable-lateral-raise', name: '坐姿滑輪側平舉', muscle_group: 'shoulder' },
  { key: 'front-dumbbell-raise', name: '啞鈴前平舉', muscle_group: 'shoulder' },
  { key: 'front-cable-raise', name: '滑輪前平舉', muscle_group: 'shoulder' },
  { key: 'rear-delt-raise', name: '坐姿俯身後三角飛鳥', muscle_group: 'shoulder' },
  { key: 'dumbbell-reverse-fly', name: '啞鈴反向飛鳥', muscle_group: 'shoulder' },
  { key: 'cable-rear-delt-fly', name: '滑輪後三角飛鳥', muscle_group: 'shoulder' },
  { key: 'face-pull', name: '面拉', muscle_group: 'shoulder' },
  { key: 'upright-row', name: '槓鈴直立划船', muscle_group: 'shoulder' },
  { key: 'dumbbell-upright-row', name: '啞鈴直立划船', muscle_group: 'shoulder' },
  { key: 'barbell-curl', name: '槓鈴二頭彎舉', muscle_group: 'arms' },
  { key: 'ez-bar-curl', name: 'EZ 槓彎舉', muscle_group: 'arms' },
  { key: 'dumbbell-curl', name: '啞鈴二頭彎舉', muscle_group: 'arms' },
  { key: 'alternate-dumbbell-curl', name: '啞鈴交替彎舉', muscle_group: 'arms' },
  { key: 'hammer-curl', name: '錘式彎舉', muscle_group: 'arms' },
  { key: 'incline-dumbbell-curl', name: '上斜啞鈴彎舉', muscle_group: 'arms' },
  { key: 'concentration-curl', name: '集中彎舉', muscle_group: 'arms' },
  { key: 'preacher-curl', name: '牧師椅槓鈴彎舉', muscle_group: 'arms' },
  { key: 'machine-preacher-curl', name: '牧師椅彎舉機', muscle_group: 'arms' },
  { key: 'cable-curl', name: '滑輪二頭彎舉', muscle_group: 'arms' },
  { key: 'cable-rope-hammer-curl', name: '滑輪繩索錘式彎舉', muscle_group: 'arms' },
  { key: 'reverse-barbell-curl', name: '反握槓鈴彎舉', muscle_group: 'arms' },
  { key: 'zottman-curl', name: '佐特曼彎舉', muscle_group: 'arms' },
  { key: 'ez-bar-skullcrusher', name: 'EZ 槓仰臥臂屈伸', muscle_group: 'arms' },
  { key: 'close-grip-bench-press', name: '窄握槓鈴臥推', muscle_group: 'arms' },
  { key: 'rope-pushdown', name: '繩索三頭下壓', muscle_group: 'arms' },
  { key: 'vbar-pushdown', name: 'V 把三頭下壓', muscle_group: 'arms' },
  { key: 'reverse-grip-pushdown', name: '反握三頭下壓', muscle_group: 'arms' },
  { key: 'rope-overhead-extension', name: '繩索過頭三頭伸展', muscle_group: 'arms' },
  { key: 'dumbbell-overhead-extension', name: '站姿啞鈴過頭臂屈伸', muscle_group: 'arms' },
  { key: 'lying-dumbbell-extension', name: '仰臥啞鈴臂屈伸', muscle_group: 'arms' },
  { key: 'triceps-kickback', name: '啞鈴三頭後踢', muscle_group: 'arms' },
  { key: 'machine-triceps-extension', name: '三頭伸展機', muscle_group: 'arms' },
  { key: 'dip-machine', name: '雙槓撐體機', muscle_group: 'arms' },
  { key: 'dips', name: '雙槓撐體', muscle_group: 'arms' },
  { key: 'bench-dips', name: '板凳撐體', muscle_group: 'arms' },
  { key: 'barbell-wrist-curl', name: '槓鈴腕彎舉', muscle_group: 'arms' },
  { key: 'reverse-wrist-curl', name: '槓鈴反向腕彎舉', muscle_group: 'arms' },
  { key: 'crunch', name: '捲腹', muscle_group: 'core' },
  { key: 'cable-crunch', name: '滑輪捲腹', muscle_group: 'core' },
  { key: 'decline-crunch', name: '下斜捲腹', muscle_group: 'core' },
  { key: 'reverse-crunch', name: '反向捲腹', muscle_group: 'core' },
  { key: 'sit-up', name: '仰臥起坐', muscle_group: 'core' },
  { key: 'bench-leg-raise', name: '平板仰臥抬腿', muscle_group: 'core' },
  { key: 'russian-twist', name: '俄羅斯轉體', muscle_group: 'core' },
  { key: 'plank', name: '棒式', muscle_group: 'core' },
  { key: 'side-plank', name: '側棒式', muscle_group: 'core' },
  { key: 'ab-rollout', name: '槓鈴滾輪捲腹', muscle_group: 'core' },
  { key: 'pallof-press', name: '帕洛夫推', muscle_group: 'core' },
  { key: 'cable-wood-chop', name: '滑輪伐木', muscle_group: 'core' },
  { key: 'cable-side-bend', name: '單臂高位滑輪側彎', muscle_group: 'core' },
  { key: 'dumbbell-side-bend', name: '啞鈴側彎', muscle_group: 'core' },
  { key: 'dead-bug', name: '死蟲式', muscle_group: 'core' },
  { key: 'power-clean', name: '爆發式高翻', muscle_group: 'other' },
  { key: 'turkish-get-up', name: '土耳其起立', muscle_group: 'other' },
  { key: 'kettlebell-swing', name: '單臂壺鈴擺盪', muscle_group: 'other' },
]

export const EXERCISE_CATALOG: readonly CatalogExercise[] = [...PRESET_EXERCISES, ...EXTRA_EXERCISES]

interface UserIndex {
  /** 列 id → 預設動作 key。 */
  readonly idToKey: Map<string, string>
  /** 與 `EXERCISE_CATALOG` 同序的列 id。 */
  readonly ids: readonly string[]
}

const indexes = new Map<string, UserIndex>()

/** 該帳號的 id 對照。算 150 次 uuid v5，每個帳號只算一次（搜尋框每打一個字都會重新渲染，不能每次重算）。 */
function indexOf(userId: string): UserIndex {
  let ix = indexes.get(userId)
  if (!ix) {
    const ids = EXERCISE_CATALOG.map((p) => presetExerciseId(userId, p.key))
    ix = { idToKey: new Map(ids.map((id, i) => [id, EXERCISE_CATALOG[i].key])), ids }
    indexes.set(userId, ix)
  }
  return ix
}

/** 這一列是哪個預設動作（回 key），不是預設動作或缺 `user_id` 回 null。 */
export function catalogKey(row: Row): string | null {
  return typeof row.user_id === 'string' ? (indexOf(row.user_id).idToKey.get(row.id) ?? null) : null
}

/** 動作庫「補齊預設動作」要寫的列：目錄裡、這個帳號還沒有的。「已有」有兩種：
 *  ① 確定性 id 已在（含已封存的、改過名的預設動作）；
 *  ② **名稱與既有任何動作重複**（`foldName`：全形半形、大小寫、空白都視為同名；含已封存的）——
 *  `checkExercise` 規定動作名稱不能重複，補進同名列之後兩列都存不了（改要點也會被名稱檢查擋下），
 *  而 `exercises` 只能封存、不能真刪，事後救不回來。代價：使用者自建的同名動作不會因此長出圖。
 *  呼叫端要用 insert-ignore 排進佇列：離線時本機底可能還沒載到，回線後不能蓋掉伺服器上被改過的列。 */
export function catalogToAdd(userId: string, existing: readonly Row[]): Row[] {
  const { ids } = indexOf(userId)
  const haveId = new Set(existing.map((r) => r.id))
  const haveName = new Set(existing.map((r) => foldName(r.name)))
  return EXERCISE_CATALOG.flatMap((p, i): Row[] =>
    haveId.has(ids[i]) || haveName.has(foldName(p.name))
      ? []
      : [{ id: ids[i], user_id: userId, name: p.name, muscle_group: p.muscle_group, tips: null, archived: false }],
  )
}

/** 預設動作要排進佇列的寫入：每個缺的一筆 insert，**一律 `ignoreDuplicates`**。
 *  離線時本機底可能還沒載到、或比伺服器舊，這時缺的清單會多算；回線後 insert-ignore 讓伺服器上已存在的列（含改過名、封存過的）原封不動。 */
export function catalogInsertOps(userId: string, existing: readonly Row[]): RowOp[] {
  return catalogToAdd(userId, existing).map((r) => ({
    op: 'insert',
    table: 'exercises',
    rowId: r.id,
    payload: { ...r },
    ignoreDuplicates: true,
  }))
}

/** 開 App 載入完之後要自動補的預設動作（使用者 2026-10-17：「自動補動作，不用按按鈕」）。三種情形：
 *  ① **動作庫是空的**（新帳號）：補整份目錄 150 個。離線也補（排進佇列、insert-ignore，回線才上傳）。
 *  ② **已有全部 16 個原始預設動作**（App 自己預填過的帳號）且**這份動作是從伺服器載到的**：補其餘缺的。
 *     只認伺服器載到的：本機快取可能比伺服器舊，拿舊清單算「缺什麼」會把同名判斷也算歪。
 *  ③ 其他（使用者從零自建、沒有預設動作）：**不補**——那是他刻意建的庫，不該突然多 150 個。
 *  補的內容由 `catalogToAdd` 決定：id 已在、名稱重複的都不補，所以補完再載入一次不會再寫（冪等）。 */
export function autoSeedOps(userId: string, existing: readonly Row[], loadedFromServer: boolean): RowOp[] {
  if (existing.length === 0) return catalogInsertOps(userId, existing)
  if (!loadedFromServer) return []
  const have = new Set(existing.map((r) => r.id))
  const core = indexOf(userId).ids.slice(0, PRESET_EXERCISES.length)
  return core.every((id) => have.has(id)) ? catalogInsertOps(userId, existing) : []
}

/** 肌群的單字（沒有圖的動作用它當縮圖）。 */
export const MUSCLE_GLYPH: Readonly<Record<MuscleGroup, string>> = {
  chest: '胸',
  back: '背',
  legs: '腿',
  shoulder: '肩',
  arms: '臂',
  core: '腹',
  other: '他',
}

/** 資料異常（肌群不在七類）時落在「其他」，與清單歸類一致。 */
export const glyphOf = (group: unknown): string =>
  MUSCLE_GLYPH[(MUSCLE_GROUPS as readonly string[]).includes(String(group)) ? (group as MuscleGroup) : 'other']
