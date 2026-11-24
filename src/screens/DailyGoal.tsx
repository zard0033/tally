/* 每日目標頁（v2.163，spec.md「每日目標改版：目標體重＋速度滑桿」，樣張 _design-sample/goal-v3.html D2）。

   這頁只做規劃：使用者能動的只有**目標體重**與**速度**，頂端結果卡回答「每天吃多少、幾月到」，結果只出現一次。
   速度是輸入、日期是結果（用日期設定的話，落後會逼每天吃得更少，見 spec）。減重／維持／增重不再是選項，
   改目標體重時由它跟平均體重推方向、寫回 goal（computeTargets 照舊只讀 goal＋rate）。
   v2.118 照算式排的內容（① 維持熱量 → ③ 怎麼分、身體數據、自訂、算式）原樣收進最下面「怎麼算的」。
   **只送改動的那個欄位**：沒碰過的欄位根本不會寫，所以為了顯示取的近似值不可能蓋掉資料庫的真實值。
   維持熱量只有一個在用：存下的回推值，沒有就是公式。第一次從公式換過去、或差很多時要按「改用」才生效；
   差得不多時 App 每週自己往回推值移一半（v2.143，spec「每日目標省心」），每次變動都可以一按還原。 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Slider } from '@base-ui/react/slider'
import {
  ACTIVITY_FACTOR_PRESETS,
  computeTargets,
  FAT_G_PER_KG,
  num,
  numOrNull,
  PROTEIN_G_PER_KG_PRESETS,
  rateWeeklyToMonthly,
  RATE_PRESETS_KG_PER_MONTH,
  type Goal,
} from '@/lib/formulas'
import type { ProfileRow, Weight } from '@/lib/api'
import { errMsg, friendlyError } from '@/lib/errors'
import { checkBodyBasics, checkCustomTargets } from '@/lib/goalForm'
import { localDate } from '@/lib/dates'
import { trendPoints } from '@/lib/weightTrend'
import {
  arrivalText,
  directionOf,
  gapText,
  GOAL_MAX_KG,
  GOAL_MIN_KG,
  GOAL_STEP_KG,
  monthlyOf,
  reached,
  snapGoal,
  weeklyRate,
} from '@/lib/goalPlan'
import SegmentedControl from '@/components/SegmentedControl'
import SubPageTop from '@/components/SubPageTop'
import { adviceContext, adviceOf, type MaintenanceEstimate } from '@/useMaintenanceEstimate'
import MaintenanceSection, { CalcDetail, ConfirmCard, CustomCompare } from './MaintenanceCard'

/** 衛福部標準活動量表的五段係數＋說詞，跟 formulas.ts 的 ACTIVITY_FACTOR_PRESETS 一一對應。 */
const ACTIVITY_LABELS = ['久坐不動', '輕度活動', '中度活動', '高度活動', '非常活躍']
const activityName = (v: number) => {
  const i = ACTIVITY_FACTOR_PRESETS.findIndex((p) => p === v)
  return i >= 0 ? ACTIVITY_LABELS[i] : ''
}
const activityLabel = (v: number) => (activityName(v) ? `${v}（${activityName(v)}）` : `${v}`)
/** 目標體重那行的方向字（v2.163 用「增重」：方向由體重推，不是由訓練目的）。 */
const DIR_LABEL: Record<Goal, string> = { cut: '減重', maintain: '維持', bulk: '增重' }

/** 「已儲存」閃多久：只是回報，時間是假設值，夠看到就好。 */
const SAVED_FLASH_MS = 1500
/** kg/週 存進 numeric(3,2) 再換回 kg/月 會有誤差（0.5 → 0.12 → 0.52），這個範圍內算同一格；格距是 0.25。 */
const RATE_MATCH_KG_PER_MONTH = 0.03
const fmtKg = (kg: number) => (Math.round(kg * 10) / 10).toFixed(1)
/** 手指在滑桿上垂直移動超過這麼多、而且比水平多，就當成捲頁面（假設值：一般觸控 slop 約 8–10px）。 */
const SCROLL_SLOP_PX = 10
/** 滑桿停在哪一格：DB 值對不上任何一格（舊值 2.17 kg/月）時停在最接近的那格，但標籤照寫真實值、不寫回去。 */
function rateIndex(kgPerMonth: number | null): { index: number; exact: boolean } {
  if (kgPerMonth === null || !Number.isFinite(kgPerMonth)) return { index: 0, exact: false }
  let best = 0
  RATE_PRESETS_KG_PER_MONTH.forEach((p, i) => {
    if (Math.abs(p - kgPerMonth) < Math.abs(RATE_PRESETS_KG_PER_MONTH[best] - kgPerMonth)) best = i
  })
  return { index: best, exact: Math.abs(RATE_PRESETS_KG_PER_MONTH[best] - kgPerMonth) <= RATE_MATCH_KG_PER_MONTH }
}
const finiteOrNull = (n: number | null | undefined) => (n !== null && n !== undefined && Number.isFinite(n) ? n : null)

/** 空字串要是 NaN，不能是 Number('') 的 0：出生年 0 歲會讓年齡算成兩千多歲，變成閃一個離譜的熱量而不是 —。 */
const reqNum = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()))
const textOf = (v: unknown) => String(numOrNull(v) ?? '')

