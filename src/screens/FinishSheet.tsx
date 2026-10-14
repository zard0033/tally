/* 完成訓練 sheet（樣張 ⑥）：一次訓練的收尾。只列事實，不寫「比上次進步」（那是階段 4 的分析）。
   補記過去日子時多一欄「時長（分鐘）」，手填、可略過，不跑計時（AC 8a）。
   「存成課表」第 2 輪加進來。輸入欄字級 16px；sheet 規則同 StartSheet。 */
import { useState } from 'react'
import { Drawer } from 'vaul'
import { useSheetFocus } from '@/components/useSheetFocus'

export interface FinishLine {
  name: string
  /** 「60 × 12 · 60 × 12」，只含已打勾的組。 */
  text: string
}

interface FinishSheetProps {
  open: boolean
  volume: number
  /** 即時的訓練才有；補記的沒有（完成時才手填）。 */
  minutes: number | null
  doneSets: number
  totalSets: number
  lines: readonly FinishLine[]
  backfill: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  /** minutes：補記時手填的分鐘，略過為 null；即時的一律 null。 */
  onFinish: (minutes: number | null) => void
}

/** 空白＝略過；否則 0–1440 的數字。回 undefined 表示不合法。 */
function parseMinutes(raw: string): number | null | undefined {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 1440) return undefined
  return n
}

export default function FinishSheet({
  open,
  volume,
  minutes,
  doneSets,
  totalSets,
  lines,
  backfill,
  busy,
  error,
  onClose,
  onFinish,
}: FinishSheetProps) {
  const attach = useSheetFocus()
  const [raw, setRaw] = useState('')
  const parsed = backfill ? parseMinutes(raw) : null
  const invalid = backfill && parsed === undefined
  const facts = [
    '總訓練量',
    ...(minutes !== null ? [`${minutes} 分`] : []),
    `${doneSets} / ${totalSets} 組`,
  ].join(' · ')

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
      direction="bottom"
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="scrim" />
        <Drawer.Content ref={attach} tabIndex={-1} className="sheet" aria-label="訓練完成" data-screen="finish-sheet">
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">訓練完成</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="tr-sheet-body tr-sheet-scroll">
            <div className="tr-summary">
              <span className="big" data-testid="finish-volume">
                {volume.toLocaleString('en-US')}
                <span className="u">kg</span>
              </span>
              <span className="l">{facts}</span>
            </div>

            {lines.length > 0 && (
              <div className="tr-card">
                {lines.map((l, i) => (
                  <div className="tr-row tr-row-compact" key={`${l.name}-${i}`}>
                    <span className="grow">
                      <span className="nm">{l.name}</span>
                      <span className="sub">{l.text || '沒有打勾的組'}</span>
                    </span>
                  </div>
                ))}
              </div>
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
                {invalid && <span className="hint is-error">時長要在 0–1440 分鐘之間</span>}
              </label>
            )}

            {error && (
              <p className="tr-form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="action-btn"
              type="button"
              disabled={busy || invalid}
              onClick={() => onFinish(backfill ? (parsed ?? null) : null)}
            >
              完成
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
