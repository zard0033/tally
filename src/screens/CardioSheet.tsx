/* 有氧 sheet（spec「有氧併入動作」，樣張 `_design-sample/cardio-card.html` ③④）：編輯訓練中的一張有氧卡
   （workout_exercises 一列）。從有氧卡的標頭進；沒有「新增」——加有氧動作就是加動作（addExerciseOps 寫入那一列）。
   **沒有類型切換與日期**：類型由動作決定（`exerciseKind`），日期由這次訓練決定。**動作決定欄位**：健走＝分鐘＋速度＋坡度，
   拳擊＝分鐘＋預估熱量。**分鐘欄是空的**（加卡時不預填分鐘，填了才算有記錄），有歷史時 placeholder 寫「上次 N」。沒有備註、沒有「刪除這筆」——移除走卡片 ⋯ 選單的「移除這個動作」（同其他動作）。
   呼叫端只能拿有氧動作的卡來開（`isCardioExercise` 先守門）：checkCardio 對非有氧回「請選有氧類型」，這張沒有類型可選。
   寫入走 onWrite（排進離線佇列）；失敗留在 sheet 裡說明，不關。
   欄位狀態放在 CardioForm、以 session 當 key：每次打開都是一份新的草稿。 */
import { useEffect, useState } from 'react'
import SpringSheet from '@/components/SpringSheet'
import {
  CARDIO_FIELDS,
  cardioEntryDraft,
  checkCardio,
  updateCardioEntryOps,
  type CardioDraft,
  type CardioKind,
  type Row,
  type RowOp,
} from '@/lib/training'

interface CardioSheetProps {
  open: boolean
  /** 有氧卡那一列（workout_exercises）；null＝找不到了（被移除），sheet 裡不畫表單。 */
  entry: Row | null
  /** 這張卡的動作（動作庫那一列），決定標題與欄位。 */
  exercise: Row | null
  /** 這個動作上次的分鐘（`cardioLastMinutes`，呼叫端在開 sheet 當下取）；null＝沒有歷史，分鐘欄不放提示。 */
  lastMinutes: number | null
  /** 每次打開加一：當表單的 key。用列 id 當 key 不夠——關閉動畫還沒跑完就再打開同一張卡，會沿用上一份草稿。 */
  session: number
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const FIELD_LABEL: Readonly<Record<'speed_kmh' | 'incline_pct' | 'est_kcal', string>> = {
  speed_kmh: '速度 km/h',
  incline_pct: '坡度 %',
  est_kcal: '預估熱量 kcal',
}

interface FormProps {
  entry: Row
  exercise: Row | null
  lastMinutes: number | null
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
  /** 寫入中：sheet 據此鎖住關閉（Escape、點 scrim、下滑、X；寫入失敗的說明要有地方出現，AC 20）。 */
  onBusy: (busy: boolean) => void
}

function CardioForm({ entry, exercise, lastMinutes, onClose, onWrite, onBusy }: FormProps) {
  const [draft, setDraft] = useState<CardioDraft>(() => cardioEntryDraft(entry, exercise))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onBusy(busy), [busy, onBusy])
  // 寫入途中這張卡被移除（別的裝置）時表單會卸載：不放開的話 sheet 會一直鎖著關不掉
  useEffect(() => () => onBusy(false), [onBusy])

  const set = (k: keyof CardioDraft, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setError(null) // 改了欄位就不再講上一次的錯
  }
  const optional = CARDIO_FIELDS[draft.kind as CardioKind] ?? []

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkCardio(draft)
    if (!check.ok) {
      setError(check.error)
      return
    }
    // 什麼都沒改＝直接關；update 只帶有變的欄位，連按兩次第二次也只是同樣的值再送一次
    const ops = updateCardioEntryOps({ current: entry, value: check.value })
    if (ops.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onWrite(ops)
      // 成功後 busy 不放回去：sheet 關閉動畫期間表單還在，放回去的話第二次 Enter 會再送一次（同 LogSheet）
      onClose()
    } catch (err) {
      setError(`這筆沒有存下來：${errText(err)}`)
      setBusy(false)
    }
  }

  return (
    <form className="tr-sheet-body tr-sheet-scroll" onSubmit={(e) => void save(e)} noValidate>
      <div className={`tr-cardio-grid cols-${1 + optional.length}`}>
        <label className="tr-field">
          <span className="lb">分鐘</span>
          <input
            inputMode="decimal"
            value={draft.minutes}
            aria-label="分鐘"
            // 分鐘不預填（填了才算有記錄，D5）：上次的值只當提示，欄位是空的
            placeholder={lastMinutes === null ? undefined : `上次 ${lastMinutes}`}
            autoComplete="off"
            onChange={(e) => set('minutes', e.target.value)}
          />
        </label>
        {optional.map((f) => (
          <label key={f} className="tr-field">
            <span className="lb">
              {FIELD_LABEL[f]}
              <em>選填</em>
            </span>
            <input
              inputMode="decimal"
              value={draft[f]}
              aria-label={FIELD_LABEL[f]}
              autoComplete="off"
              onChange={(e) => set(f, e.target.value)}
            />
          </label>
        ))}
      </div>

      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="action-btn" type="submit" disabled={busy}>
        儲存
      </button>
    </form>
  )
}

export default function CardioSheet({ open, entry, exercise, lastMinutes, session, onClose, onWrite }: CardioSheetProps) {
  const [busy, setBusy] = useState(false)
  const title = exercise ? String(exercise.name) : '有氧'

  return (
    <SpringSheet open={open} onClose={onClose} label={title} title={title} screen="cardio-sheet" fit locked={busy}>
      {entry && (
        <CardioForm
          key={session}
          entry={entry}
          exercise={exercise}
          lastMinutes={lastMinutes}
          onClose={onClose}
          onWrite={onWrite}
          onBusy={setBusy}
        />
      )}
    </SpringSheet>
  )
}
