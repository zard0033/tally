/** 開機畫面的三種樣子。unreachable＝getSession 明確回報後端連不上（不是沒登入）。 */
export type BootStatus = 'loading' | 'slow' | 'unreachable'

export default function BootScreen({ bootStatus }: { bootStatus: BootStatus }) {
  return (
    <div className="screen">
      <div className="notice" role="status">
        {bootStatus === 'unreachable' ? (
          <>
            <p className="headline">連不上後端</p>
            <p>可能是網路不通，或 Supabase 專案被閒置暫停。到 dashboard 按 Resume。</p>
          </>
        ) : (
          <p className="muted">{bootStatus === 'slow' ? '連線比平常慢，還在等後端回應…' : '載入中…'}</p>
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
    </div>
  )
}
