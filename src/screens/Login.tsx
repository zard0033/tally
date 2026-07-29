/* 登入頁。視覺照 legacy/app.css 的 .login 規則（DESIGN.md 未畫樣張，元件規則已能唯一推導）。
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
        <h1>Tally</h1>
        <p>記錄今天吃了什麼</p>
        <button className="cta" type="button" onClick={() => void handleSignIn()} disabled={busy}>
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
