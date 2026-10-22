/* 動作庫的預設目錄：既有 16 個預填動作（`PRESET_EXERCISES`，新帳號首次預填）加上 134 個常見動作與 2 個有氧動作，共 152 個。
   每個動作有一張縮圖 `src/assets/exercises/<key>.jpg` 與一個示意動畫 `src/assets/exercise-gifs/<key>.gif`
   （Gym visual 的圖；來源與授權見 `scripts/build-exercise-images.mjs` 與 `NOTICE.md`，key→資料集 id 的對照在
   `scripts/exercise-images.json`；徒手深蹲、箱式深蹲、有氧拳擊資料集沒有對應，列在該檔的 `noImage`，見 `NO_IMAGE_KEYS`——
   前兩個退回肌群單字，有氧拳擊由 `ExerciseThumb` 依 kind 畫拳擊手套圖示；跑步機坡度健走有資料集的圖）。
   **有氧動作**（spec「有氧併入動作」D1、D2）：`kind` 是 CARDIO_KINDS 之一，只有這兩個預設動作會是有氧，使用者自建的一律重訓。

   **id 與圖的對應不靠 schema**：預設動作的列 id 是確定性的（`presetExerciseId`：userId＋key 的 uuid v5），
   所以拿列上的 `user_id` 與 `id` 重算一次就知道它是哪個預設動作、該用哪張圖——使用者改名、封存、寫要點都不影響。
   使用者自己新增的動作 id 不在表裡，沒有圖。
   **開 App 載入完自動補**（`autoSeedOps`，不用按按鈕）：空庫補整份、已有 16 個原始預設動作的帳號補其餘缺的、從零自建的不補；
   insert-ignore，不動使用者改過或封存的列；**名稱與既有動作重複的不補**（`checkExercise` 的規則：名稱不能重複，含已封存的）。 */
import {
  MUSCLE_GROUPS,
  PRESET_EXERCISES,
  foldName,
  presetExerciseId,
  type CardioKind,
  type MuscleGroup,
  type Row,
  type RowOp,
} from './training'

export interface CatalogExercise {
  readonly key: string
  readonly name: string
  readonly muscle_group: MuscleGroup
  /** 有氧動作才有；沒有＝重訓。 */
  readonly kind?: CardioKind
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
  // 有氧：名稱與 CARDIO_KIND_LABEL 一致（單元測試鎖住）；接在最後，前面 150 個的順序不動
  { key: 'incline-walk', name: '跑步機坡度健走', muscle_group: 'other', kind: 'incline_walk' },
  { key: 'boxing-cardio', name: '有氧拳擊', muscle_group: 'other', kind: 'boxing' },
]

export const EXERCISE_CATALOG: readonly CatalogExercise[] = [...PRESET_EXERCISES, ...EXTRA_EXERCISES]

interface UserIndex {
  /** 列 id → 預設動作 key。 */
  readonly idToKey: Map<string, string>
  /** 與 `EXERCISE_CATALOG` 同序的列 id。 */
  readonly ids: readonly string[]
}

const indexes = new Map<string, UserIndex>()

/** 該帳號的 id 對照。算 152 次 uuid v5，每個帳號只算一次（搜尋框每打一個字都會重新渲染，不能每次重算）。 */
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

/** 資料集沒有對應圖的預設動作；與 `scripts/exercise-images.json` 的 `noImage` 一致（單元測試鎖住）。
 *  只由對照表決定、不從 kind 推：有氧也可能有圖（坡度健走用資料集的圖，v2.90）。 */
export const NO_IMAGE_KEYS: ReadonlySet<string> = new Set(['bodyweight-squat', 'box-squat', 'boxing-cardio'])

/** 畫面上這一列會不會出現示意圖：是預設動作、而且有圖。著作權標示（GymVisualCredit）用它決定要不要印。 */
export function hasCatalogImage(row: Row): boolean {
  const key = catalogKey(row)
  return key !== null && !NO_IMAGE_KEYS.has(key)
}

