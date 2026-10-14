/* 訓練分頁（階段 2，樣張 ①）。第一輪第 2a 段：日期元件、當天已記的訓練、同步狀態細條。
 * 開始訓練、訓練中、動作庫在後面的段落接上；這一頁先把「資料真的從本機底讀得到、離線也在」立起來。
 *
 * 日期自己管、不跟飲食頁共用同一個 state：兩頁的日期軸「長得一致」（共用 DateStrip），
 * 但互相揭露（點了跳到飲食同一天）是第 2 輪的明確動作，不是兩頁偷偷連動。 */

import { useMemo, useState } from 'react'
import DateStrip from '@/components/DateStrip'
import { localDate } from '@/lib/dates'
import type { TrainingView } from '@/lib/trainingRuntime'
import { trainingDates, workoutsOn, type WorkoutCard } from '@/lib/training'

interface TrainingProps {
  view: TrainingView | null
  error: string | null
}

/** 小點資料全在記憶體（整包載入），不需要按月抓。DateStrip 的 effect 依賴它，必須是穩定的參考。 */
const noop = () => undefined

/** 同步狀態細條的文字。離線與未同步可以同時成立，兩句都講。沒事就不顯示（不是 toast，常駐但安靜）。 */
function statusText(view: TrainingView): string | null {
  const parts: string[] = []
  if (view.source !== 'server') parts.push('連不上伺服器，顯示的是本機資料')
  if (view.summary.mine > 0) parts.push(`${view.summary.mine} 筆尚未同步`)
  if (view.cacheError) parts.push('本機儲存寫不進去，離線時可能讀不到')
  return parts.length > 0 ? parts.join(' · ') : null
}

function WorkoutRow({ card }: { card: WorkoutCard }) {
  const title = `${card.exerciseCount} 個動作`
  const detail = `${card.doneSets}/${card.totalSets} 組 · ${card.volume.toLocaleString('en-US')} kg · ${card.minutes} 分`
  return (
    <div className="tr-row" data-workout-id={card.id}>
      <span className="grow">
        <span className="nm">{title}</span>
        <span className="sub">{detail}</span>
      </span>
    </div>
  )
}

export default function Training({ view, error }: TrainingProps) {
  const [date, setDate] = useState(() => localDate())
  const marked = useMemo(() => (view ? trainingDates(view.db) : new Set<string>()), [view])
  const cards = useMemo(() => (view ? workoutsOn(view.db, date, new Date()) : []), [view, date])
  const inProgress = cards.filter((c) => c.inProgress)
  const finished = cards.filter((c) => !c.inProgress)
  const status = view ? statusText(view) : null

  return (
    <div className="main" data-screen="training">
      <header className="topbar">
        <DateStrip date={date} marked={marked} onSelect={setDate} onViewMonth={noop} />
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
                    <WorkoutRow key={c.id} card={c} />
                  ))}
                </div>
              </>
            )}
            {finished.length > 0 && (
              <>
                <div className="tr-sec">已完成</div>
                <div className="tr-card">
                  {finished.map((c) => (
                    <WorkoutRow key={c.id} card={c} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
