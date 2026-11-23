/* 訓練分頁（階段 2，樣張 ①；2026-11-23 訓練分頁改版 A／B1）：頂端跟今日頁同一副骨架（天空裡日期標題、週列、一行大字），
 * 下面只放「這天」：當天已記的訓練（進行中與已完成分開）；今天還沒練就列課表當開始選項（建議的那份標出來）。
 * 課表管理與訓練分析搬出首頁本體，從天空右上兩顆鈕進子頁。另有同步狀態細條，以及「開始訓練 sheet → 訓練中整頁」這條主流程。
 * 動作庫管理在 v2.96 搬到設定頁（跟食品庫管理放一起），這裡不再有入口。
 * 有氧是動作（spec「有氧併入動作」）：在訓練中加，沒有獨立的入口與列表；只有一張有氧卡的訓練在列表上以動作名稱與有氧摘要列出。
 * 課表子頁：點一份進課表編輯整頁，「＋ 新課表」先問名稱；開始訓練 sheet 與首頁的開始選項裡選課表會照它開一次訓練。
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
import SubPageTop from '@/components/SubPageTop'
import { useSkyEdge } from '@/components/useSkyEdge'
import { localDate, weekdayDate } from '@/lib/dates'
import { dayTraining, routineStartNotes, suggestRoutine, todayFocus } from '@/lib/trainingHome'
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
import TodayScene from './TodayScene'
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
  /** 開著的訓練中整頁（App 持有：換分頁不丟，「訓練中」小條點了要能直接開回來）。 */
  sessionId: string | null
  onSessionChange: (id: string | null) => void
}

