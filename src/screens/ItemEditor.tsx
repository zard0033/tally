import { useEffect, useRef, useState } from 'react'
import type { IntakeDetailPatch, IntakeRow } from '@/lib/api'
import { DeleteIcon } from '@/components/DeleteIcon'
import QtyStepper from '@/components/QtyStepper'
import SegmentedControl from '@/components/SegmentedControl'
import { num } from '@/lib/formulas'
import { MEALS, type MealKey } from '@/lib/meals'
import { normalizeQty, parseTypedQty } from '@/lib/quantity'

/* 就地編輯區的數字欄標籤。與新增食物表單同一組字（DESIGN.md「新增食物表單欄位」），
   單位帶在 label 上而不是欄位旁——欄位窄，額外的單位字會擠掉輸入空間。 */
type DetailKey = 'kcal' | 'protein' | 'fat' | 'carb'
/** 上界對齊 DB：那四欄最嚴的是 `numeric(6,2)`，能放到 9999.99 */
const MACRO_MAX = 9999.99
const DETAIL_LABEL: Record<DetailKey, string> = {
  kcal: '熱量（卡）',
  protein: '蛋白質 g',
  fat: '脂肪 g',
  carb: '碳水 g',
}

/* 就地編輯區（v2.20，取代 v2.14 的長按 sheet）。兩排都是 --r-tab 的分段家族：
   上排 qty stepper ＋ 刪除，下排餐別分段控制器。刪除鈕用負 margin 懸出容器的水平
   內距，讓圖示與上一行的熱量數字落在同一條垂直線上——帶框的 stepper／分段器需要
   內距才不會貼壁，無框的圖示不需要，兩者的對齊基準本來就不同。 */
