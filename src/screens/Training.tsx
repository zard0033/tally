/* 訓練分頁（階段 2，樣張 ①）：日期元件、當天已記的訓練（進行中與已完成分開）、同步狀態細條，
 * 以及「開始訓練 sheet → 訓練中整頁」這條主流程；課表下方的「訓練分析」入口進整頁的分析。
 * 動作庫管理在 v2.96 搬到設定頁（跟食品庫管理放一起），這裡不再有入口。
 * 有氧是動作（spec「有氧併入動作」）：在訓練中加，沒有獨立的入口與列表；只有一張有氧卡的訓練在列表上以動作名稱與有氧摘要列出。
 * 課表區在已完成之後、訓練分析入口之前：
 * 點一份進課表編輯整頁，「＋ 新課表」先問名稱；開始訓練 sheet 裡選課表會照它開一次訓練。
 *
 * 日期由 App 持有、經 props 傳進來：主 CTA 在 App 的底部列裡，要知道「選到哪天、能不能開始」。
 * 兩頁的日期軸「長得一致」（共用 DateStrip），但**不連動**——互相揭露是第 2 輪的明確動作。
 * 進行中的整頁（TrainingSession）、課表編輯與訓練分析接管整個畫面，並通知 App 把底部列收起來
 * （同設定的次級頁面）。 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import DateStrip from '@/components/DateStrip'
import EmptyNote from '@/components/EmptyNote'
import RoutineRow from '@/components/RoutineRow'
import { Skel, SkelBlock } from '@/components/Skeleton'
import SkyBand from '@/components/SkyBand'
import SubPageTop from '@/components/SubPageTop'
import { useSkyEdge } from '@/components/useSkyEdge'
import { localDate, weekdayDate } from '@/lib/dates'
import { progressList } from '@/lib/strength'
import type { TrainingView } from '@/lib/trainingRuntime'
import {
  routineDetail,
  routineList,
  startWorkoutFromRoutineOps,
  startWorkoutOps,
  trainingDates,
  workoutDetail,
  workoutsOn,
  type RowOp,
  type WorkoutCard,
} from '@/lib/training'
import RoutineEditor from './RoutineEditor'
import RoutineNameSheet from './RoutineNameSheet'
import StartSheet from './StartSheet'
import SyncSheet from './SyncSheet'
import TrainingSession from './TrainingSession'

const Analysis = lazy(() => import('./Analysis')) // recharts 不進主 bundle

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
  /** 未同步 sheet 用：放棄一條、問連帶消失幾列、立即重試。 */
  onDiscard: (seq: number) => Promise<void>
  discardImpact: (seq: number) => Promise<number>
  onRetry: () => Promise<void>
}

/** 小點資料全在記憶體（整包載入），不需要按月抓。DateStrip 的 effect 依賴它，必須是穩定的參考。 */
const noop = () => undefined

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 同步狀態細條的文字。離線與未同步可以同時成立，兩句都講。沒事就不顯示（不是 toast，常駐但安靜）。 */
function statusText(view: TrainingView): string | null {
  const parts: string[] = []
  if (view.source !== 'server') parts.push('連不上伺服器，顯示的是本機資料')
  if (view.summary.mine > 0) parts.push(`${view.summary.mine} 筆尚未同步`)
  if (view.summary.foreign > 0) parts.push(`另有 ${view.summary.foreign} 筆屬於別的帳號`)
  if (view.cacheError) parts.push('本機儲存寫不進去，離線時可能讀不到')
  return parts.length > 0 ? parts.join(' · ') : null
}

