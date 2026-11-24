/* 記一筆的「這一餐」段（spec「一個框記一餐」，v2.164，樣張 `_design-sample/one-box.html` 甲）：框裡打完的每一段一列，照打的順序。
   勾好的食品庫列由 LogSheet 畫（同清單勾選那一列：份數、份量微調）；這裡畫待估列與估好的草稿列。
   草稿列的規則同 v2.134–v2.154 的估一筆（改名、改熱量照比例、範圍與假設、修正、存進食品庫、相近、改用 AI 估），
   AI 的視覺身分（光暈、熱量從 0 滾上去、落定亮一圈）搬到待估列的「估」與估的過程。
   動效只動 transform／opacity；減少動態時循環全停、浮現改 ≤120ms 淡入、數字直接到位（CSS ＋ useReducedMotion）。 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import QtyStepper from '@/components/QtyStepper'
import type { Food } from '@/lib/api'
import { canFix, defaultDraftName, draftName, fixTag, fixTextOk, libShown, parseKcal, TIERS, type EstimateDraft, type TierKey } from '@/lib/estimate'
import { duplicateCheck, foodLabel } from '@/lib/foodMatch'
import { sourceTag } from '@/lib/foodSource'
import type { MealEntry } from '@/lib/mealBox'
import type { MealKey } from '@/lib/meals'

export type FixStatus = 'idle' | 'busy' | 'error'

/** 一列的修正（spec A2 階段 1，v2.151）：框開著沒有、打到一半的字、送出狀態。 */
export interface FixState {
  open: boolean
  text: string
  status: FixStatus
}

type Pending = Extract<MealEntry, { kind: 'pending' }>

interface Props {
  /** 品名用餐別頂替的列（檔位、自己打的）顯示與寫入都跟著目前的餐別；已經建好食物的列品名已定下來，不再跟著變。 */
  meal: MealKey
  entries: MealEntry[]
  drafts: ReadonlyMap<string, EstimateDraft>
  /** 勾好的食品庫列：LogSheet 用清單那一列的畫法（回傳 <li>）。 */
  renderPick: (key: string) => ReactNode
  /** 剛估好回來的草稿 → 在那一批裡的第幾樣：播浮現（每樣錯開 90ms，只算這一批）與熱量滾動。檔位、自己打的不播。 */
  fresh: ReadonlyMap<string, number>
  /** 讀屏播報（等的說法、估好了、已照…修正）。估不出來由那一列自己的 role=alert 唸。 */
  said: string
  /** 寫入中：草稿不能改、待估不能估。 */
  locked: boolean
  fixes: Record<string, FixState>
  /** 有一列正在修正：其他列的修正停用（一次只修一列）。 */
  fixBusy: boolean
  /** 使用中的食品庫：AI 的列勾「存進食品庫」時查重（AC 13）。 */
  foods: Food[]
  onEstimate: (id: string) => void
  onEstimateAll: () => void
  onRemovePending: (id: string) => void
  /** 待估列「自己打」框裡的字：存在那一列上，去新增食物再回來不會不見 */
  onOwnText: (id: string, v: string) => void
  onToggleTiers: (id: string) => void
  onTier: (id: string, k: TierKey) => void
  onOwnKcal: (id: string, kcal: number) => void
  /** 待估列的相近提示按「改用」：那一列換成食品庫那一筆（勾好）。 */
  onAdoptPending: (id: string, foodId: number) => void
  onKcalInput: (key: string, raw: string) => void
  onKcalBlur: (key: string) => void
  onName: (key: string, v: string) => void
  onDelete: (key: string) => void
  onToggleKeep: (key: string) => void
  onFixToggle: (key: string) => void
  onFixText: (key: string, v: string) => void
  onFixSubmit: (key: string) => void
  onLibStep: (key: string, dir: 1 | -1) => void
  onLibQtyInput: (key: string, raw: string) => void
  onLibQtyBlur: (key: string, raw: string) => void
  onLibToAi: (key: string) => void
  /** 相近提示的「改用」、查重的「改用那筆」：那一列換成食品庫的那一筆。 */
  onAdopt: (key: string, foodId: number) => void
}