export default function ItemEditor({
  id,
  row,
  name,
  qty,
  openerRef,
  onQty,
  onMeal,
  onDetail,
  onDelete,
  err,
}: {
  id: string
  row: IntakeRow
  name: string
  qty: number
  openerRef: React.RefObject<HTMLButtonElement | null>
  onQty: (qty: number) => Promise<void>
  onMeal: (meal: MealKey) => Promise<void>
  onDetail: (patch: IntakeDetailPatch) => Promise<void>
  onDelete: () => void
  err: string | null
}) {
  const [localQty, setLocalQty] = useState(qty)
  const [draft, setDraft] = useState(String(qty))
  /** 最後一次存成功的值：失敗時回到它。 */
  const savedQty = useRef(qty)
  /** 最後送出的值，是比較「有沒有變」的基準。不能用 savedQty：前一筆還在路上時按 + 再按 −，會被當成沒變而不送，
   *  資料庫停在 + 的結果；也不能用 localQty：打字途中它已經跟著改了。 */
  const sentQty = useRef(qty)
  const inFlight = useRef(0)
  const anyFailed = useRef(false)
  /* 餐別也走樂觀：按下當場就渲染成選中，不等往返。原本 aria-current 綁 row.meal（伺服器
     真值）＋ disabled 只改 cursor，於是慢網路下按「晚餐」畫面上一個 pixel 都不會變，
     使用者會重按（hallmark 與 impeccable 兩個獨立 reviewer 撞在同一條）。 */
  const [localMeal, setLocalMeal] = useState<MealKey>(row.meal)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  /* 收合時把焦點還給品名列。**但只在焦點還在編輯區裡時才搶**，而且 preventScroll——
     這個 cleanup 會在每一條收合路徑上跑（點別列、開始拖曳、Escape、刪除），無條件
     focus() 會順帶把視窗捲回剛離開的那一列：往下捲到第 5 列點它 → 第 1 列的編輯區卸載
     → 捲動跳回第 1 列 → 第 5 列的 onAnimationComplete 再捲一次，一次點擊兩段互打的捲動
     （impeccable 抓到）。改餐別那條路徑由 handleChangeMeal 自己把焦點送到新位置，
     這裡不插手。 */
  const rootRef = useRef<HTMLFormElement>(null)
  useEffect(
    () => () => {
      if (rootRef.current?.contains(document.activeElement)) {
        openerRef.current?.focus({ preventScroll: true })
      }
    },
    [openerRef],
  )

  /* ponytail: 每按一次 +／− 就直接送一次 PATCH，不做 debounce。連按會送出多個請求，
     但每個都是「完整覆寫 qty」而不是增量，同一條連線下到達順序即發送順序，最後一次
     獲勝。升級路徑：真的遇到畫面與 DB 對不上，再加 300ms debounce ＋ 收合時 flush——
     那需要多一組 timer 生命週期，而這個元件已經在 timer 清理上翻船過兩次（長按計時器
     沒隨 unmount 清、sheet 關閉計時器），先不引入第三組。 */
  async function commitQty(next: number) {
    setLocalQty(next)
    setDraft(String(next))
    if (next === sentQty.current) return // 只送有變的，同品名與營養欄
    sentQty.current = next
    inFlight.current += 1
    try {
      await onQty(next)
      savedQty.current = next
      setSaid(`份量已改為 ${next}`)
    } catch {
      anyFailed.current = true
      // 訊息由 Today 層的 editErr 供應（它活得比這個元件久），這裡只負責回滾自己的值
    }
    inFlight.current -= 1
    // 全部回來才回滾：前一筆失敗、後一筆成功時畫面本來就對，提早回滾會停在舊值
    if (inFlight.current === 0 && anyFailed.current) {
      anyFailed.current = false
      sentQty.current = savedQty.current
      setLocalQty(savedQty.current)
      setDraft(String(savedQty.current))
    }
  }

  // 打字途中不正規化，理由與 LogSheet 的 handleQtyInput 相同：中間態被改掉游標會跳走
  function handleInput(raw: string) {
    setDraft(raw)
    const n = parseTypedQty(raw)
    if (n !== null) setLocalQty(n)
  }

  /* 品名與四個營養數字：**改的是這一筆，不是食品庫**（去皮、少醬、店家給多了）。
     每欄 blur 時各自 commit 一次、只送有變的那一欄，份量欄的 onBlur 也是同一套（與 savedQty 比對，沒變不送）——
     不做「儲存」按鈕，編輯區沒有送出的概念，每個動作都是即時的。
     草稿初始值用**有效品名**（可能來自 foods），所以「打開沒改就關掉」要靠下面那個
     相等比對擋掉，否則會把 foods 的品名白白複製進 name 快照欄、無謂地讓它脫鉤。 */
  const [detail, setDetail] = useState({
    name,
    kcal: String(num(row.kcal)),
    protein: String(num(row.protein)),
    fat: String(num(row.fat)),
    carb: String(num(row.carb)),
  })

  /* 播報與「還原」的參照點一律是 **foods 的品名**，不是 `name` prop：後者是有效品名
     （`row.name ?? foods.name`），改名成功後父層會把它換成新快照，於是「改名 → 再清空」
     這條路徑上唸出來的會是剛剛被清掉的那個名字（review 抓到）。 */
  const foodsName = row.foods?.name ?? null

  async function commitName(raw: string) {
    /* 打進來的字若正好等於 foods 的品名，語意就是「沿用食品庫」＝ null，與清空同一件事。
       這一步把三條路徑（沒改、清空、打回原名）收斂成同一個值，下面才有辦法用一次相等
       比對擋掉全部的 no-op：草稿預填的是有效品名，少了這層正規化，一筆從沒改過名的列
       只要被清空就會送出一個 `{ name: null }` 的空包彈（review 抓到）。 */
    const trimmed = raw.trim()
    const next = !trimmed || trimmed === foodsName ? null : trimmed
    if (next === row.name) return
    try {
      await onDetail({ name: next })
      setDetail((d) => ({ ...d, name: next ?? foodsName ?? '' }))
      setSaid(next ? `品名已改為 ${next}` : `品名已還原成食品庫的 ${foodsName ?? '（食物已刪除）'}`)
    } catch {
      setDetail((d) => ({ ...d, name }))
    }
  }

  /* 本地驗證失敗（空白、負數、打錯字）**不走「存不進去」那條錯誤訊息**——那句是 PATCH
     失敗專用的，借來說「你打錯了」會讓兩種完全不同的狀況長得一樣。改成當場還原該欄並
     用既有的 sr-only 播報說明，視覺上使用者也看得到值跳回去了。 */
  async function commitMacro(key: DetailKey, raw: string) {
    const prev = num(row[key])
    const trimmed = raw.trim()
    const n = Number(trimmed)
    /* 空字串要自己擋：`Number('')` 是 0 而不是 NaN，少了這半清空欄位會被當成
       「我今天吃的這份脂肪是 0」靜靜存進去，而且畫面上那格還是留白的（e2e 抓到）。
       想歸零的人打得出 0，清空從來不是那個意思。 */
    /* 上界對齊 DB 的 numeric(6,2)（kcal 是 (7,2)，取嚴的那個當統一門檻）。少了它，手滑
       多打一個 0 會讓 Postgres 回 numeric field overflow，使用者看到的是一句資料庫原文
       ——同一種「你打錯了」，卻走了跟負數完全不同的呈現路徑（review 抓到）。 */
    if (!trimmed || !Number.isFinite(n) || n < 0 || n > MACRO_MAX) {
      setDetail((d) => ({ ...d, [key]: String(prev) }))
      setSaid(`${DETAIL_LABEL[key]} 要填 0 到 ${MACRO_MAX} 之間的數字，已還原`)
      return
    }
    /* 先捨到兩位小數再送，因為 DB 那四欄都是 numeric(_,2)：直接送 123.456 的話 Postgres
       存成 123.46，而本地 rows 與 cacheRef 留著 123.456，兩邊要等下一次真的 fetch 才對齊。
       捨在這裡＝畫面、本地狀態、DB 三層看到的是同一個數字。 */
    const rounded = Math.round(n * 100) / 100
    /* 值沒變也要把草稿正規化：打 `420.00` 或 `420.` 與現值數學相等，早退的話那串
       非正規化的字面會一直留在欄位上（review 抓到）。 */
    if (rounded === prev) {
      setDetail((d) => ({ ...d, [key]: String(prev) }))
      return
    }
    try {
      await onDetail({ [key]: rounded })
      setDetail((d) => ({ ...d, [key]: String(rounded) }))
      setSaid(`${DETAIL_LABEL[key]} 已改為 ${rounded}`)
    } catch {
      setDetail((d) => ({ ...d, [key]: String(prev) }))
    }
  }

  const macroField = (key: DetailKey) => (
    <div className="field-float">
      <input
        id={`${id}-${key}`}
        type="text"
        inputMode="decimal"
        placeholder=" "
        value={detail[key]}
        onChange={(e) => setDetail((d) => ({ ...d, [key]: e.target.value }))}
        onBlur={(e) => void commitMacro(key, e.target.value)}
      />
      <label htmlFor={`${id}-${key}`}>{DETAIL_LABEL[key]}</label>
    </div>
  )

  async function pickMeal(key: MealKey) {
    if (key === localMeal || busy) return
    const prev = localMeal
    setLocalMeal(key)
    setBusy(true)
    try {
      await onMeal(key)
      // 成功後這個元件會被收合卸載，setState 不會有機會跑到；失敗才走下面
    } catch {
      setLocalMeal(prev)
      setBusy(false)
    }
  }

  return (
    /* `<form>` 而不是 `<div>`：給 iOS 的鍵盤上下箭頭一個明確的欄位分組（理由與
       FoodFormFields 那份相同）。`onSubmit` preventDefault——這個編輯區沒有送出的概念，
       每一欄 blur 時各自 commit。裡面所有 button 都已經標了 `type="button"`，不會誤觸 submit。
       **`role="group"` 是刻意留著的**：有 accessible name 的 `<form>` 會成為 form landmark，
       而這裡的 `<form>` 純粹是給 iOS 用的技術手段，不是一份要填要送的表單——讓它進 landmark
       列表只會在導覽時多一個沒有意義的入口。另外兩處（FoodFormFields、體重 sheet）的 form
       都沒有 `aria-label`，本來就不會變 landmark，三處語意一致（review 提出）。 */
    <form
      className="item-editor"
      id={id}
      ref={rootRef}
      role="group"
      aria-label={`編輯 ${name}`}
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="ed-line">
        <QtyStepper
          qty={localQty}
          draft={draft}
          onStep={(dir) => void commitQty(normalizeQty(localQty + dir))}
          onInput={handleInput}
          onBlur={(raw) => void commitQty(normalizeQty(raw))}
        />
        <button className="ed-del" type="button" aria-label={`刪除 ${name} 這一筆`} onClick={onDelete}>
          <DeleteIcon />
        </button>
      </div>
      <div className="ed-line">
        {/* 餐別是互斥的四選一，用分段控制器而不是記一筆 sheet 那排可捲動的 pill chip。
            **選中態用 aria-pressed，不用 aria-current**：後者的規範語意是「目前所在的
            頁面／步驟／位置」，用在一個按下去會改變資料值的控制項上是誤用（a11y 稽核
            抓到；LogSheet 那排 chip 已比照改好）。
            沒有升級成 radiogroup 是刻意的取捨：APG 的 radiogroup 契約要 roving tabindex
            ＋方向鍵導航，半套實作會讓螢幕閱讀器期待方向鍵可用卻沒有，比不做更糟。
            另配字重 600 當非顏色訊號——選中的白塊對軌道只有 1.18:1（v2.68 改版後；原為 --accent-soft 對 --card 1.22:1）。
            **不用原生 disabled 擋重入**：那會讓正被按下、正持有焦點的那顆瞬間失焦，
            失敗時焦點就掉到 body 再也回不來（a11y 稽核抓到）；改用 busy 邏輯守衛。 */}
        <SegmentedControl label="餐別" items={MEALS} value={localMeal} onPick={(k) => void pickMeal(k)} />
      </div>
      {/* 品名與營養值。欄位版型照新增食物表單（DESIGN.md「新增食物表單欄位」）：品名整行、
          熱量整行、三大營養素三欄並排——同一組數字在兩個地方長得一樣，使用者不必重學。
          **這裡沒有店家欄**：店家是食品庫的屬性，「今天這份去了皮」不會換一家店。 */}
      <div className="ed-line ed-detail">
        <div className="field-float">
          <input
            id={`${id}-name`}
            type="text"
            placeholder=" "
            value={detail.name}
            onChange={(e) => setDetail((d) => ({ ...d, name: e.target.value }))}
            onBlur={(e) => void commitName(e.target.value)}
          />
          <label htmlFor={`${id}-name`}>品名</label>
        </div>
        {macroField('kcal')}
        <div className="field-row">
          {macroField('protein')}
          {macroField('fat')}
          {macroField('carb')}
        </div>
      </div>
      {err && (
        <p className="sheet-error ed-error" role="alert">
          存不進去：{err}
        </p>
      )}
      {/* 改份量／改餐別成功後畫面只有數字變動，螢幕閱讀器聽不到任何確認（WCAG 4.1.3）。
          改餐別的播報由 handleChangeMeal 把焦點送到新位置代勞（VoiceOver 會唸出整列），
          這裡負責份量。 */}
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </form>
  )
}