/** 選單的選項：DB 值對不上任何一格時（舊值、速度換算誤差）多列一項顯示真實值，不假裝它是最接近的那格。 */
function choices(presets: readonly number[], value: number, tolerance = 0.0001) {
  const match = presets.find((p) => Math.abs(p - value) <= tolerance)
  if (match !== undefined || !Number.isFinite(value)) return { list: [...presets], selected: match ?? presets[0] }
  const shown = Math.round(value * 100) / 100
  return { list: [...presets, shown].sort((a, b) => a - b), selected: shown }
}

const CHEV = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>

interface PickRowProps {
  id: string
  label: string
  shown: string
  /** 值後面的淡色補充（蛋白質換算成的克數）。 */
  extra?: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}

/** 一列：左標籤、右目前值，整列是原生 select 的命中區，iOS 叫出系統滾輪。 */
function PickRow({ id, label, shown, extra, value, onChange, children }: PickRowProps) {
  return (
    <label className="goal-pick" htmlFor={id}>
      <span className="lb">{label}</span>
      <span className="val">{shown}{extra && <small>{extra}</small>}</span>
      {CHEV}
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  )
}

function field(opts: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field-float" style={{ marginBottom: 0 }}>
      <input
        id={opts.id}
        type="text"
        inputMode="decimal"
        placeholder=" "
        value={opts.value}
        onChange={(e) => opts.onChange(e.target.value)}
      />
      <label htmlFor={opts.id}>{opts.label}<span className="req">*</span></label>
    </div>
  )
}

export interface DailyGoalProps {
  profile: ProfileRow
  latestWeight: Weight
  /** 設定頁撈的體重清單（算平均體重用）：null＝還在撈，[]＝沒有紀錄或撈不到。 */
  weights: Weight[] | null
  estimate: MaintenanceEstimate
  onSaveProfile: (patch: Partial<ProfileRow>) => Promise<void>
  onSaveLost: (message: string) => void
  onBack: () => void
  onOpenBodyUpdate: () => void
}

