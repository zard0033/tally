/* 記一筆「找東西的列」（spec「記一筆重做：兩個情境」，v2.167）：常吃、整組、搜尋結果、你在那家記過的、食品庫頁共用這一種列。
   名字（對到的字深藍粗體）＋店家灰字（或店名小標）；小字「蛋白 Ng · 上次 …」；熱量；右邊一顆 ＋，加了變 ✓，再按一次從這一餐拿掉。
   整列是一顆鈕（aria-pressed），命中區不只右邊那顆圈。 */
import type { ReactNode } from 'react'
import { highlightRuns } from '@/lib/logFind'

export interface FindRowProps {
  /** 畫面上的穩定鍵（data-key）。 */
  rowKey: string
  name: string
  /** 品名上對到的字（碼位）；完全符合＝整串。 */
  hits?: readonly number[]
  vendor?: string | null
  /** 店家畫成小標（你在那家記過的）而不是灰字。 */
  vendorTag?: boolean
  /** 名字前面的小標（「整組」）。 */
  lead?: string
  sub: string
  kcal: number
  /** 已經在這一餐：✓。 */
  added: boolean
  /** 加進去會超標：熱量轉紅，下面一行「+N 卡」之類（逐筆超標預警，v2.10）。 */
  over?: { delta: string; aria: string } | null
  onToggle: () => void
}

export function NameRuns({ name, hits }: { name: string; hits?: readonly number[] }): ReactNode {
  if (!hits?.length) return name
  return highlightRuns(name, hits).map((r, i) => (r.hit ? <b key={i} className="hl">{r.text}</b> : <span key={i}>{r.text}</span>))
}

export default function FindRow({ rowKey, name, hits, vendor, vendorTag, lead, sub, kcal, added, over, onToggle }: FindRowProps) {
  const k = Math.round(kcal)
  return (
    <li>
      <button
        className="find-row"
        type="button"
        data-key={rowKey}
        aria-pressed={added}
        aria-label={`${lead ? `${lead}，` : ''}${name}${vendor ? `，${vendor}` : ''}${sub ? `，${sub}` : ''}，${k} 大卡${over && !added ? `，加入後${over.aria}` : ''}`}
        onClick={onToggle}
      >
        <span className="fr-tx" aria-hidden="true">
          <span className="fr-nm">
            {lead && <span className="fr-lead">{lead}</span>}
            <span className="fr-name"><NameRuns name={name} hits={hits} /></span>
            {vendor && <span className={vendorTag ? 'fr-tag' : 'fr-vd'}>{vendor}</span>}
          </span>
          {sub && <span className="fr-sub">{sub}</span>}
        </span>
        <span className="fr-kc-wrap" aria-hidden="true">
          <span className={over && !added ? 'fr-kc num over' : 'fr-kc num'}>{k}</span>
          {over && !added && over.delta && <span className="kc-delta">{over.delta}</span>}
        </span>
        <span className="fr-add" aria-hidden="true">
          <svg viewBox="0 0 24 24">{added ? <path d="M7 12.5l3.2 3.2L17 9" /> : <path d="M12 7v10M7 12h10" />}</svg>
        </span>
      </button>
    </li>
  )
}
