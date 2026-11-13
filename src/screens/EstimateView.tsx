/* 「估一筆」子畫面的主體（spec.md A 節 2026-11-13 版；樣張 `_design-sample/estimate-entry.html` B、
   AI 的光暈／等待插圖／逐樣寫出照 `_design-sample/ai-flair.html` 光暈 A）。
   狀態（描述、草稿、送出中、錯誤）都在 LogSheet，這裡只畫——LogSheet 的確認列與寫入要用同一份草稿。
   動效只動 transform／opacity；減少動態時無限循環全停、逐樣出現改 ≤120ms 淡入、數字直接到位（CSS ＋ useReducedMotion）。 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useReducedMotion } from 'motion/react'
import { defaultDraftName, draftName, parseKcal, TIERS, type EstimateDraft, type TierKey } from '@/lib/estimate'
import type { MealKey } from '@/lib/meals'

export type EstimateStatus = 'idle' | 'busy' | 'error'

interface Props {
  /** 品名用餐別頂替的列（檔位、自己打的）顯示與寫入都跟著目前的餐別；已經建好食物的列品名已定下來，不再跟著變。 */
  meal: MealKey
  text: string
  onText: (v: string) => void
  /** 描述框可以送出（trim 後 1–300 字）。 */
  canSubmit: boolean
  status: EstimateStatus
  /** 送出那一刻（Date.now()），算「已經等了幾秒」。 */
  startedAt: number | null
  onSubmit: () => void
  drafts: EstimateDraft[]
  /** 這一批草稿是剛從 AI 回來的：播逐樣浮現與熱量滾動。檔位、自己打的不播。 */
  revealSeq: number
  onTier: (k: TierKey) => void
  onOwnKcal: (kcal: number) => void
  onKcalInput: (key: string, raw: string) => void
  onKcalBlur: (key: string) => void
  onName: (key: string, v: string) => void
  onDelete: (key: string) => void
  onToggleKeep: (key: string) => void
  /** 寫入中：草稿不能改、檔位不能點。 */
  locked: boolean
}

/** 等的時候換三次說法。秒數界線是設計決定（實測 p50 約 7 秒），只是讓人知道還在跑，不代表真的在做哪一步。 */
function waitText(sec: number): string {
  return sec < 2 ? '在看你吃了什麼…' : sec < 4 ? '估份量中…' : '算熱量中…'
}

/** 熱量框：AI 剛回來時先從 0 滾到估算值（600ms），滾完才變成可編輯的框；減少動態時直接到位。 */
function KcalField({ d, name, animate, locked, onInput, onBlur }: { d: EstimateDraft; name: string; animate: boolean; locked: boolean; onInput: (raw: string) => void; onBlur: () => void }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState<number | null>(animate && !reduced ? 0 : null)
  useEffect(() => {
    if (shown === null) return
    const to = d.kcal
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 600)
      if (k >= 1) return setShown(null)
      setShown(Math.round(to * (1 - Math.pow(1 - k, 3))))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // 只在掛上時跑一次；滾動中的目標就是當下的估算值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <label className="est-kc">
      <input
        className={shown !== null ? 'num counting' : 'num'}
        type="text"
        inputMode="decimal"
        aria-label={`${name}熱量`}
        value={shown !== null ? String(shown) : d.kcalDraft}
        readOnly={shown !== null || locked}
        onChange={(e) => onInput(e.target.value)}
        onBlur={onBlur}
      />
      <span aria-hidden="true">卡</span>
    </label>
  )
}