export default function DailyGoal(props: DailyGoalProps) {
  const { profile, latestWeight, weights, estimate, onSaveProfile, onSaveLost, onBack, onOpenBodyUpdate } = props

  /* 還沒回來的改動疊在 profile 上：畫面當場跟著變，失敗就把那幾欄拿掉，自然退回原值。 */
  const [local, setLocal] = useState<Partial<ProfileRow>>({})
  const [isCustom, setIsCustom] = useState(profile.use_custom_targets)
  const [custom, setCustom] = useState({
    kcal: textOf(profile.custom_kcal),
    protein: textOf(profile.custom_protein_g),
    fat: textOf(profile.custom_fat_g),
    carb: textOf(profile.custom_carb_g),
  })
  const [basics, setBasics] = useState({ birthYear: textOf(profile.birth_year), height: textOf(profile.height_cm) })
  /* 離開再進來時前一筆可能還在路上，拿到的 profile 是舊的、落地才換新。上面三個是自己的 state，不跟著換就停在舊值，
     再離開時還會被當成改動寫回去。只換使用者沒動過的（還等於上一份 profile 的）。 */
  const [prevProfile, setPrevProfile] = useState(profile)
  if (prevProfile !== profile) {
    setPrevProfile(profile)
    const follow = (shown: string, key: keyof ProfileRow) => (shown === textOf(prevProfile[key]) ? textOf(profile[key]) : shown)
    if (isCustom === prevProfile.use_custom_targets) setIsCustom(profile.use_custom_targets)
    setCustom((c) => ({
      kcal: follow(c.kcal, 'custom_kcal'),
      protein: follow(c.protein, 'custom_protein_g'),
      fat: follow(c.fat, 'custom_fat_g'),
      carb: follow(c.carb, 'custom_carb_g'),
    }))
    setBasics((b) => ({ birthYear: follow(b.birthYear, 'birth_year'), height: follow(b.height, 'height_cm') }))
  }
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  /** 使用者自己點了「紀錄回推」那一列（數字在範圍內、確認框沒自己跳出來時也能改用）。 */
  const [picked, setPicked] = useState(false)
  /** 拖滑桿途中的那一格：結果卡跟著預覽，放開（onValueCommitted）才存、才清回 null。 */
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  /** 目標體重數字框打到一半的字；null＝沒在打，顯示存下的值。 */
  const [goalDraft, setGoalDraft] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  /** 給讀屏的一句話：滑桿放開、目標體重存下時才換（拖動中每一格都播會吵）。 */
  const [said, setSaid] = useState('')
  /** 這次觸控手勢：垂直移動比水平多（捲頁面）或被瀏覽器取消，就整次作廢——Base UI 的 Slider 不聽
      pointercancel／touchcancel，touchstart 就把值設到手指位置、touchend 照樣 commit，不擋的話從滑桿上開始捲頁面會改到速度。 */
  const gestureRef = useRef<{ x: number; y: number; cancelled: boolean } | null>(null)
  const today = useMemo(() => localDate(), [])
  /* 「現在」＝平均體重（同體重趨勢頁的大數字，2026-11-23 裁決）：差距、方向、幾月到都用它；目標熱量照舊用最新一筆。
     undefined＝清單還在撈；null＝撈不到或沒有（App 保證有最新一筆，這兩種情況退回用它，見 nowKg）。 */
  const avgKg = useMemo<number | null | undefined>(() => {
    if (weights === null) return undefined
    const pts = trendPoints(weights, 'all', today)
    return pts.length > 0 ? pts[pts.length - 1].trend : null
  }, [weights, today])

  /* 只有離開整組欄位才檢查與儲存：依序填到一半切下一格不算，不然第一格填完就跳紅字。 */
  const leavingForm = (e: React.FocusEvent<HTMLFormElement>) => !e.currentTarget.contains(e.relatedTarget as Node | null)
  const editCustom = (key: keyof typeof custom) => (v: string) => {
    setErr(null)
    setCustom((c) => ({ ...c, [key]: v }))
  }
  const editBasics = (key: keyof typeof basics) => (v: string) => {
    setErr(null)
    setBasics((b) => ({ ...b, [key]: v }))
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const savedTimer = useRef<number | undefined>(undefined)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      window.clearTimeout(savedTimer.current)
    }
  }, [])

  /* 同時只送一筆：連改時後面的併成一包，同一欄只留最後一次，回來才送下一包。 */
  const inflightRef = useRef(false)
  const queuedRef = useRef<Partial<ProfileRow> | null>(null)
  /** 失敗過、還沒被後來的存檔補上的欄位：補上了錯誤才收掉，別筆成功不能把它洗掉。 */
  const failedKeysRef = useRef(new Set<string>())

  function settleFailed(keys: string[]) {
    if (failedKeysRef.current.size === 0) return
    for (const k of keys) failedKeysRef.current.delete(k)
    if (failedKeysRef.current.size === 0) setErr(null)
  }

  async function flush() {
    if (inflightRef.current || !queuedRef.current) return
    const patch = queuedRef.current
    queuedRef.current = null
    inflightRef.current = true
    try {
      await onSaveProfile(patch)
      // profile 已經是新的了：沒被後來的改動蓋掉的欄位不用再疊
      setLocal((prev) => {
        const next = { ...prev } as Record<string, unknown>
        for (const [k, v] of Object.entries(patch)) if (next[k] === v) delete next[k]
        return next as Partial<ProfileRow>
      })
      if (!queuedRef.current) {
        setSaved(true)
        window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_FLASH_MS)
      }
      const settled = Object.keys(patch)
      // 這兩種成功會讓失敗的欄位整列消失，留著錯誤就再也收不掉
      if (patch.goal === 'maintain') settled.push('rate_kg_per_week')
      if (numOrNull(patch.measured_tdee) !== null) settled.push('activity_factor')
      settleFailed(settled)
    } catch (e) {
      const message = friendlyError(errMsg(e))
      if (!mountedRef.current) {
        onSaveLost(message)
        return
      }
      // 只退回值還是這筆的欄位：同一欄後面又改了的話，畫面要留著新的
      setLocal((prev) => {
        const next = { ...prev } as Record<string, unknown>
        for (const [k, v] of Object.entries(patch)) if (next[k] === v) delete next[k]
        return next as Partial<ProfileRow>
      })
      for (const k of Object.keys(patch)) failedKeysRef.current.add(k)
      // 切回自動失敗＝實際目標還是自訂的，畫面要留在自訂；切到自訂失敗就留著讓人重試，填的值不能不見
      // 後面還排著另一個「切回自動」就不拉回來：那才是使用者最後按的
      const queued = queuedRef.current as Partial<ProfileRow> | null
      if (patch.use_custom_targets === false && queued?.use_custom_targets !== false) setIsCustom(true)
      setSaved(false)
      setErr(message)
    } finally {
      inflightRef.current = false
      void flush()
    }
  }

  function save(patch: Partial<ProfileRow>) {
    // 有欄位失敗還沒補上時留著錯誤：改別欄成功不能把它洗掉
    if (failedKeysRef.current.size === 0) setErr(null)
    setSaved(false)
    setLocal((prev) => ({ ...prev, ...patch }))
    queuedRef.current = { ...queuedRef.current, ...patch }
    void flush()
  }

  const effective = { ...profile, ...local }
  const weightKg = num(latestWeight.weight_kg)
  const bodyFatPct = latestWeight.body_fat_pct

  /* 算不出來（出生年還沒填完）就讓它是 NaN，畫面顯示 —，不跳錯誤：擋不合理值是失焦時才做的事。 */
  const raw = computeTargets(
    {
      ...effective,
      // 拖滑桿途中預覽那一格（還沒存）
      ...(dragIdx !== null ? { rate_kg_per_week: weeklyRate(RATE_PRESETS_KG_PER_MONTH[dragIdx]) } : {}),
      use_custom_targets: false,
      birth_year: reqNum(basics.birthYear),
      height_cm: reqNum(basics.height),
    },
    weightKg,
    bodyFatPct,
  )
  const preview = Number.isFinite(raw.kcal) ? raw : null

  const customKcal = reqNum(custom.kcal)
  const customValid =
    checkCustomTargets({
      kcal: customKcal,
      proteinG: reqNum(custom.protein),
      fatG: reqNum(custom.fat),
      carbG: reqNum(custom.carb),
    }) === null
  const customDirty = !(
    effective.use_custom_targets &&
    num(effective.custom_kcal) === customKcal &&
    num(effective.custom_protein_g) === reqNum(custom.protein) &&
    num(effective.custom_fat_g) === reqNum(custom.fat) &&
    num(effective.custom_carb_g) === reqNum(custom.carb)
  )
  const basicsDirty =
    bodyFatPct === null && (reqNum(basics.birthYear) !== num(effective.birth_year) || reqNum(basics.height) !== num(effective.height_cm))
  const customSum = (reqNum(custom.protein) || 0) * 4 + (reqNum(custom.fat) || 0) * 9 + (reqNum(custom.carb) || 0) * 4

  const goal = effective.goal
  const rateWeekly = numOrNull(effective.rate_kg_per_week)
  const plannedKgPerWeek = isCustom || goal === 'maintain' || rateWeekly === null ? null : goal === 'cut' ? -rateWeekly : rateWeekly
  const measuredOn = effective.measured_tdee_on
  const usingMeasured = numOrNull(effective.measured_tdee) !== null

  const inUseTdee = isCustom ? null : (preview?.tdee ?? null)
  const advice = adviceOf(estimate, adviceContext(effective, isCustom ? null : preview))
  /* 最新 28 天算得出來就能改用：要人判斷時自己展開確認框（advice 'ask'），其餘不打擾，但點那一列照樣可以改用。
     改用一律只移一半（advice.next），跟自動調整同一個步伐。 */
  const current = advice !== null && advice.result.status === 'ok' ? advice.result : null
  const adopted = advice !== null && 'next' in advice ? advice.next : null
  const afterKcal = adopted !== null
    ? computeTargets({ ...effective, use_custom_targets: false, birth_year: reqNum(basics.birthYear), height_cm: reqNum(basics.height), measured_tdee: adopted }, weightKg, bodyFatPct).kcal
    : null
  const confirmShown = !isCustom && current !== null && preview !== null && afterKcal !== null &&
    ((advice?.kind === 'ask' && !dismissed) || picked)

  /* 判斷一律看 effective（含還沒回來的改動），看 profile 會在請求途中做出錯的決定。 */
  function pickMode(key: 'auto' | 'custom') {
    // 切模式內容長短會變：捲到「怎麼算的」這段的頂端，自訂第一格／維持熱量那段不會被捲走（切換鈕在這段裡，v2.163）
    const sc = scrollRef.current
    const more = moreRef.current
    if (sc && more) sc.scrollTop += more.getBoundingClientRect().top - sc.getBoundingClientRect().top
    failedKeysRef.current.clear()
    setPicked(false) // 點開過確認框又切模式：回來時不該自己又打開
    setErr(null)
    if (key === 'custom') {
      setIsCustom(true)
      if (customValid && !effective.use_custom_targets) saveCustom()
      return
    }
    setIsCustom(false)
    if (isCustom && customValid && customDirty) saveCustom() // 還沒存的值先存，自訂值要留著
    if (effective.use_custom_targets || (isCustom && customValid && customDirty)) save(withRate({ use_custom_targets: false }, goal))
  }

  /** iOS Safari 點按鈕不會讓輸入框失焦，返回與開 sheet 都等不到 onBlur，改到一半的值會靜默不見。
   *  離開前主動存；不合法的半成品照舊丟棄，因為資料庫還是對的值。 */
  function commitTyped() {
    if (goalDraft !== null) commitGoalDraft(goalDraft) // 目標體重打到一半也一樣（v2.163）
    if (isCustom) {
      if (customValid && customDirty) saveCustom()
      return
    }
    if (!basicsDirty) return
    const birthYear = reqNum(basics.birthYear)
    const height = reqNum(basics.height)
    if (checkBodyBasics({ birthYear, height }, new Date().getFullYear()) !== null) return
    const patch: Partial<ProfileRow> = {}
    if (birthYear !== num(effective.birth_year)) patch.birth_year = birthYear
    if (height !== num(effective.height_cm)) patch.height_cm = height
    save(patch)
  }

  /** 資料庫可能沒有速度（舊資料）：減重／增肌沒有速度會算不出目標，每次開 app 都卡在錯誤畫面。
   *  看已落地的 profile，不看 local：帶著速度的前一筆可能失敗，後一筆不帶就會存成有目標沒速度。 */
  function withRate(patch: Partial<ProfileRow>, nextGoal: Goal): Partial<ProfileRow> {
    if (nextGoal === 'maintain' || numOrNull(profile.rate_kg_per_week) !== null) return patch
    return { ...patch, rate_kg_per_week: rateWeekly ?? weeklyRate(RATE_PRESETS_KG_PER_MONTH[0]) }
  }

  function saveCustom() {
    save({
      use_custom_targets: true,
      custom_kcal: customKcal,
      custom_protein_g: reqNum(custom.protein),
      custom_fat_g: reqNum(custom.fat),
      custom_carb_g: reqNum(custom.carb),
    })
  }

  function blurCustom() {
    const invalid = checkCustomTargets({
      kcal: customKcal,
      proteinG: reqNum(custom.protein),
      fatG: reqNum(custom.fat),
      carbG: reqNum(custom.carb),
    })
    if (invalid) return setErr(invalid)
    setErr(null)
    if (customDirty) saveCustom()
    else settleFailed(['use_custom_targets', 'custom_kcal', 'custom_protein_g', 'custom_fat_g', 'custom_carb_g'])
  }

  function blurBasics() {
    const birthYear = reqNum(basics.birthYear)
    const height = reqNum(basics.height)
    const invalid = checkBodyBasics({ birthYear, height }, new Date().getFullYear())
    if (invalid) return setErr(invalid)
    setErr(null)
    const patch: Partial<ProfileRow> = {}
    if (birthYear !== num(effective.birth_year)) patch.birth_year = birthYear
    if (height !== num(effective.height_cm)) patch.height_cm = height
    if (Object.keys(patch).length > 0) save(patch)
    else settleFailed(['birth_year', 'height_cm'])
  }

  /* ── 目標體重與速度（v2.163） ── */
  const goalKg = numOrNull(effective.goal_weight_kg)
  /** 「現在」：平均體重；清單還在撈或撈不到時退回最新一筆（畫面上照實寫「最近一次」，不寫成平均）。 */
  const nowIsAvg = avgKg != null
  const nowKg = avgKg ?? weightKg
  /** 步進器顯示的值：沒設過就從「現在」起（對齊 0.5），動了才寫。 */
  const goalShown = goalKg ?? snapGoal(nowKg)

  /** 寫目標體重：方向由它跟「現在」推、一起寫回 goal。 */
  function saveGoalKg(next: number) {
    const kg = Math.min(GOAL_MAX_KG, Math.max(GOAL_MIN_KG, Math.round(next * 10) / 10))
    setGoalDraft(null)
    if (kg === goalKg) return
    const dir = directionOf(kg, nowKg)
    save(withRate({ goal_weight_kg: kg, goal: dir }, dir))
    setSaid(`目標體重 ${fmtKg(kg)} kg，${DIR_LABEL[dir]}`)
  }
  function stepGoal(dir: 1 | -1) {
    saveGoalKg(snapGoal(goalShown + dir * GOAL_STEP_KG))
  }
  function commitGoalDraft(raw: string) {
    const t = raw.trim().replace(/[，,]/, '.') // 「70,5」也收（有些鍵盤的小數點是逗號）
    const v = Number(t)
    if (t === '' || !Number.isFinite(v) || v < GOAL_MIN_KG || v > GOAL_MAX_KG) {
      setGoalDraft(null)
      return setErr(`目標體重要在 ${GOAL_MIN_KG}–${GOAL_MAX_KG} kg 之間`)
    }
    // 只收掉自己的驗證錯誤：別欄存檔失敗的提示要留到那欄補上（save 裡的規則）
    if (failedKeysRef.current.size === 0) setErr(null)
    saveGoalKg(v)
  }

  const storedMonthly = monthlyOf(rateWeekly)
  const slider = rateIndex(storedMonthly)
  /** 結果卡用的速度：拖動中用那一格，否則用存下的。 */
  const shownMonthly = dragIdx !== null ? RATE_PRESETS_KG_PER_MONTH[dragIdx] : storedMonthly
  /** 滑桿下的「每月 1 kg」：拖動中或對得上格子寫格子值，對不上（舊值）照寫真實值。 */
  const paceText = shownMonthly === null ? '—'
    : dragIdx !== null || slider.exact ? `${RATE_PRESETS_KG_PER_MONTH[dragIdx ?? slider.index]}` : `${Math.round(shownMonthly * 100) / 100}`
  function commitRate(idx: number) {
    const g = gestureRef.current
    gestureRef.current = null
    setDragIdx(null)
    if (g?.cancelled) return // 這次是捲頁面（或被瀏覽器取消），不算
    if (slider.exact && idx === slider.index) return // 沒換格不寫
    const p = RATE_PRESETS_KG_PER_MONTH[idx]
    save({ rate_kg_per_week: weeklyRate(p) })
    const at = goalKg !== null && goal !== 'maintain' ? arrivalText(today, goal, goalKg, nowKg, p) : null
    setSaid(`每月 ${p} kg${at ? `，${at}到` : ''}`)
  }
  function cancelGesture() {
    if (gestureRef.current) gestureRef.current.cancelled = true
    setDragIdx(null)
  }

  const rate = choices(RATE_PRESETS_KG_PER_MONTH, rateWeeklyToMonthly(rateWeekly ?? NaN), RATE_MATCH_KG_PER_MONTH)
  const activity = choices(ACTIVITY_FACTOR_PRESETS, num(effective.activity_factor))
  const protein = choices(PROTEIN_G_PER_KG_PRESETS, num(effective.protein_g_per_kg))

  /* ── 結果卡的日期行（v2.163）：「4 月初到 66 kg」；到了換「到 66 kg 了」＋「改成維持」（按了才改，熱量一次跳 130–380 卡） ── */
  const isReached = goalKg !== null && reached(goal, goalKg, nowKg)
  let whenLine: React.ReactNode = null
  if (goalKg === null) whenLine = '設一個目標體重，就算得出幾月到'
  else if (goal === 'maintain') whenLine = <>維持在 <b>{fmtKg(goalKg)}</b> kg</>
  else if (isReached) whenLine = <>到 <b>{fmtKg(goalKg)}</b> kg 了</>
  else {
    const at = shownMonthly !== null ? arrivalText(today, goal, goalKg, nowKg, shownMonthly) : null
    whenLine = at ? <><b>{at}</b>到 {fmtKg(goalKg)} kg</> : null
  }

  const heroKcal = isCustom ? (Number.isFinite(customKcal) ? customKcal : null) : (preview?.kcal ?? null)
  const customSource = !customValid ? '填完才生效' : customDirty ? '未儲存' : '自己填的，不從維持熱量算'
  const autoSource = usingMeasured ? '用你最近 28 天的紀錄算的' : '用公式估的，可能偏樂觀'

  /* 每種變動都蓋今天的日期（7 天內不再自動也不問，不然還原完下次開 App 又被調回去）、記下變動前的值給「還原」。 */
  const measuredNow = numOrNull(effective.measured_tdee)
  function adopt() {
    if (adopted === null) return
    setPicked(false)
    setDismissed(false)
    save({ measured_tdee: adopted, measured_tdee_on: localDate(), measured_tdee_prev: measuredNow })
  }
  function revert() {
    setPicked(false)
    setDismissed(true)
    save({ measured_tdee: null, measured_tdee_on: localDate(), measured_tdee_prev: measuredNow })
  }
  function restore() {
    setPicked(false)
    setDismissed(true)
    save({ measured_tdee: numOrNull(effective.measured_tdee_prev), measured_tdee_prev: null, measured_tdee_on: localDate() })
  }

  const activityRow = (
    <label className="goal-sub-pick" htmlFor="g-activity">
      <span className="lb">平常活動量</span>
      <span className="val">{activity.selected}<small>{activityName(activity.selected)}</small></span>
      {CHEV}
      <select id="g-activity" aria-label="平常活動量" value={String(activity.selected)} onChange={(e) => save({ activity_factor: Number(e.target.value) })}>
        {activity.list.map((v) => <option key={v} value={v}>{activityLabel(v)}</option>)}
      </select>
    </label>
  )

  return (
    <div className="main" data-screen="daily-goal">
      <SubPageTop title="每日目標" backLabel="返回設定" onBack={() => { commitTyped(); onBack() }} />

      {/* 結果卡：固定在捲動區上面，拖滑桿、改目標體重時數字當場跟著變。結果只在這裡出現一次。 */}
      <div className="goal-hero">
        <div className="goal-hero-cap">每天吃</div>
        <div>
          <span className="gauge-num">{heroKcal !== null ? Math.round(heroKcal) : '—'}</span>
          <span className="gauge-unit">卡</span>
        </div>
        <div className="goal-hero-macros">
          {isCustom
            ? `蛋白 ${custom.protein || 0}g・脂肪 ${custom.fat || 0}g・碳水 ${custom.carb || 0}g`
            : preview
              ? `蛋白 ${Math.round(preview.protein)}g・脂肪 ${Math.round(preview.fat)}g・碳水 ${Math.round(preview.carb)}g`
              : '欄位還沒填完，先看不出目標'}
        </div>
        <div className="goal-hero-when">{whenLine}</div>
        <span className="sr-only" role="status" aria-live="polite">{said}</span>
        {/* 改成維持：目標體重一起換成現在（捨到 0.1），方向行才會讀成「維持」；自訂時速度與方向不影響熱量，不出 */}
        {isReached && !isCustom && (
          <button
            type="button"
            className="goal-btn primary goal-reached-btn"
            onClick={() => {
              const kg = Math.round(nowKg * 10) / 10
              save({ goal: 'maintain', goal_weight_kg: kg })
              setSaid(`改成維持在 ${fmtKg(kg)} kg`)
            }}
          >
            改成維持
          </button>
        )}
        <div className="goal-hero-src">
          <span className="goal-hero-eq">{isCustom ? customSource : autoSource}</span>
          <span className={basicsDirty && !isCustom ? 'goal-unsaved' : 'goal-saved'} role="status">
            {basicsDirty && !isCustom ? '未儲存' : saved ? '已儲存' : ''}
          </span>
        </div>
      </div>

      {err && <p className="sheet-error goal-err" role="alert">{err}</p>}

      <div className="form-wrap goal-scroll" style={{ paddingTop: 0 }} ref={scrollRef}>
        {/* 確認卡（每日目標省心）：照原本的判斷，有待確認的變動才出，放在結果卡正下方 */}
        {!isCustom && confirmShown && current && preview && afterKcal !== null && adopted !== null && inUseTdee !== null && (
          <ConfirmCard
            result={current}
            beforeKcal={preview.kcal}
            afterKcal={afterKcal}
            inUseTdee={inUseTdee}
            nextTdee={adopted}
            usingMeasured={usingMeasured}
            bmr={finiteOrNull(preview.bmr)}
            plannedKgPerWeek={plannedKgPerWeek}
            onAdopt={adopt}
            onDismiss={() => { setPicked(false); setDismissed(true) }}
          />
        )}

        {/* 兩個控制：目標體重、要多快 */}
        <div className="goal-group goal-plan">
          <div className="goal-plan-h">
            <span id="g-goal-weight-lb">目標體重</span>
            <span className="goal-plan-now">{nowIsAvg ? '現在' : '最近一次'} {fmtKg(nowKg)} kg</span>
          </div>
          <div className="goal-plan-step qty-stepper" role="group" aria-labelledby="g-goal-weight-lb">
            <button className="qty-btn" type="button" aria-label="目標體重減 0.5 kg" disabled={goalShown <= GOAL_MIN_KG} onClick={() => stepGoal(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <span className="goal-wt">
              <input
                id="g-goal-weight"
                className="qty-value"
                type="text"
                inputMode="decimal"
                aria-label="目標體重（kg）"
                value={goalDraft ?? fmtKg(goalShown)}
                onChange={(e) => setGoalDraft(e.target.value)}
                onBlur={(e) => { if (goalDraft !== null) commitGoalDraft(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              />
              <small>kg</small>
            </span>
            <button className="qty-btn" type="button" aria-label="目標體重加 0.5 kg" disabled={goalShown >= GOAL_MAX_KG} onClick={() => stepGoal(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <p className="goal-plan-dir">
            {goalKg === null ? '還沒設目標體重' : `${gapText(goalKg, nowKg)} · ${isReached ? '已到目標' : DIR_LABEL[goal]}`}
          </p>

          {goal !== 'maintain' && (
            <div className="goal-pace">
              <div className="goal-plan-h"><span>要多快</span></div>
              {/* 觸控手勢的判斷包在外面一層（Base UI 的 Control 自己的 pointer／touch 處理不動）：垂直多於水平＝捲頁面、作廢 */}
              <div
                className="goal-slider-wrap"
                onTouchStartCapture={(e) => {
                  const t = e.touches[0]
                  gestureRef.current = t ? { x: t.clientX, y: t.clientY, cancelled: false } : null
                }}
                onTouchMoveCapture={(e) => {
                  const g = gestureRef.current
                  const t = e.touches[0]
                  if (!g || !t || g.cancelled) return
                  const dx = Math.abs(t.clientX - g.x)
                  const dy = Math.abs(t.clientY - g.y)
                  if (dy > SCROLL_SLOP_PX && dy > dx) cancelGesture()
                }}
                onTouchCancelCapture={cancelGesture}
                onPointerCancelCapture={cancelGesture}
                onBlurCapture={() => { if (dragIdx !== null) setDragIdx(null) }}
              >
              <Slider.Root
                className="goal-slider"
                min={0}
                max={RATE_PRESETS_KG_PER_MONTH.length - 1}
                step={1}
                largeStep={1}
                value={dragIdx ?? slider.index}
                disabled={isCustom}
                onValueChange={(v) => { if (!gestureRef.current?.cancelled) setDragIdx(v as number) }}
                onValueCommitted={(v) => commitRate(v as number)}
              >
                <Slider.Control className="goal-slider-ctl">
                  <Slider.Track className="goal-slider-track">
                    <Slider.Indicator className="goal-slider-fill" />
                    {RATE_PRESETS_KG_PER_MONTH.map((p, i) => (
                      <span key={p} className="goal-slider-tick" aria-hidden="true" style={{ left: `${(i / (RATE_PRESETS_KG_PER_MONTH.length - 1)) * 100}%` }} />
                    ))}
                    <Slider.Thumb
                      className="goal-slider-thumb"
                      getAriaLabel={() => '要多快'}
                      getAriaValueText={(_f, v) => `每月 ${v === (dragIdx ?? slider.index) ? paceText : RATE_PRESETS_KG_PER_MONTH[v]} kg`}
                    />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
              </div>
              <div className="goal-slider-ends" aria-hidden="true"><span>慢 · 吃多一點</span><span>快 · 吃少一點</span></div>
              <p className="goal-pace-now">每月 <b>{paceText}</b> kg</p>
              {isCustom && <p className="goal-pace-note">用自己填的目標時，速度不影響熱量</p>}
            </div>
          )}
        </div>

        {/* 其餘原樣收進「怎麼算的」：維持熱量、蛋白質、身體數據、自己填目標、算式 */}
        <details className="goal-group goal-more" ref={moreRef} open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary className="goal-pick">
            <span className="lb">怎麼算的<small>維持熱量、蛋白質、身體數據、自己填目標</small></span>{CHEV}
          </summary>
          <div className="goal-more-body">
            <div className="goal-seg-wrap">
              <SegmentedControl
                label="目標計算方式"
                items={[{ key: 'auto', label: '自動' }, { key: 'custom', label: '自訂' }]}
                value={isCustom ? 'custom' : 'auto'}
                onPick={pickMode}
              />
            </div>
            {isCustom ? (
              <>
                <form className="goal-custom" onSubmit={(e) => { e.preventDefault(); blurCustom() }} onBlur={(e) => { if (leavingForm(e)) blurCustom() }}>
                  {field({ id: 'g-custom-kcal', label: '熱量（卡）', value: custom.kcal, onChange: editCustom('kcal') })}
                  <div className="goal-macro-grid">
                    {field({ id: 'g-custom-protein', label: '蛋白 g', value: custom.protein, onChange: editCustom('protein') })}
                    {field({ id: 'g-custom-fat', label: '脂肪 g', value: custom.fat, onChange: editCustom('fat') })}
                    {field({ id: 'g-custom-carb', label: '碳水 g', value: custom.carb, onChange: editCustom('carb') })}
                  </div>
                  {customValid && (
                    <p className="goal-sum">
                      三大營養素加起來 <b>{Math.round(customSum)}</b> 卡
                      {Math.round(customSum) === Math.round(customKcal)
                        ? '，和熱量一致'
                        : `，比熱量${customSum > customKcal ? '多' : '少'} `}
                      {Math.round(customSum) !== Math.round(customKcal) && <><b>{Math.abs(Math.round(customSum - customKcal))}</b> 卡</>}
                    </p>
                  )}
                </form>
                <CustomCompare estimate={estimate} targetKcal={heroKcal} />
              </>
            ) : (
              <>
                <MaintenanceSection
                  estimate={estimate}
                  inUseTdee={inUseTdee}
                  formulaTdee={finiteOrNull(preview?.formulaTdee)}
                  bmr={finiteOrNull(preview?.bmr)}
                  activityFactor={activity.selected}
                  usingMeasured={usingMeasured}
                  measuredTdee={measuredNow}
                  measuredOn={measuredOn ?? null}
                  prevTdee={numOrNull(effective.measured_tdee_prev)}
                  askNewer={usingMeasured && advice?.kind === 'ask' && !confirmShown}
                  activityRow={activityRow}
                  onOpenConfirm={() => {
                    setPicked(true)
                    setDismissed(false)
                    // 確認卡在結果卡正下方：從這裡點開要捲回去看得到
                    if (scrollRef.current) scrollRef.current.scrollTop = 0
                  }}
                  onRevert={revert}
                  onRestore={restore}
                />

                <div className="goal-sec">
                  <div className="goal-sec-h">
                    <span className="goal-sec-title">
                      ③ 怎麼分
                      {preview && (
                        <Popover.Root>
                          <Popover.Trigger className="goal-info" aria-label="脂肪和碳水怎麼分">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>
                          </Popover.Trigger>
                          <Popover.Portal>
                            <Popover.Positioner className="goal-pop-pos" side="bottom" align="start" sideOffset={8} collisionPadding={16}>
                              <Popover.Popup className="goal-pop">
                                <Popover.Arrow className="goal-pop-arrow" />
                                脂肪固定每公斤 {FAT_G_PER_KG} g（<b>{Math.round(preview.fat)}</b> g），剩下的熱量都給碳水（<b>{Math.round(preview.carb)}</b> g）。
                              </Popover.Popup>
                            </Popover.Positioner>
                          </Popover.Portal>
                        </Popover.Root>
                      )}
                    </span>
                    <span className="out">蛋白・脂肪・碳水</span>
                  </div>
                  <div className="goal-group">
                    <PickRow
                      id="g-protein"
                      label="蛋白質"
                      shown={`${protein.selected} g/kg`}
                      extra={preview ? `${Math.round(preview.protein)}g` : undefined}
                      value={String(protein.selected)}
                      onChange={(v) => save({ protein_g_per_kg: Number(v) })}
                    >
                      {protein.list.map((v) => <option key={v} value={v}>{v} g/kg</option>)}
                    </PickRow>
                  </div>
                </div>

                {bodyFatPct === null && (
                  <div className="goal-group goal-sec">
                    <div className="goal-group-title">基本資料</div>
                    <form style={{ padding: '0 var(--s-4) var(--s-3)' }} onSubmit={(e) => { e.preventDefault(); blurBasics() }} onBlur={(e) => { if (leavingForm(e)) blurBasics() }}>
                      {field({ id: 'g-birth-year', label: '出生年', value: basics.birthYear, onChange: editBasics('birthYear') })}
                      <div className="field-row" style={{ marginTop: 'var(--s-3)' }}>
                        {field({ id: 'g-height', label: '身高 cm', value: basics.height, onChange: editBasics('height') })}
                        <div className="field-float" style={{ marginBottom: 0, flex: 1 }}>
                          <select id="g-sex" value={effective.sex} onChange={(e) => save({ sex: e.target.value })}>
                            <option value="male">男</option>
                            <option value="female">女</option>
                          </select>
                          <label htmlFor="g-sex">性別</label>
                        </div>
                      </div>
                    </form>
                  </div>
                )}

                <div className="goal-group goal-sec">
                  <button type="button" className="goal-pick as-btn" onClick={() => { commitTyped(); onOpenBodyUpdate() }}>
                    <span className="lb">身體數據</span>
                    <span className="val">{weightKg.toFixed(2)} kg{bodyFatPct !== null && `・${num(bodyFatPct).toFixed(1)}%`}</span>
                    {CHEV}
                  </button>
                </div>

                <details className="goal-group goal-how">
                  <summary className="goal-pick"><span className="lb">算式</span>{CHEV}</summary>
                  {preview && (
                    <CalcDetail
                      estimate={estimate}
                      usingMeasured={usingMeasured}
                      measuredTdee={numOrNull(effective.measured_tdee)}
                      weightKg={weightKg}
                      bodyFatPct={bodyFatPct !== null && Number.isFinite(num(bodyFatPct)) ? num(bodyFatPct) : null}
                      heightCm={reqNum(basics.height)}
                      age={preview.age}
                      sex={effective.sex}
                      bmr={finiteOrNull(preview.bmr)}
                      activityFactor={num(effective.activity_factor)}
                      formulaTdee={finiteOrNull(preview.formulaTdee)}
                      inUseTdee={inUseTdee}
                      goal={goal}
                      rateKgPerMonth={goal === 'maintain' ? null : rate.selected}
                      rateKgPerWeek={rateWeekly}
                      proteinGPerKg={num(effective.protein_g_per_kg)}
                      kcal={preview.kcal}
                      protein={preview.protein}
                      fat={preview.fat}
                      carb={preview.carb}
                      plannedKgPerWeek={plannedKgPerWeek}
                    />
                  )}
                </details>
              </>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
