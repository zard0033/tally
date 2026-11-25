/* 記一筆的「食品庫」頁（spec「記一筆重做：兩個情境」，v2.167，樣張 `_design-sample/logsheet-c5.html` 一、`logsheet-c3.html` 1-6）：
   工具列「食品庫」換到這一頁。可搜尋（同主畫面的比對：一張清單、完全符合排前面）、沒搜尋時照類型分組（組標小灰字）、＋ 加進這一餐；
   最上面「＋ 新增食物（自己填營養標示）」＝原本的新增食物表單；底部「加 N 樣，回到{餐別}」。
   列跟主畫面「找東西的列」同一種（FindRow）；勾的是食物本身那一列（不記品名、店家）。這一樣已經在這一餐（從哪裡加、記成什麼都算）就是 ✓。 */
import { useRef, useState, type ReactNode } from 'react'
import { SheetGrabZone } from '@/components/SpringSheet'
import type { Food } from '@/lib/api'
import { categoryOf, FOOD_CATEGORIES, type FoodCategory } from '@/lib/categories'
import { searchFoods } from '@/lib/logFind'
import FindRow from './FindRow'

interface Props {
  /** sheet 的關閉鈕（跟主畫面同一顆）。 */
  close: ReactNode
  mealLabel: string
  /** 已排好（吃得下的在前、再照品名）的使用中食物。 */
  foods: Food[]
  /** 這一餐裡有哪些食物：決定 ＋ 還是 ✓（從搜尋加的、記了店名或代替品名的也算，不重複加）。 */
  inMealFoods: ReadonlySet<number>
  /** 這次進來加了幾樣（還在這一餐的）。 */
  added: number
  onToggle: (food: Food) => void
  onNewFood: (prefill: string) => void
  onBack: () => void
}

const groupOrder = (c: FoodCategory | null) => (c === null ? FOOD_CATEGORIES.length : FOOD_CATEGORIES.indexOf(c))

export default function LogLibrary({ close, mealLabel, foods, inMealFoods, added, onToggle, onNewFood, onBack }: Props) {
  /* 框裡的字（受控）與拿去找的字分開：注音組字中不找，組字結束那一刻才補上（同主畫面的框） */
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const composingRef = useRef(false)
  const query = filter.trim()
  const row = (f: Food, hits?: number[]) => (
    <FindRow
      key={f.id}
      rowKey={`lib:${f.id}`}
      name={f.name}
      hits={hits}
      vendor={f.vendor}
      sub={`蛋白 ${Math.round(Number(f.protein))}g`}
      kcal={Number(f.kcal)}
      added={inMealFoods.has(f.id)}
      onToggle={() => onToggle(f)}
    />
  )
  let body
  if (query) {
    const hits = searchFoods(foods, query).filter((h) => h.alias === null)
    body = hits.length ? <ul className="find-list">{hits.map((h) => row(h.food, h.hits))}</ul> : <p className="find-empty">食品庫沒有對到「{query}」的</p>
  } else {
    const groups = new Map<FoodCategory | null, Food[]>()
    for (const f of foods) {
      const c = categoryOf(f.category)
      groups.set(c, [...(groups.get(c) ?? []), f])
    }
    const sorted = [...groups].sort((a, b) => groupOrder(a[0]) - groupOrder(b[0]))
    body = sorted.map(([c, fs]) => (
      <section key={c ?? '未分類'} aria-label={c ?? '未分類'}>
        <h3 className="sect-lb">{c ?? '未分類'}</h3>
        <ul className="find-list">{fs.map((f) => row(f))}</ul>
      </section>
    ))
  }
  return (
    <>
      <SheetGrabZone className="libp-head">
        <button className="back-btn" type="button" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {mealLabel}
        </button>
        <span className="sheet-title">食品庫</span>
        {close}
      </SheetGrabZone>
      <div className="search-wrap">
        <div className="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="text"
            placeholder="找食品庫"
            aria-label="找食品庫"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              if (!composingRef.current) setFilter(e.target.value)
            }}
            onCompositionStart={() => (composingRef.current = true)}
            onCompositionEnd={(e) => {
              composingRef.current = false
              setFilter(e.currentTarget.value)
            }}
          />
        </div>
      </div>
      <div className="food-scroll" key="lib-scroll">
        <button className="libp-new" type="button" onClick={() => onNewFood(query)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新增食物（自己填營養標示）
        </button>
        {foods.length === 0 ? <p className="find-empty">食品庫還是空的，按上面新增第一筆。</p> : body}
      </div>
      <div className="pick-bar">
        <button className="pick-bar-btn" type="button" onClick={onBack}>
          {added > 0 ? `加 ${added} 樣，回到${mealLabel}` : `回到${mealLabel}`}
        </button>
      </div>
    </>
  )
}
