/* 結束訓練的確認（訓練分頁改版 C1，使用者 2026-11-23：「完成訓練」鈕位置不動，只在中間加確認這一步）。
   原本按了直接出「訓練完成」的總結，看起來就是已經結束了，誤觸也就結束了；現在這一步只問要不要結束：
   還有沒勾的組時先講（沒勾的不算進紀錄），「繼續練」「結束」兩顆鈕，按「結束」才寫入，接著進整頁的完成畫面（FinishCelebration）。
   補記過去日子時多一欄「時長（分鐘）」，手填、可略過，不跑計時（AC 8a）。sheet 規則同 StartSheet。 */
import { useState } from 'react'
import SpringSheet from '@/components/SpringSheet'
import { MAX_WORKOUT_MINUTES, parseWorkoutMinutes } from '@/lib/training'

interface FinishSheetProps {
  open: boolean
  /** 還沒打勾的組數（有氧卡不算）。 */
  undoneSets: number
  backfill: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  /** minutes：補記時手填的分鐘，略過為 null；即時的一律 null。 */
  onFinish: (minutes: number | null) => void
}

export default function FinishSheet({ open, undoneSets, backfill, busy, error, onClose, onFinish }: FinishSheetProps) {
  const [raw, setRaw] = useState('')
  const parsed = backfill ? parseWorkoutMinutes(raw) : null
  const invalid = backfill && parsed === undefined

  return (
    <SpringSheet open={open} onClose={onClose} title="結束這次訓練？" screen="finish-sheet" fit>
      <div className="tr-sheet-body">
        {undoneSets > 0 && (
          <p className="tr-finish-note" data-testid="finish-undone">
            還有 {undoneSets} 組沒勾，沒勾的不算進紀錄
          </p>
        )}

        {backfill && (
          <label className="tr-field">
            <span className="lb">
              時長（分鐘）<em>可略過</em>
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={raw}
              aria-label="時長（分鐘）"
              aria-invalid={invalid}
              onChange={(e) => setRaw(e.target.value)}
            />
            {invalid && <span className="hint is-error">{`時長要在 0–${MAX_WORKOUT_MINUTES} 分鐘之間`}</span>}
          </label>
        )}

        {error && (
          <p className="tr-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="tr-finish-acts">
          <button className="tr-secondary" type="button" onClick={onClose}>
            繼續練
          </button>
          <button
            className="action-btn"
            type="button"
            disabled={busy || invalid}
            onClick={() => onFinish(backfill ? (parsed ?? null) : null)}
          >
            結束
          </button>
        </div>
      </div>
    </SpringSheet>
  )
}
