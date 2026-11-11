/* 設定頁的「AI」段（v2.128，使用者 2026-11-11 裁決：做 AI 設定頁、全站 AI 統一成一份設定）。
   兩列：AI 額度（唯讀，read-label 代查 OpenRouter，key 不離開伺服器）與主模型（存這支手機，見 aiPref.ts）。
   不做 BYOK 輸入 key：單人 app，key 進資料庫或瀏覽器都只是多一個外洩面。 */
import { useState } from 'react'
import { getAiModel, setAiModel } from '@/aiPref'
import { AI_MODELS, aiModelLabel, formatUsd, VISION_CALIBRATED } from '@/lib/aiModels'
import type { AiCredits } from '@/lib/api'

export type CreditsState = { status: 'loading' } | { status: 'ok'; data: AiCredits } | { status: 'err' }

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

function creditsText(c: CreditsState): string {
  if (c.status === 'loading') return '讀取中…'
  if (c.status === 'err') return '讀不到額度'
  const { total_credits, total_usage, usage_monthly } = c.data
  // 兩個浮點數相減可能是 -0.0001，印成 $-0.00；夾到 0
  const left = total_credits !== null && total_usage !== null ? Math.max(0, total_credits - total_usage) : null
  return `剩 ${formatUsd(left)}・本月用了 ${formatUsd(usage_monthly)}`
}

export default function AiSection({ credits }: { credits: CreditsState }) {
  const [model, setModel] = useState(getAiModel)
  const [saveErr, setSaveErr] = useState(false)
  const visionNote = VISION_CALIBRATED.map(aiModelLabel).join('、')
  return (
    <>
      <h2>AI</h2>
      <div className="entry-list">
        <div className="entry-row entry-static" data-row="ai-credits">
          <span className="lb-wrap">
            <span className="lb">AI 額度</span>
            <span className="lb-sub" aria-live="polite">{creditsText(credits)}</span>
          </span>
        </div>
        <label className="entry-row" htmlFor="ai-model" data-row="ai-model">
          <span className="lb-wrap">
            <span className="lb">主模型</span>
            <span className="lb-sub">{saveErr ? '沒存到：這個瀏覽器不讓網站存資料' : aiModelLabel(model)}</span>
          </span>
          {CHEV}
          <select
            id="ai-model"
            className="entry-select"
            aria-label="主模型"
            value={model}
            onChange={(e) => {
              try {
                setAiModel(e.target.value)
                setModel(e.target.value)
                setSaveErr(false)
              } catch {
                setSaveErr(true)
              }
            }}
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="settings-note">
        食物類型的自動分類用主模型，回錯誤或被限流時換另一個；逾時不會換——Qwen 想得久，一批可能超過時限，留到下次開 App 再補。拍營養標示固定用 {visionNote}：讀數的準度只在它身上驗過，換模型要先重跑校準照片。
      </p>
    </>
  )
}
