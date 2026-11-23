/* 「訓練中」小條（spec.md「訓練分頁改版」C2）：有即時進行中的訓練、而且沒開著訓練中整頁時，每個分頁的底部列上方都有這一條，
   點了回到那次訓練。左邊啞鈴、中間課表名（空白開始的寫「N 個動作」）、右邊計時；休息中改顯示休息倒數（讀同一份 sessionStorage，
   見 useRestTimer）。計時每秒跳；畫面在背景時 interval 停，回前景用 Date.now() 重算，數字是準的。 */
import { useEffect, useState } from 'react'
import { formatRest, remainingMs } from '@/lib/restTimer'
import type { Row, TrainingDb } from '@/lib/training'
import { useRestTimer } from './useRestTimer'

/** m:ss；超過一小時繼續累加分鐘（同訓練中整頁的時長）。 */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function liveLabel(db: TrainingDb, workout: Row): string {
  const routine = typeof workout.routine_id === 'string' ? db.routines.find((r) => r.id === workout.routine_id) : undefined
  if (routine) return String(routine.name)
  const n = db.workout_exercises.filter((we) => we.workout_id === workout.id).length
  return n === 0 ? '訓練中' : `${n} 個動作`
}

export default function LiveBar({ db, workout, onOpen }: { db: TrainingDb; workout: Row; onOpen: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const t = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  const rest = useRestTimer(String(workout.id), true)
  const resting = rest.endAt !== null && remainingMs(rest.endAt, rest.now) > 0
  const elapsed = clock(now - Date.parse(String(workout.started_at)))
  const label = liveLabel(db, workout)
  const time = resting ? `休息 ${formatRest(remainingMs(rest.endAt!, rest.now))}` : elapsed

  return (
    <button
      className={`live-bar${resting ? ' is-resting' : ''}`}
      type="button"
      data-live-workout={workout.id}
      aria-label={`回到訓練：${label}，${resting ? time : `已進行 ${elapsed}`}`}
      onClick={onOpen}
    >
      <span className="live-dot" aria-hidden="true" />
      <svg className="live-ic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
      </svg>
      <span className="live-nm">{label}</span>
      <span className="live-time">{time}</span>
      <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}