/** 小點資料全在記憶體（整包載入），不需要按月抓。DateStrip 的 effect 依賴它，必須是穩定的參考。 */
const noop = () => undefined

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 同步狀態細條的文字。離線與未同步可以同時成立，兩句都講。沒事就不顯示（不是 toast，常駐但安靜）。 */
function statusText(view: TrainingView): string | null {
  const parts: string[] = []
  if (view.source !== 'server') parts.push('連不上伺服器，顯示的是本機資料')
  if (view.summary.mine > 0) parts.push(`${view.summary.mine} 筆還沒上傳`)
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
    : `${card.doneSets}/${card.totalSets} 組 · 總重量 ${card.volume.toLocaleString('en-US')} kg · ${card.minutes} 分`
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

/** m:ss；超過一小時繼續累加分鐘（同訓練中整頁）。 */
function clock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

/* 天空裡那一行（訓練分頁改版 A）：這天在練就是計時＋「繼續」、練過就是總重量、今天沒練就說今天適合練什麼（肌群恢復是理由，
   使用者 2026-11-23 選）、其他沒練的日子一句「這天沒練」。版面借今日頁的 .gauge（大字、字級、天空上的字色），兩頁頂端長一樣。
   即時進行中的計時每秒跳，所以自己一個元件、自己的 interval，不讓整頁每秒重畫。 */
function TrainingHero({ view, date, hasRoutines, onResume }: { view: TrainingView | null; date: string; hasRoutines: boolean; onResume: (id: string) => void }) {
  const [now, setNow] = useState(() => new Date())
  const state = view ? dayTraining(view.db, date, now) : null
  const live = state?.kind === 'live'
  useEffect(() => {
    if (!live) return
    setNow(new Date()) // 剛轉成進行中（別台開始的同步進來）：先對一次，不然第一秒用舊的 now 算出 0:00
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [live])
  const focus = useMemo(() => (view && state?.kind === 'idle-today' ? todayFocus(view.db, new Date()) : null), [view, state?.kind])

  if (state === null) {
    return <section className="gauge tr-hero" aria-busy="true" />
  }
  if (state.kind === 'live') {
    return (
      <section className="gauge tr-hero" data-hero="live" aria-label="訓練中">
        <div className="gauge-top">
          <div>
            <div className="gauge-lead">訓練中</div>
            <span className="gauge-num">{clock(now.getTime() - Date.parse(state.startedAt))}</span>
          </div>
        </div>
        <div className="gauge-meta">
          <button className="tr-hero-go" type="button" data-action="resume" onClick={() => onResume(state.workoutId)}>
            繼續
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </section>
    )
  }
  if (state.kind === 'done') {
    // 補記略過時長＝0 分：不寫，不然像真的練了 0 分鐘
    const parts = [...(state.minutes > 0 ? [`${state.minutes} 分`] : []), `${state.doneSets} 組`, ...(state.count > 1 ? [`${state.count} 次`] : [])]
    return (
      <section className="gauge tr-hero" data-hero="done" aria-label="這天的訓練">
        <div className="gauge-top">
          <div>
            <div className="gauge-lead">練了</div>
            <span className="gauge-num">{state.volume.toLocaleString('en-US')}</span>
            <span className="gauge-unit">kg</span>
          </div>
        </div>
        <div className="gauge-meta">
          <span className="gauge-side">{parts.join(' · ')}</span>
        </div>
      </section>
    )
  }
  // 沒練：今天說適合練什麼，其他日子一句話
  const title =
    state.kind === 'idle-other'
      ? '這天沒練'
      : focus === null
        ? '今天還沒練'
        : focus.ready.length > 0
          ? focus.ready.join('、')
          : '今天休息一下'
  const lead = state.kind === 'idle-today' && focus !== null && focus.ready.length > 0 ? '今天適合練' : null
  const note =
    state.kind === 'idle-other'
      ? date < localDate()
        ? '要補記，按右下角 ＋'
        : null
      : focus === null
        ? hasRoutines
          ? '照課表開始，或按右下角 ＋'
          : '按右下角 ＋ 開始'
        : focus.recovering.length > 0
          ? // 只寫最快恢復的那一個：一句話套同一個天數會讓每個肌群都像要等那麼久
            `${focus.recovering[0].label}還要約 ${focus.recovering[0].days} 天`
          : '全身都恢復了'
  return (
    <section className="gauge tr-hero" data-hero={state.kind} aria-label={lead ? `${lead}：${title}` : title}>
      <div className="gauge-top">
        <div>
          {lead && <div className="gauge-lead">{lead}</div>}
          <span className="tr-hero-title">{title}</span>
        </div>
      </div>
      {note && (
        <div className="gauge-meta">
          <span className="gauge-side">{note}</span>
        </div>
      )}
    </section>
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
  sessionId,
  onSessionChange: setSessionId,
}: TrainingProps) {
  const [syncOpen, setSyncOpen] = useState(false)
  const [analysis, setAnalysis] = useState(false)
  const [routinesPage, setRoutinesPage] = useState(false)
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
  const full = detail !== null || analysis || editing !== null || routinesPage
  // 開始選項（首頁「照課表開始」與開始 sheet）：每份課表的說明、建議的那份。肌群恢復是隨時間變的，進頁面／資料變動時算一次就夠
  const startNotes = useMemo(() => (view ? routineStartNotes(view.db, routines.active, new Date()) : new Map<string, string>()), [view, routines])
  const suggestion = useMemo(() => (view ? suggestRoutine(view.db, routines.active, new Date()) : null), [view, routines])
  const suggestedId = suggestion?.ready ? suggestion.card.routine.id : null
  // 排第一的是最久沒做的那份（都在恢復也一樣），「建議」小標只給練到的肌群都恢復了的
  const firstId = suggestion?.card.routine.id ?? null
  const startOrder = [...routines.active].sort((a, b) => Number(b.routine.id === firstId) - Number(a.routine.id === firstId))

  // 首頁開始選項失敗留下的錯誤，不帶進之後打開的開始 sheet（那時還沒做任何事）
  useEffect(() => {
    if (startOpen) setStartError(null)
  }, [startOpen])

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
  const today = localDate()

  // 課表子頁（訓練分頁改版 B1：課表管理搬出首頁本體，從天空右上「課表」進來）
  if (routinesPage && view) {
    return (
      <div className="main" data-screen="routines">
        <SubPageTop
          title="課表"
          backLabel="返回訓練"
          onBack={() => setRoutinesPage(false)}
          action={
            <button className="tr-text-btn" type="button" data-action="new-routine" onClick={() => setNameOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              新課表
            </button>
          }
        />
        <div className="tr-scroll">
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
        </div>
        <RoutineNameSheet
          open={nameOpen}
          onClose={() => setNameOpen(false)}
          onWrite={onWrite}
          onCreated={(id) => {
            setNameOpen(false)
            setRoutineId(id)
          }}
        />
      </div>
    )
  }

  return (
    <div className="main" data-screen="training">
      {/* 訓練分頁改版 A：跟今日頁同一副頂端——天空裡是日期標題、週列、一行大字，跟著內容一起捲（取代 v2.132 的 96px 固定橫幅） */}
      <div className="tr-home" ref={edge.ref} onScroll={edge.sync}>
        <div className="sky">
          <TodayScene variant="training" date={date} logged={null} onPick={noop} />
          <header className="topbar">
            <DateStrip
              date={date}
              marked={marked}
              onSelect={onDateChange}
              onViewMonth={noop}
              actions={
                view && (
                  <>
                    <button className="sky-ib" type="button" aria-label="課表" data-action="open-routines" onClick={() => setRoutinesPage(true)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
                      </svg>
                    </button>
                    <button className="sky-ib" type="button" aria-label="訓練分析" data-action="open-analysis" onClick={() => setAnalysis(true)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19h16" />
                        <path d="M5 15l4-5 4 3 6-8" />
                      </svg>
                    </button>
                  </>
                )
              }
            />
          </header>
          <TrainingHero view={view} date={date} hasRoutines={routines.active.length > 0} onResume={setSessionId} />
        </div>

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

        <div className="tr-home-body">
          {view === null ? (
            <SkelBlock className="tr-skel">
              {[0, 1].map((i) => (
                <div key={i} className="tr-card">
                  <div className="skel-row tr-skel-row"><Skel round h="40px" /><Skel w="40%" /><Skel w="3em" /></div>
                  <div className="skel-row tr-skel-row"><Skel round h="40px" /><Skel w="55%" /><Skel w="3em" /></div>
                </div>
              ))}
            </SkelBlock>
          ) : cards.length > 0 ? (
            <>
              {/* 進行中的與已完成的分開：App 重開後進行中的那一次還在，要一眼認得出來（AC 9） */}
              {inProgress.length > 0 && (
                <>
                  <div className="tr-sec">進行中</div>
                  {/* 進行中／已完成是時間軸的一節（訓練換皮 B，同訓練中整頁與今日頁 v2.141）：列前一個節點，不是白卡 */}
                  <div className="tr-card is-timeline" data-node="current">
                    {inProgress.map((c) => (
                      <WorkoutRow key={c.id} card={c} onOpen={() => setSessionId(c.id)} />
                    ))}
                  </div>
                </>
              )}
              {finished.length > 0 && (
                <>
                  <div className="tr-sec">已完成</div>
                  <div className="tr-card is-timeline" data-node="done">
                    {finished.map((c) => (
                      <WorkoutRow key={c.id} card={c} onOpen={() => setSessionId(c.id)} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : date === today && routines.active.length > 0 ? (
            // 今天還沒練：課表就是開始的選項（B1）。建議的那份排第一、標「建議」，同開始 sheet
            <>
              <div className="tr-sec">照課表開始</div>
              <div className="tr-card" data-section="start-options">
                {startOrder.map((c) => (
                  <RoutineRow
                    key={c.routine.id}
                    card={c}
                    disabled={startBusy}
                    note={startNotes.get(c.routine.id) ?? ''}
                    suggested={c.routine.id === suggestedId}
                    onOpen={() => void startFromRoutine(c.routine.id)}
                  />
                ))}
                <button className="tr-row" type="button" disabled={startBusy} onClick={() => void startBlank()} data-action="start-blank-home">
                  <span className="grow">
                    <span className="nm">空白開始</span>
                    <span className="sub">一個一個加動作</span>
                  </span>
                  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
              {startError && !startOpen && (
                <p className="tr-form-error" role="alert">
                  {startError}
                </p>
              )}
            </>
          ) : null}
        </div>
      </div>

      <StartSheet
        open={startOpen}
        dateLabel={weekdayDate(date)}
        backfill={date < localDate()}
        busy={startBusy}
        error={startError}
        routines={routines.active}
        notes={startNotes}
        firstId={firstId}
        suggestedId={suggestedId}
        onClose={() => {
          setStartError(null)
          onStartOpenChange(false)
        }}
        onBlank={() => void startBlank()}
        onRoutine={(id) => void startFromRoutine(id)}
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
