/* 份量步進器：− ／ 數字框 ／ +。Today 的就地編輯區與 LogSheet 的挑選列共用同一組 DOM 與 class，
   差別只有 aria-label 要不要帶品名（LogSheet 一次列出多筆，Today 的編輯區本身已有 aria-label）。
   狀態都留在呼叫端：Today 的 commitQty／savedQty 有樂觀回滾，LogSheet 的 picks／drafts 是 Map，
   這裡只接 callback。 */
export default function QtyStepper({
  qty,
  draft,
  name,
  onStep,
  onInput,
  onBlur,
  disabled = false,
}: {
  qty: number
  draft: string
  /** 給了就把品名帶進 aria-label */
  name?: string
  onStep: (dir: 1 | -1) => void
  onInput: (raw: string) => void
  onBlur: (raw: string) => void
  /** 整組鎖住（記一筆已經存好食品庫、等重試的那一列）：兩顆鈕停用、數字唯讀 */
  disabled?: boolean
}) {
  return (
    <div className="qty-stepper">
      <button
        className="qty-btn"
        type="button"
        disabled={disabled || qty <= 1}
        aria-label={name ? `減少 ${name} 的份量` : '減少份量'}
        onClick={() => onStep(-1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>
      <input
        className="qty-value"
        type="text"
        inputMode="decimal"
        aria-label={name ? `${name} 份量` : '份量'}
        value={draft}
        readOnly={disabled}
        onChange={(e) => onInput(e.target.value)}
        onBlur={(e) => onBlur(e.target.value)}
      />
      <button
        className="qty-btn"
        type="button"
        disabled={disabled}
        aria-label={name ? `增加 ${name} 的份量` : '增加份量'}
        onClick={() => onStep(1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  )
}
