/* 記一筆的「這一餐」（spec「記一筆重做：兩個情境」，v2.167，樣張 `_design-sample/logsheet-c3.html` 1-4／1-5、`logsheet-c4.html` 三）：
   食品庫的、AI 估的、只記熱量的全是同一種列——名字＋店家灰字；一行小字「來源 · 蛋白 Ng」；右邊份數＋熱量＋ ›。
   點了原地展開（一次只開一列）：份量；微調（食品庫的照它的類型，同 v2.156）；AI 的多「一份幾卡」與「不對？跟 AI 說」；最下面「拿掉」。
   還在估的列繞光、寫在等什麼；估不出來寫原因＋重試。動效只動 transform／opacity，減少動態時繞光停、浮現改淡入（CSS）。 */
import { useEffect, useRef, useState } from 'react'
import PortionMods from '@/components/PortionMods'
import QtyStepper from '@/components/QtyStepper'
import type { Food } from '@/lib/api'
import { canFix, draftName, fixTag, fixTextOk, isManualDraft } from '@/lib/estimate'
import { foodLabel } from '@/lib/foodMatch'
import { itemTotals, type DraftItem, type EstItem, type LibItem, type MealItem } from '@/lib/logMeal'
import type { MealKey } from '@/lib/meals'
import { summaryOf } from '@/lib/portionMods'

export type FixStatus = 'idle' | 'busy' | 'error'

/** 一列的修正（spec A2 階段 1，v2.151；v2.167 起叫「不對？跟 AI 說」）：框開著沒有、打到一半的字、送出狀態。 */
export interface FixState {
  open: boolean
  text: string
  status: FixStatus
}

interface Props {
  meal: MealKey
  items: MealItem[]
  foodOf: (id: number) => Food | undefined
  /** 展開的那一列（一次只開一列）。 */
  openId: string | null
  onToggleOpen: (id: string) => void
  /** 剛估好回來的列：播浮現。 */
  fresh: ReadonlySet<string>
  /** 寫入中：什麼都不能改。 */
  locked: boolean
  fixes: Record<string, FixState>
  /** 有一列正在修正：其他列的修正停用（一次只修一列）。 */
  fixBusy: boolean
  /** 微調面板收起來的列（展開時預設打開）。 */
  modsClosed: ReadonlySet<string>
  onToggleMods: (id: string) => void
  onQtyStep: (id: string, dir: 1 | -1) => void
  onQtyInput: (id: string, raw: string) => void
  onQtyBlur: (id: string, raw: string) => void
  onMods: (id: string, mods: string[]) => void
  onKcalInput: (id: string, raw: string) => void
  onKcalBlur: (id: string) => void
  onFixToggle: (id: string) => void
  onFixText: (id: string, v: string) => void
  onFixSubmit: (id: string) => void
  onRemove: (id: string) => void
  onRetry: (id: string) => void
  /** AI 的列「食品庫有『X』N 卡　改用」。 */
  onAdopt: (id: string, foodId: number) => void
}

/** 等的時候換三次說法。秒數界線是設計決定（實測 p50 約 7 秒），只是讓人知道還在跑。 */
function waitText(sec: number): string {
  return sec < 2 ? '在看你吃了什麼…' : sec < 4 ? '估份量中…' : '算熱量中…'
}

/** 估不出來的原因：連不上網路，或 AI 沒回應／回得不對（逾時、格式不對都收在 api 那一層，分不出來）。 */
function failText(): string {
  return typeof navigator !== 'undefined' && navigator.onLine === false ? '沒有網路，估不出來' : 'AI 沒回應，估不出來'
}

