/* 新店第一次（spec「記店家改版」甲3，樣張 vendor-directions.html 甲3）：記一筆搜不到時，選一筆差不多的通用食物，
   用它的數字記成「品名 · 店家」（搜尋字切出來的），預設順便把搜尋字掛成它的別名，下次直接搜得到。
   只在記一筆用，不是跨畫面元件，所以放 screens/。狀態（選了哪筆、看全部、記住）留在這裡，送出交給 LogSheet。 */
import { useState } from 'react'
import type { Food } from '@/lib/api'
import { ALIAS_LEN_MAX } from '@/lib/foodForm'
import { num } from '@/lib/formulas'
import { aliasProblem, parseShopQuery } from '@/lib/listRows'

/** 先列幾筆，其餘收在「看全部」。 */
const FIRST = 5

/** 「記住」做不到時寫在卡上的原因（同食品庫表單的別名規則）。exists 不會發生——那樣搜尋就找得到、不會出這張卡。 */
const WHY: Record<'full' | 'long' | 'separator' | 'exists', string> = {
  full: '別名滿了，這次沒記住',
  long: `太長了（別名最多 ${ALIAS_LEN_MAX} 字），這次沒記住`,
  separator: '有頓號或逗號（食品庫會拿它們切別名），這次沒記住',
  exists: '這個名字已經是它的別名了',
}

interface ShopCardProps {
  query: string
  /** 有店家別名的通用食物，最近記過的在前（listRows.genericCandidates）。 */
  candidates: Food[]
  busy: boolean
  /** 「記住」存別名失敗：留在卡上，不勾進清單 */
  error: string | null
  onPick: (food: Food, remember: boolean) => void
  onEstimate: () => void
}

export default function ShopCard({ query, candidates, busy, error, onPick, onEstimate }: ShopCardProps) {
  const [picked, setPicked] = useState<number>(candidates[0]?.id ?? -1)
  const [all, setAll] = useState(false)
  const [remember, setRemember] = useState(true)
  const shown = all ? candidates : candidates.slice(0, FIRST)
  const food = candidates.find((f) => f.id === picked) ?? null
  const { vendor, item } = parseShopQuery(query)
  const label = vendor ? `${item} · ${vendor}` : item
  const problem = food ? aliasProblem(food.aliases, query) : null
  return (
    <div className="shop-card" role="group" aria-label="跟哪一樣差不多？">
      <p className="shop-card-t" aria-hidden="true">跟哪一樣差不多？</p>
      {shown.map((f) => (
        <button key={f.id} className="shop-opt" type="button" aria-pressed={f.id === picked} disabled={busy} onClick={() => setPicked(f.id)}>
          <span className="shop-opt-nm">{f.name}</span>
          <span className="shop-opt-kc">{Math.round(num(f.kcal))}</span>
        </button>
      ))}
      {!all && candidates.length > FIRST && (
        <button className="shop-more" type="button" disabled={busy} onClick={() => setAll(true)}>
          看全部（{candidates.length}）
        </button>
      )}
      <button className="shop-opt shop-opt-est" type="button" disabled={busy} onClick={onEstimate}>
        都不像 → 估一筆
      </button>
      {problem ? (
        <p className="shop-note">{WHY[problem]}</p>
      ) : (
        <label className="shop-keep">
          <input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />
          {/* 有店家段才會變成一列「品名 · 店家」；只打品名的別名只讓搜尋找得到那筆通用食物，不承諾下次記成這個名字 */}
          <span>{vendor ? `記住：下次搜「${query}」直接是這樣` : `記住：下次搜「${query}」找得到這樣`}</span>
        </label>
      )}
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <button className="pick-bar-btn" type="button" disabled={busy || !food} onClick={() => food && onPick(food, remember && !problem)}>
        {busy ? '記住中…' : `記成「${label}」`}
      </button>
    </div>
  )
}
