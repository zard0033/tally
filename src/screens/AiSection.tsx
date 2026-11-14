/* 設定頁的「AI」段（v2.128，使用者 2026-11-11 裁決：做 AI 設定頁、全站 AI 統一成一份設定）。
   兩列唯讀：AI 額度（read-label 代查 OpenRouter，key 不離開伺服器）與模型。
   v2.130 拿掉選主模型（使用者 2026-11-12：不讓 Qwen 當主模型——分類一批會超過函式時限；只剩一個選項，選單沒有意義）。
   不做 BYOK 輸入 key：單人 app，key 進資料庫或瀏覽器都只是多一個外洩面。 */
import { AI_MODELS, formatUsd } from '@/lib/aiModels'
import type { AiCredits } from '@/lib/api'
import { SkelInline } from '@/components/Skeleton'

export type CreditsState = { status: 'loading' } | { status: 'ok'; data: AiCredits } | { status: 'err' }

function creditsText(c: Exclude<CreditsState, { status: 'loading' }>): string {
  if (c.status === 'err') return '讀不到額度'
  const { total_credits, total_usage, usage_monthly } = c.data
  // 兩個浮點數相減可能是 -0.0001，印成 $-0.00；夾到 0
  const left = total_credits !== null && total_usage !== null ? Math.max(0, total_credits - total_usage) : null
  return `剩 ${formatUsd(left)}・本月用了 ${formatUsd(usage_monthly)}`
}

export default function AiSection({ credits }: { credits: CreditsState }) {
  const [main, backup] = AI_MODELS
  return (
    <>
      <h2>AI</h2>
      <div className="entry-list">
        <div className="entry-row entry-static" data-row="ai-credits">
          <span className="lb-wrap">
            <span className="lb">AI 額度</span>
            <span className="lb-sub" aria-live="polite">
              {credits.status === 'loading' ? <SkelInline w="10em" /> : creditsText(credits)}
            </span>
          </span>
        </div>
        <div className="entry-row entry-static" data-row="ai-model">
          <span className="lb-wrap">
            <span className="lb">模型</span>
            <span className="lb-sub">
              {main.label}・備援 {backup.label}
            </span>
          </span>
        </div>
      </div>
      <p className="settings-note">拍營養標示與食物類型的自動分類都用這組模型，主模型回錯誤或被限流時換備援。</p>
    </>
  )
}