const Chev = () => (
  <svg className="mr-chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

function EstRow({ item, locked, onRetry, onRemove }: { item: EstItem; locked: boolean; onRetry: () => void; onRemove: () => void }) {
  const busy = item.status === 'busy'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy])
  const sec = item.startedAt ? Math.max(0, Math.floor((now - item.startedAt) / 1000)) : 0
  return (
    <li className={busy ? 'meal-row est busy' : 'meal-row est'} data-key={item.id} tabIndex={-1} aria-busy={busy}>
      <div className={busy ? 'ai-ring busy' : 'ai-ring'}>
        <div className="ai-inner mr-est">
          <span className="mr-tx">
            <span className="mr-nm">
              {item.text}
              {item.store && <span className="mr-vd">{item.store}</span>}
            </span>
            {busy ? (
              <span className="mr-sub" aria-hidden="true">
                {waitText(sec)}<span className="num"> {sec} 秒</span>
              </span>
            ) : (
              <span className="mr-sub mr-err" role="alert">{failText()}</span>
            )}
          </span>
          {!busy && (
            <span className="mr-est-acts">
              <button className="row-pill solid" type="button" aria-label={`重試估${item.text}`} disabled={locked} onClick={onRetry}>重試</button>
              <button className="row-pill" type="button" aria-label={`拿掉${item.text}`} disabled={locked} onClick={onRemove}>拿掉</button>
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

export default function MealSection(p: Props) {
  const composingRef = useRef(false)
  const fixBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  function head(item: LibItem | DraftItem, name: string, vendor: string | null, sub: string, open: boolean) {
    const t = itemTotals(item, p.foodOf)
    const kcal = Math.round(t?.kcal ?? 0)
    return (
      <button
        className="mr-head"
        type="button"
        aria-expanded={open}
        aria-controls={open ? `mr-${item.id}` : undefined}
        aria-label={`${name}${vendor ? `，${vendor}` : ''}，${sub}，${item.qty} 份，${kcal} 大卡`}
        onClick={() => p.onToggleOpen(item.id)}
      >
        <span className="mr-tx" aria-hidden="true">
          <span className="mr-nm">
            {name}
            {vendor && <span className="mr-vd">{vendor}</span>}
          </span>
          <span className="mr-sub">{sub}</span>
        </span>
        <span className="mr-qty num" aria-hidden="true">×{item.qty}</span>
        <span className="mr-kc num" aria-hidden="true">{kcal}</span>
        <Chev />
      </button>
    )
  }

  function qtyLine(item: LibItem | DraftItem, name: string, disabled: boolean) {
    return (
      <div className="mr-line">
        <span className="mr-lb">份量</span>
        <QtyStepper
          qty={item.qty}
          draft={item.qtyDraft}
          name={name}
          disabled={disabled}
          onStep={(dir) => !disabled && p.onQtyStep(item.id, dir)}
          onInput={(raw) => !disabled && p.onQtyInput(item.id, raw)}
          onBlur={(raw) => !disabled && p.onQtyBlur(item.id, raw)}
        />
      </div>
    )
  }

  function removeBtn(item: MealItem, name: string, disabled: boolean) {
    return (
      <button className="row-pill mr-del" type="button" aria-label={`拿掉${name}`} disabled={disabled} onClick={() => p.onRemove(item.id)}>
        拿掉
      </button>
    )
  }

  function renderLib(item: LibItem) {
    const f = p.foodOf(item.foodId)
    if (!f) return null
    const open = p.openId === item.id
    const name = item.name ?? f.name
    const vendor = item.vendor ?? f.vendor
    const t = itemTotals(item, p.foodOf)
    const source = item.name ? `照${f.name}算` : '食品庫'
    const mods = item.mods.length ? ` · ${summaryOf(item.mods, f)}` : ''
    const sub = `${source}${mods} · 蛋白 ${Math.round(t?.protein ?? 0)}g`
    return (
      <li key={item.id} className={open ? 'meal-row open' : 'meal-row'} data-key={item.id}>
        {head(item, name, vendor, sub, open)}
        {open && (
          <div className="mr-body" id={`mr-${item.id}`}>
            {qtyLine(item, name, p.locked)}
            <PortionMods
              target={f}
              base={{ kcal: Number(f.kcal), protein: Number(f.protein), fat: Number(f.fat), carb: Number(f.carb) }}
              mods={item.mods}
              open={!p.modsClosed.has(item.id)}
              onToggleOpen={() => p.onToggleMods(item.id)}
              onChange={(m) => p.onMods(item.id, m)}
              disabled={p.locked}
            />
            <div className="mr-acts">{removeBtn(item, name, p.locked)}</div>
          </div>
        )}
      </li>
    )
  }

  function renderDraft(item: DraftItem) {
    const d = item.draft
    const open = p.openId === item.id
    const name = draftName(d, p.meal)
    const manual = isManualDraft(d)
    const t = itemTotals(item, p.foodOf)
    /* 已經存好食品庫那一筆（加入失敗、等重試）的列鎖住：再改數字或拿掉，都會跟已存的對不上（v2.151 review N1） */
    const made = item.saved !== null
    const fix = p.fixes[item.id]
    const fixing = fix?.status === 'busy'
    const fixable = canFix(d) && !made
    const near = !manual && d.near && !made ? d.near : null
    const sub = `${manual ? '只記熱量' : 'AI 估'} · 蛋白 ${Math.round(t?.protein ?? 0)}g`
    return (
      <li key={item.id} className={`meal-row${open ? ' open' : ''}${p.fresh.has(item.id) ? ' fresh' : ''}`} data-key={item.id}>
        {head(item, name, item.vendor, sub, open)}
        {near && (
          <div className="est-near mr-near">
            <p>食品庫有「<b>{foodLabel(near)}</b>」<span className="num">{near.kcal}</span> 卡</p>
            <button className="row-pill solid" type="button" aria-label={`改用食品庫的${foodLabel(near)}`} disabled={p.locked || fixing} onClick={() => p.onAdopt(item.id, near.id)}>
              改用
            </button>
          </div>
        )}
        {open && (
          <div className="mr-body" id={`mr-${item.id}`}>
            {qtyLine(item, name, p.locked || made)}
            <div className="mr-line">
              <label className="mr-lb" htmlFor={`kc-${item.id}`}>一份幾卡</label>
              <span className="mr-kcin">
                <input
                  id={`kc-${item.id}`}
                  className="num"
                  type="text"
                  inputMode="decimal"
                  value={d.kcalDraft}
                  readOnly={p.locked || made || fixing}
                  onChange={(e) => p.onKcalInput(item.id, e.target.value)}
                  onBlur={() => p.onKcalBlur(item.id)}
                />
                <span aria-hidden="true">卡</span>
              </span>
            </div>
            {d.fixedBy && <p className="est-fixed">☀ 已照「{fixTag(d.fixedBy)}」修正</p>}
            {(d.low !== null || d.assumption) && (
              <p className="est-why">
                {d.low !== null && d.high !== null && <span className="rng num">{d.low}–{d.high}</span>}
                {d.assumption}
              </p>
            )}
            {d.kcalOnly && (
              <p className="est-why"><span className="est-only">只估了熱量</span>蛋白質、脂肪、碳水記 0，首頁的蛋白質、脂肪、碳水會少算</p>
            )}
            {d.macrosGuessed && (
              <p className="est-why"><span className="est-only">粗估</span>三大營養素照你平常這一餐的比例</p>
            )}
            {fix?.open && fixable && (
              <div className="est-fix">
                <div className={fixing ? 'ai-ring busy' : 'ai-ring'}>
                  <div className="ai-inner">
                    <input
                      className="est-fix-in"
                      type="text"
                      autoFocus
                      aria-label={`跟 AI 說${name}哪裡不對`}
                      placeholder="例如：5 塊、沒加泡菜、半糖"
                      value={fix.text}
                      readOnly={fixing}
                      aria-busy={fixing}
                      onChange={(e) => p.onFixText(item.id, e.target.value)}
                      onCompositionStart={() => (composingRef.current = true)}
                      onCompositionEnd={() => (composingRef.current = false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && !fixing) {
                          /* 只收起這個框，sheet 不能跟著關：Esc 會一路傳到 sheet（Base UI Dialog）把整個記一筆關掉（v2.164 實測） */
                          e.preventDefault()
                          e.stopPropagation()
                          p.onFixToggle(item.id)
                          fixBtnRefs.current[item.id]?.focus()
                          return
                        }
                        if (e.key !== 'Enter' || composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
                        e.preventDefault()
                        if (fixTextOk(fix.text) && !fixing) p.onFixSubmit(item.id)
                      }}
                    />
                  </div>
                </div>
                <button className="est-go est-fix-go" type="button" disabled={!fixTextOk(fix.text) || p.fixBusy || p.locked} onClick={() => p.onFixSubmit(item.id)}>
                  {fix.status === 'error' ? '重試' : '重估'}
                </button>
              </div>
            )}
            {fix?.open && fixable && fix.status === 'error' && <p className="est-fix-err" role="alert">修正沒成功，原本的估算還在</p>}
            <div className="mr-acts">
              {fixable && (
                <button
                  ref={(el) => {
                    fixBtnRefs.current[item.id] = el
                  }}
                  className="row-pill"
                  type="button"
                  aria-expanded={!!fix?.open}
                  disabled={p.locked || p.fixBusy}
                  onClick={() => p.onFixToggle(item.id)}
                >
                  不對？跟 AI 說
                </button>
              )}
              {removeBtn(item, name, p.locked || made || fixing)}
            </div>
          </div>
        )}
      </li>
    )
  }

  if (p.items.length === 0) return null
  return (
    <section className="meal-sect" aria-label="這一餐">
      <h3 className="sect-lb sect-strong">這一餐</h3>
      <ul className="meal-rows">
        {p.items.map((it) =>
          it.kind === 'lib' ? renderLib(it) : it.kind === 'draft' ? renderDraft(it) : (
            <EstRow key={it.id} item={it} locked={p.locked} onRetry={() => p.onRetry(it.id)} onRemove={() => p.onRemove(it.id)} />
          ),
        )}
      </ul>
    </section>
  )
}
