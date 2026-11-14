/* 開機畫面（v2.135）：跟登入頁同一幅畫（components/Gate.tsx）。載入中不寫字，四塊石頭輪流亮；
   慢與連不上時整幅往上挪，地面出現說明與「重新載入」。 */
import Gate from '@/components/Gate'

/** 開機畫面的三種樣子。unreachable＝getSession 明確回報後端連不上（不是沒登入）。 */
export type BootStatus = 'loading' | 'slow' | 'unreachable'

export default function BootScreen({ bootStatus }: { bootStatus: BootStatus }) {
  return (
    <div className="screen">
      <div className="edge-top" aria-hidden="true" />
      <Gate motion={bootStatus === 'unreachable' ? 'still' : 'loading'} shifted={bootStatus !== 'loading'}>
        {/* 同一個 role=status 從載入中掛到連不上，只換內容：iOS VoiceOver 對「插進來時就已經有字」的
            live region 常常不播，換掉整塊的話盲人使用者可能聽不到「連線比平常慢」、找不到「重新載入」 */}
        <div className="gate-foot" role="status">
          {bootStatus === 'loading' ? (
            <p className="sr-only gate-status">載入中…</p>
          ) : (
            <div className="gate-msg">
              {bootStatus === 'unreachable' ? (
                <>
                  <p className="headline">連不上後端</p>
                  <p className="gate-status">可能是網路不通，或 Supabase 專案被閒置暫停。到 dashboard 按 Resume。</p>
                </>
              ) : (
                <p className="gate-status">連線比平常慢，還在等後端回應…</p>
              )}
            </div>
          )}
          {/* 「慢」也要有出口：連上了但永不回應時 fetch 不會 reject，getSession 不會 settle，
              bootStatus 永遠到不了 unreachable（review H1）。standalone 的 PWA 沒有網址列也沒有
              下拉重整，沒有這顆鈕就只能強制關閉 App。
              重新載入而不是再叫一次 getSession：supabase-js 對同一顆 refresh token 的失敗有
              60 秒冷卻，再叫只會立刻拿到同一個失敗；reload 才清得掉記憶體裡的冷卻。 */}
          {bootStatus !== 'loading' && (
            <button className="action-btn" type="button" onClick={() => location.reload()}>
              重新載入
            </button>
          )}
        </div>
      </Gate>
    </div>
  )
}
