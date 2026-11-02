import { monthDay } from '@/lib/dates'
import type { RoutineCard } from '@/lib/training'

/** 課表列：Training 的課表清單與 StartSheet 的開始選單共用（後者在 busy 時要 disabled）。 */
export default function RoutineRow({ card, onOpen, disabled }: { card: RoutineCard; onOpen: () => void; disabled?: boolean }) {
  const { routine, exerciseCount, lastUsed } = card
  return (
    <button className="tr-row" type="button" disabled={disabled} data-routine-id={routine.id} onClick={onOpen}>
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
  )
}
