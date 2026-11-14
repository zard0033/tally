/* 登入頁（v2.135，樣張 `_design-sample/login-directions.html` 甲「日出上山」）：整頁一幅畫＋開場動畫，不放字。
   「用 Google 登入」坐在紙色地面上、當小徑的起點；畫與動畫在 components/Gate.tsx。
   Wordmark（「Tally」字樣）全產品不出現，只活在 index.html 的 title。
   OAuth 走 supabase-js 的 signInWithOAuth（PKCE，detectSessionInUrl 自動處理回跳）。 */
import { useState } from 'react'
import Gate from '@/components/Gate'
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
      {/* Safari 26 從這條取狀態列的顏色；登入頁在 #view-app 外面，要自己帶一條（Gate 把它染成天空色） */}
      <div className="edge-top" aria-hidden="true" />
      <Gate motion="intro" shifted={!!message}>
        <main className="gate-foot">
          <h1 className="sr-only">Tally</h1>
          <button className="action-btn" type="button" onClick={() => void handleSignIn()} disabled={busy}>
            用 Google 登入
          </button>
          {message && (
            <p className="err" role="alert">
              {message}
            </p>
          )}
        </main>
      </Gate>
    </div>
  )
}
