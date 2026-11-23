/* 訓練完成畫面（訓練分頁改版 D1，使用者 2026-11-23 選整頁＋進場動畫；樣張 `_design-sample/training-redesign.html` D1）。
   按「結束」那一刻資料已經寫好，這一頁只負責收尾的感覺：登頂小景（山坡升起 → 太陽升到山頂後 → 旗桿立起 → 小旗展開，最晚 1.2 秒）、
   總重量從 0 數上來、時長／組數／本週第幾次、這次的亮點（最多三條，沒有就不出這段，不硬湊鼓勵的話）、練到的肌群；
   空白開始的訓練可以在這裡存成課表。底部「好」回訓練頁。減少動態：整頁只淡入、數字直接到位（app.css 的 reduced-motion 區塊）。 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useCountUp } from '@/components/useCountUp'
import { useSkyEdge } from '@/components/useSkyEdge'
import { checkRoutineName, formatKg, type TrainingDb } from '@/lib/training'
import { trainedGroups, weekOrdinal, workoutHighlights, type Highlight } from '@/lib/trainingHome'

interface FinishCelebrationProps {
  db: TrainingDb
  workoutId: string
  /** 照課表開的寫課表名，空白開始的 null。 */
  routineName: string | null
  volume: number
  /** 補記沒填時長＝null。 */
  minutes: number | null
  doneSets: number
  canSaveRoutine: boolean
  busy: boolean
  error: string | null
  onSaveRoutine: (name: string) => Promise<boolean>
  onDone: () => void
}

/* 登頂小景：同 App 圖示「山丘日出＋小徑」的語言。各層各自一個 class，進場動畫在 app.css（.fc-art 底下），只動 transform／opacity */
function SummitScene() {
  return (
    <svg className="art fc-art" viewBox="0 0 393 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <rect width="393" height="200" fill="var(--sky)" />
      <g className="fc-cloud" fill="var(--snow)" opacity=".9">
        <ellipse cx="52" cy="30" rx="20" ry="8" />
        <ellipse cx="66" cy="23" rx="14" ry="9" />
        <ellipse cx="80" cy="30" rx="15" ry="7" />
        <ellipse cx="320" cy="36" rx="12" ry="5" />
        <ellipse cx="330" cy="32" rx="9" ry="6" />
      </g>
      <g className="fc-sun">
        <circle cx="196" cy="84" r="54" fill="var(--sun-pale)" opacity=".75" />
        <circle cx="196" cy="84" r="32" fill="var(--sun)" />
      </g>
      <g className="fc-pole">
        <rect x="194.8" y="34" width="2.4" height="44" rx="1.2" fill="var(--ink)" />
      </g>
      <path className="fc-flag" d="M197.2 34l22 7-22 7z" fill="var(--clay)" />
      <g className="fc-hill-far">
        <path d="M0 150C70 130 150 110 196 76S310 128 393 140V200H0z" fill="var(--hill-far)" />
        <path d="M188 92c-6 14-14 26-26 38s-22 22-30 34" fill="none" stroke="var(--sun-pale)" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 8" />
      </g>
      <g className="fc-hill-mid">
        <path d="M0 172C80 156 170 160 240 168S350 156 393 162V200H0z" fill="var(--hill-mid)" />
        <g transform="translate(46 160)">
          <rect x="-1.6" y="2" width="3.2" height="10" rx="1.6" fill="var(--tree)" />
          <circle cx="0" cy="0" r="8" fill="var(--tree)" />
        </g>
      </g>
      <path d="M0 194C90 186 200 189 290 194S370 192 393 192V200H0z" fill="var(--paper)" />
    </svg>
  )
}

function HighlightIcon({ kind }: { kind: Highlight['kind'] }) {
  if (kind === 'record')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 21V4" />
        <path d="M7 5l11 3.5L7 12z" fill="var(--clay)" stroke="none" />
      </svg>
    )
  if (kind === 'vsLast')
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16l5-5 4 3 7-7" />
        <path d="M15 7h5v5" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21v-8" />
      <path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2-5-6-5 0 3 2 5 6 5z" />
    </svg>
  )
}

function highlightText(h: Highlight): { text: string; tag: string | null } {
  if (h.kind === 'record') return { text: `${h.name} 推估極限 ${Math.round(h.e1rm)} kg`, tag: `新高 +${formatKg(h.delta)}` }
  if (h.kind === 'vsLast') return { text: `比上次${h.routineName}${h.pct > 0 ? '多' : '少'} ${Math.abs(h.pct)}%`, tag: null }
  return { text: `第一次做 ${h.name}`, tag: null }
}