/** 動作庫「補齊預設動作」要寫的列：目錄裡、這個帳號還沒有的。每列都帶 `kind`（重訓的寫 'strength'，與伺服器 default 相同；
 *  一律帶才不會同一個函式產出兩種形狀的列，本機疊上佇列時也看得到類型）。「已有」有兩種：
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
      : [{ id: ids[i], user_id: userId, name: p.name, muscle_group: p.muscle_group, kind: p.kind ?? 'strength', tips: null, archived: false }],
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
 *  ① **動作庫是空的**（新帳號）：補整份目錄 152 個。離線也補（排進佇列、insert-ignore，回線才上傳）。
 *  ② **已有全部 16 個原始預設動作**（App 自己預填過的帳號）且**這份動作是從伺服器載到的**：補其餘缺的。
 *     只認伺服器載到的：本機快取可能比伺服器舊，拿舊清單算「缺什麼」會把同名判斷也算歪。
 *  ③ 其他（使用者從零自建、沒有預設動作）：**不補**——那是他刻意建的庫，不該突然多 152 個。
 *  補的內容由 `catalogToAdd` 決定：id 已在、名稱重複的都不補，所以補完再載入一次不會再寫（冪等）。 */
export function autoSeedOps(userId: string, existing: readonly Row[], loadedFromServer: boolean): RowOp[] {
  if (existing.length === 0) return catalogInsertOps(userId, existing)
  if (!loadedFromServer) return []
  const have = new Set(existing.map((r) => r.id))
  const core = indexOf(userId).ids.slice(0, PRESET_EXERCISES.length)
  return core.every((id) => have.has(id)) ? catalogInsertOps(userId, existing) : []
}

/* ═══════════ 加重幅度（重量建議用；spec.md「階段 4 甲」口徑 3）═══════════
   依器材歸類，不給使用者調：槓鈴／EZ 槓／史密斯 5 kg（兩邊各加最小 2.5 kg 槓片）、啞鈴與器械滑輪 2.5 kg、壺鈴 4 kg；
   徒手與有氧動作不給重量建議；使用者自建的動作沒有 key，一律 2.5 kg。這是依常見做法的假設，健身房實際跳格不同時改這張表。 */
const BARBELL_KEYS = [
  'barbell-bench-press', 'incline-barbell-bench-press', 'decline-barbell-bench-press', 'smith-bench-press', 'smith-incline-bench-press',
  'barbell-row', 'reverse-grip-barbell-row', 't-bar-row', 'smith-bent-over-row',
  'barbell-deadlift', 'sumo-deadlift', 'rack-pull', 'romanian-deadlift', 'stiff-leg-deadlift', 'good-morning', 'barbell-shrug',
  'barbell-squat', 'front-squat', 'smith-squat', 'box-squat', 'barbell-lunge', 'walking-lunge', 'barbell-step-up', 'smith-leg-press',
  'hip-thrust', 'glute-bridge', 'standing-barbell-calf-raise', 'smith-calf-raise', 'power-clean',
  'military-press', 'seated-barbell-press', 'smith-shoulder-press', 'upright-row',
  'barbell-curl', 'ez-bar-curl', 'preacher-curl', 'reverse-barbell-curl', 'ez-bar-skullcrusher', 'close-grip-bench-press',
  'barbell-wrist-curl', 'reverse-wrist-curl',
] as const

const DUMBBELL_KEYS = [
  'dumbbell-bench-press', 'incline-dumbbell-press', 'decline-dumbbell-press', 'dumbbell-fly', 'incline-dumbbell-fly',
  'dumbbell-row', 'two-dumbbell-row', 'dumbbell-shrug',
  'goblet-squat', 'dumbbell-squat', 'dumbbell-lunge', 'dumbbell-rear-lunge', 'dumbbell-split-squat', 'dumbbell-step-up',
  'dumbbell-stiff-leg-deadlift', 'dumbbell-calf-raise',
  'dumbbell-shoulder-press', 'arnold-press', 'seated-dumbbell-press', 'side-lateral-raise', 'front-dumbbell-raise', 'rear-delt-raise',
  'dumbbell-reverse-fly', 'dumbbell-upright-row',
  'dumbbell-curl', 'alternate-dumbbell-curl', 'hammer-curl', 'incline-dumbbell-curl', 'concentration-curl', 'zottman-curl',
  'dumbbell-overhead-extension', 'lying-dumbbell-extension', 'triceps-kickback', 'dumbbell-side-bend',
] as const

