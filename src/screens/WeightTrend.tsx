/* 體重趨勢獨立頁。完整圖表本輪刻意不畫（DESIGN.md「目標計算方式」條之外的另一塊
   刻意收斂範圍）——樣張裡也只放了佔位卡，等圖表本身的視覺定案（要過 dataviz skill）
   再回來實作，這裡先把入口與版面骨架接上，讓設定頁的「體重趨勢」有地方可去。 */
import type { Weight } from '@/lib/api'

export interface WeightTrendProps {
  weights: Weight[] | null
  onBack: () => void
}

export default function WeightTrend({ weights, onBack }: WeightTrendProps) {
  return (
    <div className="main" data-screen="weight-trend">
      <div className="lib-topbar">
        <button className="icon-btn" type="button" aria-label="返回設定" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1>體重趨勢</h1>
      </div>
      <div className="trend-card">
        <div className="ph">
          {weights === null ? '載入中…' : weights.length === 0 ? '還沒有體重紀錄' : `〔完整圖表區域〕共 ${weights.length} 筆`}
        </div>
        <p>近 30 天／90 天／全部，體脂要不要同框——留到圖表定案時再決定。</p>
      </div>
    </div>
  )
}
