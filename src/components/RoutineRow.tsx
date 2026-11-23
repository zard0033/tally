import { monthDay } from '@/lib/dates'
import type { RoutineCard } from '@/lib/training'

interface RoutineRowProps {
  card: RoutineCard
  onOpen: () => void
  disabled?: boolean
  /** 開始選項（首頁「照課表開始」與開始 sheet）：第二行換成 routineStartNotes 的說明，右邊是開始鈕而不是箭頭。 */
  note?: string
  /** 建議的那份（訓練分頁改版：練到的肌群都恢復了、最久沒做）：名稱旁一顆「建議」。 */
  suggested?: boolean
}

/** 課表列：課表子頁的清單、首頁的「照課表開始」與開始 sheet 共用（後兩者在 busy 時要 disabled）。 */
export default function RoutineRow({ card, onOpen, disabled, note, suggested }: RoutineRowProps) {
  const { routine, exerciseCount, lastUsed } = card
  const start = note !== undefined
  return (
    <button
      className={`tr-row${start ? ' is-start' : ''}`}
      type="button"
      disabled={disabled}
      data-routine-id={routine.id}
      data-suggested={suggested || undefined}
      onClick={onOpen}
    >
      <span className="grow">
        <span className="nm">
          {String(routine.name)}
          {suggested && <span className="tr-suggest">建議</span>}
        </span>
        <span className="sub">{start ? note : `${exerciseCount} 個動作${lastUsed ? ` · 上次 ${monthDay(lastUsed)}` : ''}`}</span>
      </span>
      {start ? (
        <span className="tr-go" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M9 7l8 5-8 5z" />
          </svg>
        </span>
      ) : (
        <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </button>
  )
}