/** 器械（插銷配重片）與滑輪。 */
const MACHINE_KEYS = [
  'leg-press', 'leg-extension', 'leg-curl', 'calf-raise', 'hip-abduction', 'hip-adduction',
  'lat-pulldown', 'seated-row', 'back-extension', 'chest-press', 'pec-fly', 'shoulder-press', 'reverse-fly', 'biceps-curl', 'triceps-pushdown',
  'ab-crunch',
  'cable-crossover', 'low-cable-crossover', 'cable-chest-press', 'incline-chest-press-machine', 'decline-chest-press-machine',
  'close-grip-lat-pulldown', 'v-bar-pulldown', 'underhand-pulldown', 'one-arm-lat-pulldown', 'straight-arm-pulldown',
  'leverage-high-row', 'leverage-iso-row', 'one-arm-seated-cable-row',
  'hack-squat', 'narrow-leg-press', 'single-leg-extension', 'lying-leg-curl', 'standing-leg-curl',
  'cable-kickback', 'cable-pull-through', 'seated-calf-raise', 'leg-press-calf-raise',
  'machine-shoulder-press', 'cable-lateral-raise', 'front-cable-raise', 'cable-rear-delt-fly', 'face-pull',
  'machine-preacher-curl', 'cable-curl', 'cable-rope-hammer-curl', 'rope-pushdown', 'vbar-pushdown', 'reverse-grip-pushdown',
  'rope-overhead-extension', 'machine-triceps-extension', 'dip-machine',
  'cable-crunch', 'pallof-press', 'cable-wood-chop', 'cable-side-bend',
] as const

const KETTLEBELL_KEYS = ['kettlebell-swing', 'turkish-get-up'] as const

/** 徒手或以自重為主：不給重量建議。 */
const BODYWEIGHT_KEYS = [
  'pushup', 'pullup', 'chinup', 'bodyweight-squat', 'glute-ham-raise', 'dips', 'bench-dips',
  'crunch', 'decline-crunch', 'reverse-crunch', 'sit-up', 'bench-leg-raise', 'russian-twist', 'plank', 'side-plank', 'ab-rollout', 'dead-bug',
] as const

/** 有氧：沒有組、沒有重量（spec「有氧併入動作」D1），不給重量建議。 */
const CARDIO_KEYS = ['incline-walk', 'boxing-cardio'] as const

export const CUSTOM_WEIGHT_STEP = 2.5

const STEP_BY_KEY: ReadonlyMap<string, number | null> = new Map<string, number | null>([
  ...BARBELL_KEYS.map((k): [string, number | null] => [k, 5]),
  ...DUMBBELL_KEYS.map((k): [string, number | null] => [k, 2.5]),
  ...MACHINE_KEYS.map((k): [string, number | null] => [k, 2.5]),
  ...KETTLEBELL_KEYS.map((k): [string, number | null] => [k, 4]),
  ...BODYWEIGHT_KEYS.map((k): [string, number | null] => [k, null]),
  ...CARDIO_KEYS.map((k): [string, number | null] => [k, null]),
])

/** 該動作建議加重時一次加多少 kg；徒手與有氧動作回 null（不給建議）。`key` 是 `catalogKey` 的結果，自建動作（null）用 2.5。 */
export function weightStep(key: string | null): number | null {
  // 不能用 `??`：徒手動作的值本身就是 null，會被當成「沒有這個 key」而變成 2.5
  return key !== null && STEP_BY_KEY.has(key) ? STEP_BY_KEY.get(key)! : CUSTOM_WEIGHT_STEP
}

/** 歸類表涵蓋的 key（單元測試用：必須與 `EXERCISE_CATALOG` 逐一對上，不多不少、不重複）。 */
export const WEIGHT_STEP_KEYS: readonly string[] = [
  ...BARBELL_KEYS, ...DUMBBELL_KEYS, ...MACHINE_KEYS, ...KETTLEBELL_KEYS, ...BODYWEIGHT_KEYS, ...CARDIO_KEYS,
]

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