export default function EstimateView(p: Props) {
  const composingRef = useRef(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const [own, setOwn] = useState('')
  const [now, setNow] = useState(() => Date.now())
  /* 哪一批草稿要播浮現：revealSeq 變了，就把當下的 key 記成「這批是 AI 剛回來的」。 */
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set())
  const [seenSeq, setSeenSeq] = useState(p.revealSeq)
  /* 讀屏播報：送出後唸等待的說法（秒數不唸，否則每秒唸一次），估好了唸「估好了，N 樣」。
     這個 live region 一直掛著——跟內容一起插進去的 live region 很多讀屏不會唸第一句（review N4）。 */
  const [said, setSaid] = useState('')
  if (seenSeq !== p.revealSeq) {
    setSeenSeq(p.revealSeq)
    const fresh = p.drafts.filter((d) => !d.kcalOnly && d.foodId === null)
    setFreshKeys(new Set(fresh.map((d) => d.key)))
    setSaid(`估好了，${fresh.length} 樣`)
  }

  useEffect(() => {
    if (p.status !== 'busy') return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [p.status])
  const sec = p.startedAt ? Math.max(0, Math.floor((now - p.startedAt) / 1000)) : 0

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 注音組字中按 Enter 是在選字，不是送出（spec A AC 10）；Shift+Enter 換行
    if (e.key !== 'Enter' || e.shiftKey || composingRef.current || e.nativeEvent.isComposing) return
    e.preventDefault()
    if (p.canSubmit && p.status !== 'busy') p.onSubmit()
  }

  const ownKcal = parseKcal(own)
  const busy = p.status === 'busy'
  const live = busy ? waitText(sec) : said

  return (
    <div className="est-body">
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
      <div className={busy ? 'ai-ring busy' : 'ai-ring'}>
        <div className="ai-inner">
          <textarea
            id="est-text"
            ref={textRef}
            className="est-text"
            rows={3}
            placeholder="例如：夜市螺獅粉、梅子可樂、一份地瓜球"
            aria-label="描述吃了什麼"
            value={p.text}
            readOnly={busy || p.locked}
            aria-busy={busy}
            onChange={(e) => p.onText(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={() => (composingRef.current = false)}
          />
          <span className="ai-tag" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></svg>
            AI 幫你估
          </span>
        </div>
      </div>
      {!busy && (
        <div className="est-act">
          <span>寫越具體越準：大小、份量、幾顆</span>
          <button className="est-go" type="button" disabled={!p.canSubmit || p.locked} onClick={() => {
              // 估算中這顆鈕會收起來，焦點先交給描述框（readOnly 留得住焦點），不掉到 body
              textRef.current?.focus()
              p.onSubmit()
            }}>
            {p.status === 'error' ? '重試' : '估算'}
          </button>
        </div>
      )}

      {busy && (
        <div className="est-wait">
          <div className="est-stage" aria-hidden="true">
            <svg className="est-rays" viewBox="0 0 56 56"><path d="M28 1v6M28 49v6M1 28h6M49 28h6M9 9l4 4M43 43l4 4M9 47l4-4M43 13l4-4" /></svg>
            <span className="est-sun" />
            <svg className="est-art" viewBox="0 0 160 84">
              <path className="chop" d="M30 12 L132 2" />
              <path className="chop" d="M34 20 L134 12" />
              <path className="bowl" d="M14 36 H146 C146 64 116 80 80 80 S14 64 14 36 Z" />
              <path className="rim" d="M10 36 H150" />
              <path className="noodle" d="M34 34 C44 26 54 40 64 30 S84 26 94 32 S114 40 126 30" />
              <path className="rim" d="M60 80 h40" />
            </svg>
            <span className="est-cover" />
            <span className="est-steam s1" /><span className="est-steam s2" /><span className="est-steam s3" />
            <svg className="est-pencil" viewBox="0 0 24 24"><path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4z" /><path d="M13.5 7.5l3 3" /></svg>
          </div>
          <p className="est-wait-msg" aria-hidden="true">{waitText(sec)}</p>
          <p className="est-wait-sec num" aria-hidden="true">{sec} 秒</p>
        </div>
      )}

      {p.status === 'error' && (
        <p className="est-err" role="alert">
          這次估不出來<small>連線逾時或讀不懂。可以重試，或選最接近的一種。</small>
        </p>
      )}

      {p.drafts.length > 0 && (
        <ul className="est-drafts" aria-label={`估算草稿，${p.drafts.length} 樣`}>
          {p.drafts.map((d, i) => {
            const fresh = freshKeys.has(d.key)
            const name = draftName(d, p.meal)
            /* 已經建好 foods 的列（寫 intake 失敗、等重試）鎖住：再改熱量、勾選或刪掉，都會跟已建的食物對不上（review N1） */
            const made = d.foodId !== null
            return (
              <li key={d.key} className={fresh ? 'est-draft fresh' : 'est-draft'} style={fresh ? { animationDelay: `${i * 90}ms` } : undefined}>
                {/* 品名可以改（使用者 2026-11-13）；空著＝用「餐別＋檔位」頂替，寫入時才決定是哪一餐 */}
                <input
                  className="est-name"
                  type="text"
                  aria-label={`品名，第 ${i + 1} 樣`}
                  placeholder={defaultDraftName(d, p.meal)}
                  value={d.name}
                  readOnly={p.locked || made}
                  onChange={(e) => p.onName(d.key, e.target.value)}
                />
                <KcalField d={d} name={name} animate={fresh} locked={p.locked || made} onInput={(raw) => p.onKcalInput(d.key, raw)} onBlur={() => p.onKcalBlur(d.key)} />
                <button className="est-del" type="button" aria-label={`刪掉${name}`} disabled={p.locked || made} onClick={() => p.onDelete(d.key)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
                {(d.low !== null || d.assumption) && (
                  <span className="est-why">
                    {d.low !== null && d.high !== null && <span className="rng num">{d.low}–{d.high}</span>}
                    {d.assumption}
                  </span>
                )}
                {d.kcalOnly && (
                  <span className="est-why">
                    <span className="est-only">只估了熱量</span>蛋白質、脂肪、碳水記 0，營養素條會偏低
                  </span>
                )}
                <label className="est-keep">
                  <input type="checkbox" checked={d.keep} disabled={p.locked || made} onChange={() => p.onToggleKeep(d.key)} />
                  存進食品庫
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <p className="est-or">想不起來吃了什麼？選最接近的一種，只記熱量</p>
      <div className="est-tiers">
        {TIERS.map((t) => (
          <button key={t.key} className="est-tier" type="button" disabled={p.locked} onClick={() => p.onTier(t.key)}>
            <b>{t.label}</b>
            <i>{t.examples}</i>
            <small className="num">約 {t.kcal}</small>
          </button>
        ))}
      </div>
      <form
        className="est-own"
        onSubmit={(e) => {
          e.preventDefault()
          if (ownKcal === null || p.locked) return
          p.onOwnKcal(ownKcal)
          setOwn('')
        }}
      >
        <label htmlFor="est-own-kcal">自己打</label>
        <input id="est-own-kcal" className="num" type="text" inputMode="decimal" placeholder="熱量" value={own} disabled={p.locked} onChange={(e) => setOwn(e.target.value)} />
        <span>卡</span>
        <button type="submit" className="est-own-add" disabled={ownKcal === null || p.locked}>加一列</button>
      </form>
    </div>
  )
}