/** 書本小圖示：食品庫的記號。 */
const BookIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h4.5a1.5 1.5 0 0 1 1.5 1.5v8M13 3.5H8.5" /><path d="M3 3.5v9h5M13 3.5v9H9" /></svg>
)
const CrossIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
)

/** 等的時候換三次說法。秒數界線是設計決定（實測 p50 約 7 秒），只是讓人知道還在跑，不代表真的在做哪一步。 */
function waitText(sec: number): string {
  return sec < 2 ? '在看你吃了什麼…' : sec < 4 ? '估份量中…' : '算熱量中…'
}

/** 熱量框：AI 剛回來時先從 0 滾到估算值（600ms），滾完才變成可編輯的框；減少動態時直接到位。 */
function KcalField({ d, name, animate, landed, locked, onInput, onBlur }: { d: EstimateDraft; name: string; animate: boolean; landed?: boolean; locked: boolean; onInput: (raw: string) => void; onBlur: () => void }) {
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
    <label className={landed ? 'est-kc landed' : 'est-kc'}>
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

/** 待估列：段落原文＋「估」（主要動作，太陽色）＋✕；下面「只記熱量」展開三個檔位與自己打。估的時候整列繞光、寫在等什麼。 */
function PendingRow({ e, locked, onEstimate, onRemove, onToggleTiers, onTier, onOwnKcal, onOwnText, onAdopt }: {
  e: Pending
  locked: boolean
  onEstimate: () => void
  onRemove: () => void
  onToggleTiers: () => void
  onTier: (k: TierKey) => void
  onOwnKcal: (kcal: number) => void
  onOwnText: (v: string) => void
  onAdopt: (foodId: number) => void
}) {
  const busy = e.status === 'busy'
  const own = e.own
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy])
  const sec = e.startedAt ? Math.max(0, Math.floor((now - e.startedAt) / 1000)) : 0
  const ownKcal = parseKcal(own)
  return (
    <li className={busy ? 'meal-pend busy' : 'meal-pend'} data-key={e.id} tabIndex={-1} aria-busy={busy}>
      <div className={busy ? 'ai-ring busy' : 'ai-ring'}>
        <div className="ai-inner mp-in">
          <span className="mp-tx">{e.text}</span>
          {/* 估的時候不拿掉、不用 disabled：焦點留在這顆鈕上（disabled 會把焦點丟到 body），點了也不會重送 */}
          <button
            className="est-go mp-go"
            type="button"
            aria-label={busy ? `正在估${e.text}` : `${e.status === 'error' ? '重試估' : '估'}${e.text}`}
            aria-disabled={busy || locked}
            onClick={() => !busy && !locked && onEstimate()}
          >
            {busy ? '估算中' : e.status === 'error' ? '重試' : '估'}
          </button>
          <button className="est-del" type="button" aria-label={`拿掉${e.text}`} disabled={busy || locked} onClick={onRemove}>
            <CrossIcon />
          </button>
          {busy ? (
            <p className="mp-wait" aria-hidden="true">{waitText(sec)}<span className="num">{sec} 秒</span></p>
          ) : (
            <div className="mp-foot">
              {e.status === 'error' && <span className="mp-err" role="alert">這一樣估不出來，可以重試或只記熱量</span>}
              <button className="row-pill mp-only" type="button" aria-expanded={e.tiers} disabled={locked} onClick={onToggleTiers}>
                只記熱量
              </button>
            </div>
          )}
          {e.near && !busy && (
            <div className="est-near">
              <p>食品庫有「<b>{foodLabel(e.near)}</b>」<span className="num">{e.near.kcal}</span> 卡</p>
              <button className="row-pill solid" type="button" aria-label={`改用食品庫的${foodLabel(e.near)}`} disabled={locked} onClick={() => e.near && onAdopt(e.near.id)}>改用</button>
            </div>
          )}
          {e.tiers && !busy && (
            <div className="mp-tiers">
              <p className="mp-tiers-lb">想不起來吃了什麼？選最接近的一種，只記熱量</p>
              <div className="est-tiers">
                {TIERS.map((t) => (
                  <button key={t.key} className="est-tier" type="button" disabled={locked} onClick={() => onTier(t.key)}>
                    <b>{t.label}</b>
                    <i>{t.examples}</i>
                    <small className="num">約 {t.kcal}</small>
                  </button>
                ))}
              </div>
              <form
                className="est-own"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  if (ownKcal === null || locked) return
                  onOwnKcal(ownKcal)
                }}
              >
                <label htmlFor={`own-${e.id}`}>自己打</label>
                <input id={`own-${e.id}`} className="num" type="text" inputMode="decimal" placeholder="熱量" value={own} disabled={locked} onChange={(ev) => onOwnText(ev.target.value)} />
                <span>卡</span>
                <button type="submit" className="est-own-add" disabled={ownKcal === null || locked}>記這個</button>
              </form>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export default function MealSection(p: Props) {
  const composingRef = useRef(false)
  /* 剛修正完的列（fixCount 比上次看到的多）：熱量框重掛、從 0 滾到新數字並亮一圈（同 AI 剛回來），焦點回那一列的「修正」。
     第一次看到的列把當下的次數記成看過。 */
  const [fixSeen, setFixSeen] = useState<Record<string, number>>({})
  const [justFixed, setJustFixed] = useState<{ key: string; n: number } | null>(null)
  const allDrafts = [...p.drafts.values()]
  const unseen = allDrafts.filter((d) => fixSeen[d.key] === undefined)
  if (unseen.length) setFixSeen((s) => ({ ...s, ...Object.fromEntries(unseen.map((d) => [d.key, d.fixCount])) }))
  const refixed = allDrafts.find((d) => fixSeen[d.key] !== undefined && d.fixCount > fixSeen[d.key])
  if (refixed) {
    setFixSeen((s) => ({ ...s, [refixed.key]: refixed.fixCount }))
    setJustFixed({ key: refixed.key, n: refixed.fixCount })
  }
  const fixBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  useEffect(() => {
    if (justFixed) fixBtnRefs.current[justFixed.key]?.focus()
  }, [justFixed])

  const waiting = p.entries.filter((e): e is Pending => e.kind === 'pending' && e.status !== 'busy')

  function renderDraft(d: EstimateDraft) {
    if (d.lib) {
      const lib = d.lib
      const shown = libShown(lib)
      const tag = sourceTag(lib.food.verified)
      const made = d.foodId !== null
      return (
        <li key={d.key} className="est-draft est-lib" data-key={d.key} tabIndex={-1}>
          <span className="est-lib-name">
            {shown.vendor && <span className="vd">{shown.vendor}</span>}
            {shown.name}
          </span>
          <QtyStepper qty={lib.qty} draft={lib.qtyDraft} name={shown.name}
            onStep={(dir) => !p.locked && p.onLibStep(d.key, dir)}
            onInput={(raw) => !p.locked && p.onLibQtyInput(d.key, raw)}
            onBlur={(raw) => p.onLibQtyBlur(d.key, raw)} />
          <span className="est-lib-kc num" aria-label={`${d.kcal} 卡`}>{d.kcal}<small aria-hidden="true">卡</small></span>
          <button className="est-del" type="button" aria-label={`刪掉${shown.name}`} disabled={p.locked || made} onClick={() => p.onDelete(d.key)}>
            <CrossIcon />
          </button>
          <div className="est-row-foot">
            <span className="est-lib-tag"><BookIcon />食品庫・<b>{tag}</b></span>
            {lib.ai && (
              <button className="row-pill" type="button" disabled={p.locked || p.fixBusy || made} onClick={() => p.onLibToAi(d.key)}>
                改用 AI 估
              </button>
            )}
          </div>
        </li>
      )
    }
    const freshAt = p.fresh.get(d.key)
    const fresh = freshAt !== undefined
    const name = draftName(d, p.meal)
    /* 已經建好 foods 的列（寫 intake 失敗、等重試）鎖住：再改熱量、勾選或刪掉，都會跟已建的食物對不上（review N1） */
    const made = d.foodId !== null
    const fix = p.fixes[d.key]
    const fixing = fix?.status === 'busy'
    const fixable = canFix(d)
    const near = d.near && !d.noLib && !made ? d.near : null
    /* 勾了「存進食品庫」才查重（AC 13）：同名（沒有店家）已經有了就不會再存一筆，給「改用那筆」 */
    const dup = d.keep && !made ? duplicateCheck({ name, vendor: null }, p.foods) : null
    return (
      <li key={d.key} className={fresh ? 'est-draft fresh' : 'est-draft'} data-key={d.key} tabIndex={-1} style={freshAt ? { animationDelay: `${freshAt * 90}ms` } : undefined}>
        {/* 品名可以改（使用者 2026-11-13）；空著＝用「餐別＋檔位」頂替，寫入時才決定是哪一餐 */}
        <input
          className="est-name"
          type="text"
          aria-label={`品名，${name}`}
          placeholder={defaultDraftName(d, p.meal)}
          value={d.name}
          readOnly={p.locked || made}
          onChange={(e) => p.onName(d.key, e.target.value)}
        />
        {/* key 帶修正次數：修正完重掛，從 0 滾到新數字（同 AI 剛回來）；修正中鎖住，回來的結果會換掉它 */}
        <KcalField key={`${d.key}-${d.fixCount}`} d={d} name={name} animate={fresh || justFixed?.key === d.key} landed={justFixed?.key === d.key}
          locked={p.locked || made || fixing} onInput={(raw) => p.onKcalInput(d.key, raw)} onBlur={() => p.onKcalBlur(d.key)} />
        <button className="est-del" type="button" aria-label={`刪掉${name}`} disabled={p.locked || made || fixing} onClick={() => p.onDelete(d.key)}>
          <CrossIcon />
        </button>
        {d.fixedBy && <span className="est-fixed">☀ 已照「{fixTag(d.fixedBy)}」修正</span>}
        {(d.low !== null || d.assumption) && (
          <span className="est-why">
            {d.low !== null && d.high !== null && <span className="rng num">{d.low}–{d.high}</span>}
            {d.assumption}
          </span>
        )}
        {d.kcalOnly && (
          <span className="est-why">
            <span className="est-only">只估了熱量</span>蛋白質、脂肪、碳水記 0，首頁的蛋白質、脂肪、碳水會少算
          </span>
        )}
        {d.macrosGuessed && (
          <span className="est-why">
            <span className="est-only">粗估</span>三大營養素照你平常這一餐的比例
          </span>
        )}
        {fix?.open && fixable && (
          <div className="est-fix">
            <div className={fixing ? 'ai-ring busy' : 'ai-ring'}>
              <div className="ai-inner">
                <input
                  className="est-fix-in"
                  type="text"
                  autoFocus
                  aria-label={`修正${name}`}
                  placeholder="例如：5 塊、沒加泡菜、半糖"
                  value={fix.text}
                  readOnly={fixing}
                  aria-busy={fixing}
                  onChange={(e) => p.onFixText(d.key, e.target.value)}
                  onCompositionStart={() => (composingRef.current = true)}
                  onCompositionEnd={() => (composingRef.current = false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && !fixing) {
                      /* 只收起這個框，sheet 不能跟著關：v2.164 實測 Esc 會一路傳到 sheet（Base UI Dialog）把整個記一筆關掉
                         （v2.151 的子畫面沒有）——在這裡擋下。e2e「Esc 只收起框不關 sheet」等過退場時間再看 sheet 還在 */
                      e.preventDefault()
                      e.stopPropagation()
                      p.onFixToggle(d.key)
                      fixBtnRefs.current[d.key]?.focus()
                      return
                    }
                    if (e.key !== 'Enter' || composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
                    e.preventDefault()
                    if (fixTextOk(fix.text) && !fixing) p.onFixSubmit(d.key)
                  }}
                />
              </div>
            </div>
            <button className="est-go est-fix-go" type="button" disabled={!fixTextOk(fix.text) || p.fixBusy || p.locked} onClick={() => p.onFixSubmit(d.key)}>
              {fix.status === 'error' ? '重試' : '重估'}
            </button>
          </div>
        )}
        {fix?.open && fixable && fix.status === 'error' && (
          <p className="est-fix-err" role="alert">修正沒成功，原本的估算還在</p>
        )}
        {near && (
          <div className="est-near">
            <p>食品庫有「<b>{foodLabel(near)}</b>」<span className="num">{near.kcal}</span> 卡</p>
            <button className="row-pill solid" type="button" aria-label={`改用食品庫的${foodLabel(near)}`}
              disabled={p.locked || p.fixBusy || fixing} onClick={() => p.onAdopt(d.key, near.id)}>改用</button>
          </div>
        )}
        <label className="est-keep">
          <input type="checkbox" checked={d.keep} disabled={p.locked || made} onChange={() => p.onToggleKeep(d.key)} />
          存進食品庫
        </label>
        {fixable && (
          <button
            ref={(el) => { fixBtnRefs.current[d.key] = el }}
            className="est-fix-btn row-pill"
            type="button"
            aria-expanded={!!fix?.open}
            aria-label={`修正${name}`}
            disabled={p.locked || p.fixBusy}
            onClick={() => p.onFixToggle(d.key)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z" /></svg>
            修正
          </button>
        )}
        {dup?.block ? (
          <div className="est-near est-dup" role="alert">
            <p>食品庫已有「<b>{foodLabel(dup.block)}</b>」，不會再存一筆</p>
            <button className="row-pill" type="button" disabled={p.locked || p.fixBusy || fixing}
              onClick={() => dup.block && p.onAdopt(d.key, dup.block.id)}>改用那筆</button>
          </div>
        ) : (
          dup?.note && <p className="dup-note est-dup-note">食品庫已有{dup.note.vendor ? ` ${dup.note.vendor} 的` : ''}「{dup.note.name}」，不同店家照樣存</p>
        )}
      </li>
    )
  }

  if (p.entries.length === 0) return null
  return (
    <section className="meal-sect" aria-label="這一餐">
      <div className="sect-lb sect-meal">
        <span>這一餐</span>
        {waiting.length >= 2 && (
          <button className="sect-act" type="button" aria-label={`全部估，${waiting.length} 樣`} disabled={p.locked} onClick={p.onEstimateAll}>
            全部估
          </button>
        )}
      </div>
      {/* 讀屏播報一直掛著——跟內容一起插進去的 live region 很多讀屏不會唸第一句（review N4） */}
      <p className="sr-only" role="status" aria-live="polite">{p.said}</p>
      <ul className="food-list meal-rows">
        {p.entries.map((e) => {
          if (e.kind === 'pick') return p.renderPick(e.key)
          if (e.kind === 'pending')
            return (
              <PendingRow
                key={e.id}
                e={e}
                locked={p.locked}
                onEstimate={() => p.onEstimate(e.id)}
                onRemove={() => p.onRemovePending(e.id)}
                onToggleTiers={() => p.onToggleTiers(e.id)}
                onTier={(k) => p.onTier(e.id, k)}
                onOwnKcal={(k) => p.onOwnKcal(e.id, k)}
                onOwnText={(v) => p.onOwnText(e.id, v)}
                onAdopt={(id) => p.onAdoptPending(e.id, id)}
              />
            )
          const d = p.drafts.get(e.key)
          return d ? renderDraft(d) : null
        })}
      </ul>
    </section>
  )
}
