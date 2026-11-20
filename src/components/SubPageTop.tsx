import type { ReactNode } from 'react'

/* 子頁頂列：返回鈕＋標題＋（可選）右側一顆動作。Analysis／DailyGoal／FoodLibrary／WeightTrend／Settings、
   動作庫、課表編輯（v2.147 起，原本是訓練中那套 .tr-top，標題高度差 8px）與 Training 的 Suspense fallback 共用——
   fallback 要畫出與真頁面一模一樣的頂列，版面才不會在 lazy chunk 載入完成時跳動。 */
export default function SubPageTop({ title, backLabel, onBack, action }: { title: string; backLabel: string; onBack: () => void; action?: ReactNode }) {
  return (
    <div className="lib-topbar">
      <button className="icon-btn" type="button" aria-label={backLabel} onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <h1>{title}</h1>
      {action}
    </div>
  )
}
