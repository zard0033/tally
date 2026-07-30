/* 登入頁。v2.0 極簡化（Meta splash 式，DESIGN.md P2）：48px 幾何 T mark＋問句置中，
   CTA 沉到底部拇指區。Wordmark（「Tally」字樣）全產品不出現，只活在 index.html 的 title。
   OAuth 走 supabase-js 的 signInWithOAuth（PKCE，detectSessionInUrl 自動處理回跳），
   legacy 手刻的 hash 解析／implicit flow 整段作廢，不在這裡搬。 */
import { useState } from 'react'
import { signInWithGoogle } from '@/lib/api'

interface LoginProps {
  /** 上一次登入失敗或 session 過期時的訊息；沒有就不顯示。App 傳入，登入頁自己不記狀態。 */
  error?: string | null
}

export default function Login({ error }: LoginProps) {
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSignIn = async () => {
    setBusy(true)
    setLocalError(null)
    try {
      // redirectTo 在 UI 層組字串——lib 內禁止碰 window／document
      await signInWithGoogle(location.origin + import.meta.env.BASE_URL)
    } catch (e) {
      setBusy(false)
      setLocalError(e instanceof Error ? e.message : String(e))
    }
  }

  const message = localError ?? error ?? null

  return (
    <div className="screen" id="view-login">
      <main className="login">
        <div className="mid">
          <svg className="mark" width="48" height="36" viewBox="0 0 700 520" aria-hidden="true">
            <rect x="0" y="0" width="700" height="180" rx="60" />
            <rect x="290" y="0" width="220" height="520" rx="60" />
          </svg>
          <h1 className="hero-q">今天吃了什麼？</h1>
        </div>
        <button className="action-btn" type="button" onClick={() => void handleSignIn()} disabled={busy}>
          用 Google 登入
        </button>
        {message && (
          <p className="err" role="alert">
            {message}
          </p>
        )}
      </main>
    </div>
  )
}
