/* Analysis（動作 e1RM）與 WeightTrend（體重）兩張趨勢圖共用的「這段期間沒有紀錄」。 */
export default function TrendNoRecords({ onSeeAll }: { onSeeAll: () => void }) {
  return (
    <p className="trend-empty">
      這段期間沒有紀錄
      <button type="button" className="trend-link" onClick={onSeeAll}>看全部</button>
    </p>
  )
}
