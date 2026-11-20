import { useEffect } from 'react'
import { useActiveTooltipDataPoints, useIsTooltipActive } from 'recharts'

/* 掛在 recharts 圖裡面，把它自己的 tooltip 狀態（指到哪一點）往上回報日序 t（資料點要有數字欄位 t）。
   讀數跟著這份狀態走，滑鼠、手指、鍵盤方向鍵是同一份——不要改聽圖表的 onMouseMove／onTouchEnd：
   recharts 手指放開不收 tooltip、鍵盤也不呼叫外部回呼，讀數跟十字線會各指一天（v2.146 review，wiki recharts-tooltip）。
   記日序不記索引：切範圍、資料晚到時索引會指到別天。體重趨勢與訓練分析共用。 */
export default function ChartActiveDay({ onDay }: { onDay: (t: number | null) => void }) {
  const active = useIsTooltipActive()
  const pts = useActiveTooltipDataPoints<{ t: number }>()
  const t = active && pts && pts.length > 0 ? pts[0].t : null
  useEffect(() => { onDay(t) }, [t, onDay])
  return null
}
