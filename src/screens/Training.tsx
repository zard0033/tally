/* 訓練分頁（階段 2，樣張 ①）：日期元件、當天已記的訓練（進行中與已完成分開）、同步狀態細條，
 * 以及「開始訓練 sheet → 訓練中整頁」這條主流程；課表下方的「動作庫」入口進整頁的動作庫。
 * 課表／有氧在第 2 輪接上。
 *
 * 日期由 App 持有、經 props 傳進來：主 CTA 在 App 的底部列裡，要知道「選到哪天、能不能開始」。
 * 兩頁的日期軸「長得一致」（共用 DateStrip），但**不連動**——互相揭露是第 2 輪的明確動作。
 * 進行中的整頁（TrainingSession）與動作庫（ExerciseLibrary）接管整個畫面，並通知 App 把底部列收起來
 * （同設定的次級頁面）。 */

import { useEffect, useMemo, useState } from 'react'
import DateStrip from '@/components/DateStrip'
import { localDate, weekdayDate } from '@/lib/dates'
import type { TrainingView } from '@/lib/trainingRuntime'
import {
  startWorkoutOps,
  trainingDates,
  workoutDetail,
  workoutsOn,
  type RowOp,
  type WorkoutCard,
} from '@/lib/training'
import ExerciseLibrary from './ExerciseLibrary'
import StartSheet from './StartSheet'
import TrainingSession from './TrainingSession'

interface TrainingProps {
  view: TrainingView | null
  error: string | null
  date: string
  onDateChange: (iso: string) => void
  startOpen: boolean
  onStartOpenChange: (open: boolean) => void
  /** 進入／離開訓練中整頁時回報，App 據此收起底部列。 */
  onFullPage: (full: boolean) => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

/** 小點資料全在記憶體（整包載入），不需要按月抓。DateStrip 的 effect 依賴它，必須是穩定的參考。 */
const noop = () => undefined

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 同步狀態細條的文字。離線與未同步可以同時成立，兩句都講。沒事就不顯示（不是 toast，常駐但安靜）。 */
function statusText(view: TrainingView): string | null {
  const parts: string[] = []
  if (view.source !== 'server') parts.push('連不上伺服器，顯示的是本機資料')
  if (view.summary.mine > 0) parts.push(`${view.summary.mine} 筆尚未同步`)
  if (view.cacheError) parts.push('本機儲存寫不進去，離線時可能讀不到')
  return parts.length > 0 ? parts.join(' · ') : null
}

function WorkoutRow({ card, onOpen }: { card: WorkoutCard; onOpen: () => void }) {
  const title = `${card.exerciseCount} 個動作`
  const detail = `${card.doneSets}/${card.totalSets} 組 · ${card.volume.toLocaleString('en-US')} kg · ${card.minutes} 分`
  return (
    <button className="tr-row" type="button" data-workout-id={card.id} onClick={onOpen}>
      <span className="grow">
        <span className="nm">{title}</span>
        <span className="sub">{detail}</span>
      </span>
      <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

export default function Training({
  view,
  error,
  date,
  onDateChange,
  startOpen,
  onStartOpenChange,
  onFullPage,
  onWrite,
}: TrainingProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [library, setLibrary] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const marked = useMemo(() => (view ? trainingDates(view.db) : new Set<string>()), [view])
  const cards = useMemo(() => (view ? workoutsOn(view.db, date, new Date()) : []), [view, date])
  // 這次訓練被刪了（別的裝置、或自己在整頁裡刪掉）：detail 變 null，自然退回清單
  const detail = view && sessionId ? workoutDetail(view.db, sessionId) : null
  const full = detail !== null || library

  useEffect(() => {
    onFullPage(full)
    return () => onFullPage(false)
  }, [full, onFullPage])

  const startBlank = async () => {
    setStartBusy(true)
    setStartError(null)
    const id = crypto.randomUUID()
    try {
      await onWrite(startWorkoutOps({ workoutId: id, date, now: new Date() }))
      onStartOpenChange(false)
      setSessionId(id)
    } catch (e) {
      setStartError(`這筆沒有存下來：${errText(e)}`)
    } finally {
      setStartBusy(false)
    }
  }

  if (detail && view) {
    return <TrainingSession detail={detail} db={view.db} onWrite={onWrite} onBack={() => setSessionId(null)} />
  }

  if (library && view) {
    return <ExerciseLibrary exercises={view.db.exercises} onBack={() => setLibrary(false)} onWrite={onWrite} />
  }

  const inProgress = cards.filter((c) => c.inProgress)
  const finished = cards.filter((c) => !c.inProgress)
  const status = view ? statusText(view) : null

  return (
    <div className="main" data-screen="training">
      <header className="topbar">
        <DateStrip date={date} marked={marked} onSelect={onDateChange} onViewMonth={noop} />
      </header>

      {status && (
        <div className="tr-status" role="status">
          <span className="grow">{status}</span>
        </div>
      )}
      {error && (
        <div className="tr-status is-error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}

      <div className="tr-scroll">
        {view === null ? (
          <p className="muted">載入中…</p>
        ) : cards.length === 0 ? (
          <p className="muted">這天沒有訓練紀錄</p>
        ) : (
          <>
            {/* 進行中的與已完成的分開：App 重開後進行中的那一次還在，要一眼認得出來（AC 9） */}
            {inProgress.length > 0 && (
              <>
                <div className="tr-sec">進行中</div>
                <div className="tr-card">
                  {inProgress.map((c) => (
                    <WorkoutRow key={c.id} card={c} onOpen={() => setSessionId(c.id)} />
                  ))}
                </div>
              </>
            )}
            {finished.length > 0 && (
              <>
                <div className="tr-sec">已完成</div>
                <div className="tr-card">
                  {finished.map((c) => (
                    <WorkoutRow key={c.id} card={c} onOpen={() => setSessionId(c.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {view && (
          <div className="tr-card tr-entry">
            <button className="tr-row" type="button" data-action="open-library" onClick={() => setLibrary(true)}>
              <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z" />
                <path d="M9 8h6M9 12h6" />
              </svg>
              <span className="grow">
                <span className="nm">動作庫</span>
                <span className="sub">
                  {view.db.exercises.filter((e) => e.archived !== true).length} 個動作 · 搜尋、編輯要點
                </span>
              </span>
              <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <StartSheet
        open={startOpen}
        dateLabel={weekdayDate(date)}
        backfill={date < localDate()}
        busy={startBusy}
        error={startError}
        onClose={() => {
          setStartError(null)
          onStartOpenChange(false)
        }}
        onBlank={() => void startBlank()}
      />
    </div>
  )
}
