/* 動作示意圖的著作權標示（`© Gym visual — https://gymvisual.com/`；NOTICE.md 說明來源）。
   Gym visual 的條款要求**每次使用都附標示**，所以凡是畫面上會出現示意圖的地方都印這一行：動作庫、加動作 sheet、課表編輯、
   訓練中畫面（列表底部）、放大檢視（底部）、設定頁（底部）——六處共用這一個元件，字串只有一份。
   給 `exercises` 時只在列表裡真的有預設動作（有圖的）才印；全是自建動作（沒有圖）就不印。不給＝一定印（放大檢視、設定頁）。 */
import { catalogKey } from '@/lib/exerciseCatalog'
import type { Row } from '@/lib/training'

export const GYM_VISUAL_CREDIT = '© Gym visual — https://gymvisual.com/'

interface GymVisualCreditProps {
  /** 這個畫面列出的動作；沒有任何預設動作（沒有圖）就不印。不給＝一定印。 */
  exercises?: readonly (Row | null)[]
  /** 標示前面的說明（設定頁用「動作示意圖 」）。 */
  prefix?: string
  className?: string
}

export default function GymVisualCredit({ exercises, prefix = '', className = 'img-credit' }: GymVisualCreditProps) {
  if (exercises && !exercises.some((e) => e !== null && catalogKey(e) !== null)) return null
  return (
    <p className={className} data-credit="gym-visual">
      {prefix}
      {GYM_VISUAL_CREDIT}
    </p>
  )
}