function WorkoutRow({ card, onOpen }: { card: WorkoutCard; onOpen: () => void }) {
  // 只有一張有氧卡的訓練（AC 9）：動作名稱＋有氧摘要，不寫「0/0 組 · 0 kg」；還沒填分鐘的寫「還沒填」
  const solo = card.soloCardio
  const title = solo ? solo.name : `${card.exerciseCount} 個動作`
  const detail = solo
    ? solo.summary || '還沒填'
    : `${card.doneSets}/${card.totalSets} 組 · ${card.volume.toLocaleString('en-US')} kg · ${card.minutes} 分`
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

/* 空狀態小插圖（v2.132，樣張方向 B）：裝飾，字在旁邊說過一次，所以 aria-hidden */
function EmptyDayArt() {
  return (
    <svg className="art" viewBox="0 0 160 96" width="160" height="96" aria-hidden="true">
      <rect width="160" height="96" fill="var(--sky)" />
      <circle cx="122" cy="30" r="17" fill="var(--sun-pale)" opacity=".6" />
      <circle cx="122" cy="30" r="10.5" fill="var(--sun)" />
      <g transform="translate(26 14) scale(.767)" fill="var(--snow)" opacity=".9">
        <ellipse cx="22" cy="17" rx="19" ry="8" />
        <ellipse cx="34" cy="11" rx="13" ry="9" />
        <ellipse cx="46" cy="17" rx="13" ry="7" />
      </g>
      <path d="M0 60C30 44 70 48 100 57S140 47 160 51V96H0z" fill="var(--hill-far)" />
      <path d="M0 76C40 62 90 66 120 74S150 70 160 72V96H0z" fill="var(--hill-mid)" />
      <ellipse cx="66" cy="76" rx="24" ry="3" fill="var(--ink)" opacity=".22" />
      <g transform="translate(66 70) rotate(-9)">
        <rect x="-15" y="-2" width="30" height="4" rx="2" fill="var(--ink)" />
        <rect x="-21" y="-8.5" width="6.4" height="17" rx="3.2" fill="var(--accent)" />
        <rect x="14.6" y="-8.5" width="6.4" height="17" rx="3.2" fill="var(--accent)" />
        <rect x="-25" y="-5" width="4.2" height="10" rx="2.1" fill="var(--ink)" />
        <rect x="20.8" y="-5" width="4.2" height="10" rx="2.1" fill="var(--ink)" />
      </g>
      <g transform="translate(132 70)">
        <rect x="-1.2" y="3" width="2.4" height="8" rx="1.2" fill="var(--hill-near)" />
        <circle cx="0" cy="0" r="7" fill="var(--tree)" />
      </g>
    </svg>
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
  onDiscard,
  discardImpact,
  onRetry,
}: TrainingProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [analysis, setAnalysis] = useState(false)
  const [routineId, setRoutineId] = useState<string | null>(null)
  const [nameOpen, setNameOpen] = useState(false)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const edge = useSkyEdge()

  const marked = useMemo(() => (view ? trainingDates(view.db) : new Set<string>()), [view])
  const cards = useMemo(() => (view ? workoutsOn(view.db, date, new Date()) : []), [view, date])
  // 這次訓練被刪了（別的裝置、或自己在整頁裡刪掉）：detail 變 null，自然退回清單
  const detail = view && sessionId ? workoutDetail(view.db, sessionId) : null
  const routines = useMemo(() => (view ? routineList(view.db) : { active: [], archived: [] }), [view])
  const editing = view && routineId ? routineDetail(view.db, routineId) : null
  const full = detail !== null || analysis || editing !== null
  // 訓練中整頁開著時每記一組 view 就變一次，列表又看不到入口：整頁開著就不算
  const analysed = useMemo(() => (view && !full ? progressList(view.db).length : 0), [view, full])

  useEffect(() => {
    onFullPage(full)
    return () => onFullPage(false)
  }, [full, onFullPage])

  const start = async (id: string, ops: RowOp[]) => {
    setStartBusy(true)
    setStartError(null)
    try {
      await onWrite(ops)
      onStartOpenChange(false)
      setSessionId(id)
    } catch (e) {
      setStartError(`這筆沒有存下來：${errText(e)}`)
    } finally {
      setStartBusy(false)
    }
  }

  const startBlank = () => {
    const id = crypto.randomUUID()
    return start(id, startWorkoutOps({ workoutId: id, date, now: new Date() }))
  }

  const startFromRoutine = (fromId: string) => {
    if (!view) return
    const id = crypto.randomUUID()
    const ops = startWorkoutFromRoutineOps({
      db: view.db,
      routineId: fromId,
      workoutId: id,
      date,
      now: new Date(),
      newId: () => crypto.randomUUID(),
    })
    // 課表剛好在別處被改掉的競態：不寫任何東西也不進訓練頁，說清楚
    if (ops.length === 0) {
      setStartError('找不到這份課表')
      return
    }
    return start(id, ops)
  }

  if (detail && view) {
    return <TrainingSession detail={detail} db={view.db} onWrite={onWrite} onBack={() => setSessionId(null)} />
  }

  if (editing && view) {
    return (
      <RoutineEditor
        key={editing.routine.id}
        detail={editing}
        db={view.db}
        onWrite={onWrite}
        onBack={() => setRoutineId(null)}
        onOpen={setRoutineId}
      />
    )
  }


  if (analysis && view) {
    return (
      // 第一次進來要先載 recharts 的 chunk：fallback 畫出同樣的頂列與骨架，版面不從空白跳出來（頂列與 Analysis 共用 SubPageTop）
      <Suspense
        fallback={
          <div className="main" data-screen="analysis">
            <SubPageTop title="訓練分析" backLabel="返回訓練" onBack={() => setAnalysis(false)} />
            <div className="trend-scroll">
              <div className="trend-skel" aria-busy="true" aria-label="載入中" />
            </div>
          </div>
        }
      >
        <Analysis db={view.db} onBack={() => setAnalysis(false)} />
      </Suspense>
    )
  }

  const inProgress = cards.filter((c) => c.inProgress)
  const finished = cards.filter((c) => !c.inProgress)
  const status = view ? statusText(view) : null

  return (
    <div className="main" data-screen="training" ref={edge.ref}>
      {/* v2.132：日期標題坐在橫幅的天空上，週列在橫幅下面的紙上。橫幅固定不捲：標題是換日控件，捲走了就要捲回頂端才能換日 */}
      <SkyBand object="dumbbell">
        <header className="topbar">
          <DateStrip date={date} marked={marked} onSelect={onDateChange} onViewMonth={noop} />
        </header>
      </SkyBand>

      {/* role=status 在固定的外層：掛在 button 上會取代按鈕的 role，讀屏就找不到入口（同封存提示的前例）。
          外層一直在、內層才依狀態換，狀態出現／消失時才會被播報。名稱是按鈕可見的文字，「查看詳情」走 aria-describedby */}
      <div className="tr-status-wrap" role="status" aria-live="polite">
        {status &&
          (view && (view.summary.mine > 0 || view.summary.foreign > 0) ? (
            <>
              <button
                className="tr-status is-action"
                type="button"
                aria-describedby="tr-status-hint"
                onClick={() => setSyncOpen(true)}
              >
                <span className="grow">{status}</span>
                <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
              <span id="tr-status-hint" hidden>
                查看詳情
              </span>
            </>
          ) : (
            <div className="tr-status">
              <span className="grow">{status}</span>
            </div>
          ))}
      </div>
      {error && (
        <div className="tr-status is-error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}

      <div className="tr-scroll">
        {view === null ? (
          <SkelBlock className="tr-skel">
            {[0, 1].map((i) => (
              <div key={i} className="tr-card">
                <div className="skel-row tr-skel-row"><Skel round h="40px" /><Skel w="40%" /><Skel w="3em" /></div>
                <div className="skel-row tr-skel-row"><Skel round h="40px" /><Skel w="55%" /><Skel w="3em" /></div>
              </div>
            ))}
          </SkelBlock>
        ) : cards.length === 0 ? (
          <div className="tr-empty-day">
            <EmptyDayArt />
            <p className="muted">這天沒有訓練紀錄</p>
          </div>
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
          <>
            <div className="tr-sec tr-sec-act">
              課表
              <button className="tr-text-btn" type="button" data-action="new-routine" onClick={() => setNameOpen(true)}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                新課表
              </button>
            </div>
            {routines.active.length === 0 ? (
              <EmptyNote art="notebook">還沒有課表。建好之後，開始訓練時一點就帶入動作。</EmptyNote>
            ) : (
              <div className="tr-card" data-section="routines">
                {routines.active.map((c) => (
                  <RoutineRow key={c.routine.id} card={c} onOpen={() => setRoutineId(c.routine.id)} />
                ))}
              </div>
            )}
            {routines.archived.length > 0 && (
              <>
                <div className="tr-sec">已封存的課表</div>
                <div className="tr-card" data-section="archived-routines">
                  {routines.archived.map((c) => (
                    <RoutineRow key={c.routine.id} card={c} onOpen={() => setRoutineId(c.routine.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {view && (
          <div className="tr-card tr-entry">
            <button className="tr-row" type="button" data-action="open-analysis" onClick={() => setAnalysis(true)}>
              <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 19h16" />
                <path d="M5 15l4-5 4 3 6-8" />
              </svg>
              <span className="grow">
                <span className="nm">訓練分析</span>
                <span className="sub">{analysed > 0 ? `${analysed} 個動作有進度 · 估算 1RM` : '還沒有可估算的紀錄'}</span>
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
        routines={routines.active}
        onClose={() => {
          setStartError(null)
          onStartOpenChange(false)
        }}
        onBlank={() => void startBlank()}
        onRoutine={(id) => void startFromRoutine(id)}
      />

      <RoutineNameSheet
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        onWrite={onWrite}
        onCreated={(id) => {
          setNameOpen(false)
          setRoutineId(id)
        }}
      />

      {view && (
        <SyncSheet
          open={syncOpen}
          onClose={() => setSyncOpen(false)}
          summary={view.summary}
          entries={view.entries}
          onDiscard={onDiscard}
          discardImpact={discardImpact}
          onRetry={onRetry}
        />
      )}
    </div>
  )
}
