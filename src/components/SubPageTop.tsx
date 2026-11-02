/* 子頁頂列：返回鈕＋標題。Analysis／DailyGoal／FoodLibrary／WeightTrend／Settings 與 Training
   的 Suspense fallback 共用——fallback 要畫出與真頁面一模一樣的頂列，版面才不會在 lazy chunk
   載入完成時跳動，共用同一個元件就不必靠註解承諾「標記一致」。 */
export default function SubPageTop({ title, backLabel, onBack }: { title: string; backLabel: string; onBack: () => void }) {
  return (
    <div className="lib-topbar">
      <button className="icon-btn" type="button" aria-label={backLabel} onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <h1>{title}</h1>
    </div>
  )
}
