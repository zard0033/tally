/* 開始訓練 sheet（樣張 ②）：課表（最上面）與空白開始。封存的課表不進這張選單。
   沒有「記一筆有氧」：有氧是動作（spec「有氧併入動作」D4），單獨記一筆也是空白開始→加有氧動作。
   走自製的 SpringSheet（全站精緻度改版 B0 的試點之一；沒有輸入欄、貼合內容高度）。 */
import SpringSheet from '@/components/SpringSheet'
import { monthDay } from '@/lib/dates'
import type { RoutineCard } from '@/lib/training'

interface StartSheetProps {
  open: boolean
  /** 「週三 10/14」，告訴使用者這次會記在哪一天。 */
  dateLabel: string
  /** 選到過去的日子＝補記：不計時，完成時手填時長。 */
  backfill: boolean
  busy: boolean
  error: string | null
  /** 使用中的課表（已排除封存），依建立順序。 */
  routines: readonly RoutineCard[]
  onClose: () => void
  onBlank: () => void
  onRoutine: (routineId: string) => void
}

export default function StartSheet({
  open,
  dateLabel,
  backfill,
  busy,
  error,
  routines,
  onClose,
  onBlank,
  onRoutine,
}: StartSheetProps) {
  return (
    <SpringSheet open={open} onClose={onClose} label="開始訓練" title="開始訓練" screen="start-sheet" fit>
      <div className="tr-sheet-body">
        <div className="tr-card">
          {routines.map(({ routine, exerciseCount, lastUsed }) => (
            <button
              key={routine.id}
              className="tr-row"
              type="button"
              disabled={busy}
              data-routine-id={routine.id}
              onClick={() => onRoutine(routine.id)}
            >
              <span className="grow">
                <span className="nm">{String(routine.name)}</span>
                <span className="sub">
                  {exerciseCount} 個動作{lastUsed ? ` · 上次 ${monthDay(lastUsed)}` : ''}
                </span>
              </span>
              <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ))}
          <button className="tr-row" type="button" disabled={busy} onClick={onBlank} data-action="start-blank">
            <span className="grow">
              <span className="nm">空白開始</span>
              <span className="sub">
                {backfill ? `補記 ${dateLabel}，不計時，完成時填時長` : '一個一個加動作'}
              </span>
            </span>
            <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        {error && (
          <p className="tr-form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </SpringSheet>
  )
}
