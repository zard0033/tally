/* 開始訓練 sheet（樣張 ②）：課表（最上面，建議的那份排第一並標「建議」）與空白開始。封存的課表不進這張選單。
   沒有「記一筆有氧」：有氧是動作（spec「有氧併入動作」D4），單獨記一筆也是空白開始→加有氧動作。
   走 SpringSheet（沒有輸入欄、貼合內容高度）。 */
import RoutineRow from '@/components/RoutineRow'
import SpringSheet from '@/components/SpringSheet'
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
  /** 每份課表的說明（routineStartNotes）；排第一的那份（suggestRoutine，最久沒做）；標「建議」的那份（同一份且練到的肌群都恢復了，否則 null）。 */
  notes: ReadonlyMap<string, string>
  firstId: string | null
  suggestedId: string | null
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
  notes,
  firstId,
  suggestedId,
  onClose,
  onBlank,
  onRoutine,
}: StartSheetProps) {
  return (
    <SpringSheet open={open} onClose={onClose} title="開始訓練" screen="start-sheet" fit>
      <div className="tr-sheet-body">
        <div className="tr-card">
          {/* 建議的那份排最上面（訓練分頁改版：首頁不放建議，開始時才給；兩處同一份） */}
          {[...routines]
            .sort((a, b) => Number(b.routine.id === firstId) - Number(a.routine.id === firstId))
            .map((card) => (
              <RoutineRow
                key={card.routine.id}
                card={card}
                disabled={busy}
                note={notes.get(card.routine.id) ?? ''}
                suggested={card.routine.id === suggestedId}
                onOpen={() => onRoutine(card.routine.id)}
              />
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