export default function FinishCelebration(p: FinishCelebrationProps) {
  // 以百分之一公斤滾（重量有 62.5 這種小數，總重 312.5 不能捨成 313，跟訓練中與首頁的數字要一致）
  const shown = useCountUp(Math.round(p.volume * 100), { from: 0, ms: 850 }) / 100
  // 登頂小景頂著狀態列：色條染成天空色，捲走了回紙色（同今日頁）
  const edge = useSkyEdge()
  // 這一頁開著時資料不會再變（訓練已結束）；只在掛上時算一次，之後別台裝置同步進來也不讓亮點跳動
  const [highlights] = useState(() => workoutHighlights(p.db, p.workoutId))
  const [groups] = useState(() => trainedGroups(p.db, p.workoutId))
  const [nth] = useState(() => weekOrdinal(p.db, p.workoutId))
  const title = useMemo(() => (p.routineName ? `${p.routineName} · 練完了` : '練完了'), [p.routineName])
  // 確認 sheet 收起、整頁換成這一頁：焦點接到標題，不掉回 body
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => titleRef.current?.focus(), [])

  const [naming, setNaming] = useState(false)
  const [routineName, setRoutineName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [savedAs, setSavedAs] = useState<string | null>(null)
  // 同步的重入擋：Enter 不經過按鈕的 disabled，連按兩次會存出兩份同名課表（課表只能封存、刪不掉）
  const saving = useRef(false)
  const saveRoutine = async () => {
    if (saving.current) return
    const check = checkRoutineName(routineName)
    if (!check.ok) {
      setNameError(check.error)
      return
    }
    setNameError(null)
    saving.current = true
    try {
      if (await p.onSaveRoutine(check.name)) {
        setSavedAs(check.name)
        setNaming(false)
      }
    } finally {
      saving.current = false
    }
  }

  return (
    <div className="main fc" data-screen="finish" role="dialog" aria-modal="true" aria-labelledby="fc-title">
      <div className="fc-scroll" ref={edge.ref} onScroll={edge.sync}>
        <SummitScene />
        <div className="fc-body">
          <h1 className="fc-title" id="fc-title" ref={titleRef} tabIndex={-1}>
            {title}
          </h1>
          <div className="fc-big">
            <span className="sr-only">總重量 {p.volume.toLocaleString('en-US')} 公斤</span>
            <span className="v" data-testid="finish-volume" aria-hidden="true">
              {shown.toLocaleString('en-US')}
            </span>
            <span className="u" aria-hidden="true">
              kg
            </span>
          </div>
          <div className="fc-big-l">總重量</div>
          <div className="fc-stats">
            <div>
              <span className="v">{p.minutes ?? '—'}</span>
              <span className="l">分鐘</span>
            </div>
            <div>
              <span className="v">{p.doneSets}</span>
              <span className="l">組</span>
            </div>
            <div>
              <span className="v">第 {nth} 次</span>
              <span className="l">本週</span>
            </div>
          </div>

          {highlights.length > 0 && (
            <section className="fc-sec" aria-labelledby="fc-hl">
              <h2 id="fc-hl">這次的亮點</h2>
              <ul className="tr-card fc-hl" data-section="highlights">
                {highlights.map((h, i) => {
                  const { text, tag } = highlightText(h)
                  return (
                    <li key={i} className="fc-hl-row" data-kind={h.kind} style={{ '--i': i } as CSSProperties}>
                      <span className="fc-hl-ic">
                        <HighlightIcon kind={h.kind} />
                      </span>
                      <span className="grow">{text}</span>
                      {tag && <span className="fc-hl-tag">{tag}</span>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {groups.length > 0 && (
            <section className="fc-sec" aria-labelledby="fc-gr">
              <h2 id="fc-gr">練到的</h2>
              <div className="fc-groups">
                {groups.map((g) => (
                  <span key={g} className="fc-group">
                    {g}
                  </span>
                ))}
              </div>
            </section>
          )}

          {p.canSaveRoutine && (
            <div className="tr-card tr-save-routine fc-sec" data-section="save-routine">
              {savedAs !== null ? (
                <div className="tr-row" role="status">
                  <span className="grow">
                    <span className="nm">已存成課表「{savedAs}」</span>
                    <span className="sub">下次開始訓練可以直接選</span>
                  </span>
                </div>
              ) : naming ? (
                <div className="tr-save-form">
                  <label className="tr-field">
                    <span className="lb">課表名稱</span>
                    <input
                      className="is-text"
                      type="text"
                      value={routineName}
                      aria-label="課表名稱"
                      aria-invalid={nameError !== null}
                      placeholder="例如：菜單 A"
                      autoComplete="off"
                      onChange={(e) => setRoutineName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void saveRoutine()
                        }
                      }}
                    />
                    {nameError && <span className="hint is-error">{nameError}</span>}
                  </label>
                  <button className="tr-secondary tr-save-go" type="button" disabled={p.busy} onClick={() => void saveRoutine()}>
                    存成課表
                  </button>
                </div>
              ) : (
                <button className="tr-row accent" type="button" data-action="save-as-routine" onClick={() => setNaming(true)}>
                  <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
                  </svg>
                  <span className="grow">
                    <span className="nm">存成課表</span>
                    <span className="sub">這次是空白開始的，下次可以直接選</span>
                  </span>
                </button>
              )}
            </div>
          )}
          {p.error && (
            <p className="tr-form-error" role="alert">
              {p.error}
            </p>
          )}
        </div>
      </div>
      <div className="fc-foot">
        <button className="action-btn" type="button" data-action="finish-done" onClick={p.onDone}>
          好
        </button>
      </div>
    </div>
  )
}
