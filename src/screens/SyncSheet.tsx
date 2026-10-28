/* 未同步 sheet：點同步狀態細條開，講清楚「卡在哪一種原因」與能做什麼。
   純說明＋兩個動作（立即重試、放棄被拒絕的那一條），沒有輸入欄位，所以不需要 repositionInputs 的特殊處理，
   容器照現有 sheet（短、單一目的、做完回原頁）。
   **文案不叫人丟掉**：rejected 也包含「先送的父列失敗，子列撞外鍵」這種下一輪就自己好的情況（queue.ts 的 FailureKind），
   所以只說「伺服器拒絕、下次同步會再試」，放棄鈕是次要樣式，且先在 sheet 內確認、講清連帶消失幾筆。
   **也不承諾計時重試**：重試只發生在回到前景、回線、寫入、TOKEN_REFRESHED 或按「立即重試」，文案照實說這幾個時機。
   auth 只給文字不放登入鈕：被動登出保留佇列、主動登出會清佇列，兩條路徑易接錯。 */
import { useEffect, useRef, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import SpringSheet from '@/components/SpringSheet'
import type { QueueEntry } from '@/lib/queue'
import { describeEntry } from '@/lib/training'
import type { TrainingView } from '@/lib/trainingRuntime'

interface SyncSheetProps {
  open: boolean
  onClose: () => void
  summary: TrainingView['summary']
  entries: TrainingView['entries']
  onDiscard: (seq: number) => Promise<void>
  discardImpact: (seq: number) => Promise<number>
  onRetry: () => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const RETRY_WHEN = '下次同步（回到前景、回線或寫入時）會再試，也可以按「立即重試」。'

interface AskDiscard {
  seq: number
  /** 連帶消失的列數（不含被點的那一列）。 */
  impact: number
}

interface BodyProps extends Omit<SyncSheetProps, 'open' | 'onClose'> {
  /** 處理中：sheet 據此鎖住關閉，免得放棄到一半被關掉看不到失敗說明。 */
  onBusy: (busy: boolean) => void
}

function SyncBody({ summary, entries, onDiscard, discardImpact, onRetry, onBusy }: BodyProps) {
  const [busy, setBusyState] = useState(false)
  // 立即重試只鎖重試鈕：它不是會讓人看不到結果的流程，不該擋住關閉（busy 才擋）
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<AskDiscard | null>(null)

  const setBusy = (b: boolean) => {
    setBusyState(b)
    onBusy(b)
  }

  const { mine, foreign, pending, waiting, failed } = summary
  const rejected = entries.filter((e) => e.failure === 'rejected')
  // 同標籤的被拒絕條目（例如兩個「記一組」）加「第 N 個」，放棄鈕與確認框才分得出是哪一個
  const baseOf = rejected.map((e) => describeEntry(e))
  const labelOf = new Map<number, string>()
  const nth = new Map<string, number>()
  rejected.forEach((e, i) => {
    const base = baseOf[i]
    const n = (nth.get(base) ?? 0) + 1
    nth.set(base, n)
    labelOf.set(e.seq, baseOf.filter((b) => b === base).length > 1 ? `${base}（第 ${n} 個）` : base)
  })
  // 對話框的目標用 seq 去現況裡找：條目在背景被同步掉、或已被放棄，對話框跟著收起，不會對著不存在的條目問
  const target: QueueEntry | undefined = ask ? entries.find((e) => e.seq === ask.seq) : undefined

  const retry = async () => {
    setRetrying(true)
    setError(null)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  const askDiscard = async (seq: number) => {
    setBusy(true)
    setError(null)
    try {
      setAsk({ seq, impact: await discardImpact(seq) })
    } catch (e) {
      setError(`沒辦法放棄這筆：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const confirmDiscard = async () => {
    if (!ask) return
    const { seq } = ask
    setAsk(null)
    setBusy(true)
    setError(null)
    try {
      await onDiscard(seq)
    } catch (e) {
      setError(`沒辦法放棄這筆：${errText(e)}`)
    } finally {
      // 成功＝那一條已經從清單消失，放回 busy 不會讓人再送第二次
      setBusy(false)
    }
  }

  return (
    <div className="tr-sheet-body tr-sheet-scroll sync-body">
      {mine === 0 && foreign === 0 && <p className="sync-line">全部都已同步。</p>}
      {/* 登入失效時所有「沒失敗」的都是被它擋著：不說「會自動送出」，語意併進下面那句「重新登入後會繼續上傳」 */}
      {pending > 0 && failed.auth === 0 && (
        <p className="sync-line">{pending} 筆等著上傳。下次同步（回到前景、回線或寫入時）會送出，也可以按「立即重試」。</p>
      )}
      {failed.offline > 0 && <p className="sync-line">{failed.offline} 筆因為離線還沒上傳，回到網路後會自動上傳。</p>}
      {failed.auth > 0 && (
        <p className="sync-line">{failed.auth} 筆因為登入已失效而停著。重新登入後會繼續上傳，資料都還在。</p>
      )}
      {failed.transient > 0 && <p className="sync-line">{failed.transient} 筆暫時送不出去。{RETRY_WHEN}</p>}
      {waiting > 0 && <p className="sync-line">{waiting} 筆在等前面那筆送出去。</p>}
      {rejected.length > 0 && (
        <>
          <p className="sync-line">
            {rejected.length} 筆被伺服器拒絕。{RETRY_WHEN}有些會自己好；確定不要了才放棄。
          </p>
          <div className="tr-card" data-section="sync-rejected">
            {rejected.map((e) => {
              const label = labelOf.get(e.seq) ?? describeEntry(e)
              return (
                <div key={e.seq} className="tr-row tr-row-compact" data-seq={e.seq}>
                  <span className="grow">
                    <span className="nm">{label}</span>
                  </span>
                  <button
                    className="tr-text-btn is-quiet"
                    type="button"
                    aria-label={`放棄這筆：${label}`}
                    disabled={busy || retrying}
                    onClick={() => void askDiscard(e.seq)}
                  >
                    放棄這筆
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
      {foreign > 0 && <p className="sync-line">另有 {foreign} 筆屬於別的帳號，登入該帳號才會上傳。</p>}

      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      {mine > 0 && (
        <button className="action-btn" type="button" disabled={busy || retrying} onClick={() => void retry()}>
          {retrying ? '重試中…' : '立即重試'}
        </button>
      )}

      <ConfirmDialog
        open={target !== undefined}
        title="放棄這筆變更？"
        cancelLabel="先不要"
        confirmLabel="放棄"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => void confirmDiscard()}
      >
        <p>「{target ? (labelOf.get(target.seq) ?? describeEntry(target)) : ''}」不會再上傳，放棄後找不回來。</p>
        {ask && ask.impact > 0 && <p>另有 {ask.impact} 筆會一起消失。</p>}
      </ConfirmDialog>
    </div>
  )
}

export default function SyncSheet({ open, onClose, ...rest }: SyncSheetProps) {
  const [busy, setBusy] = useState(false)

  /* 開著的時候佇列清空（離線回線、同步完成）就自己收起來（v2.104，使用者真機：同步完只剩「全部都已同步」，
     還要自己按 ✕ 才回得去主畫面）。只在「有東西 → 沒東西」那一下收：sheet 開著且一開始就是空的不收（不會有這種入口，
     細條沒東西時不顯示；但就算有，也不該一開就關掉）。收的動作本身就是回饋，不另外留一個「已同步」畫面。 */
  const left = rest.summary.mine + rest.summary.foreign
  const hadLeft = useRef(false)
  useEffect(() => {
    if (!open) {
      hadLeft.current = false
      return
    }
    if (left > 0) hadLeft.current = true
    else if (hadLeft.current) {
      hadLeft.current = false
      onClose()
    }
  }, [open, left, onClose])

  return (
    <SpringSheet open={open} onClose={onClose} label="未同步" title="未同步" screen="sync-sheet" fit locked={busy}>
      <SyncBody {...rest} onBusy={setBusy} />
    </SpringSheet>
  )
}
