/* 開始訓練 sheet（樣張 ②）：課表（最上面）、空白開始，以及「記一筆有氧」入口（有氧不屬於「一次訓練」，
   所以不開訓練、另開有氧 sheet）。封存的課表不進這張選單。
   走 vaul Drawer，與 LogSheet 同一套：`repositionInputs={false}`（vaul 自己的鍵盤補償會把 `--kb`
   蓋掉）、top 吃 `--vvtop`——這張 sheet 目前沒有輸入欄，但第 2 輪加課表搜尋時會有，先守同一份規則。 */
import { Drawer } from 'vaul'
import { useSheetFocus } from '@/components/useSheetFocus'
import { monthDay } from '@/lib/dates'
import type { RoutineCard } from '@/lib/training'

interface StartSheetProps {
  open: boolean
  /** 「週三 10/14」，告訴使用者這次會記在哪一天。 */
  dateLabel: string
  /** 選到過去的日子＝補記：不計時，完成時手填時長。 */
  backfill: boolean
  busy: boolean
  error: string | null
  /** 使用中的課表（已排除封存），依建立順序。 */
  routines: readonly RoutineCard[]
  onClose: () => void
  onBlank: () => void
  onRoutine: (routineId: string) => void
  onCardio: () => void
}

export default function StartSheet({
  open,
  dateLabel,
  backfill,
  busy,
  error,
  routines,
  onClose,
  onBlank,
  onRoutine,
  onCardio,
}: StartSheetProps) {
  const attach = useSheetFocus()
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
        <Drawer.Content ref={attach} tabIndex={-1} className="sheet" aria-label="開始訓練" data-screen="start-sheet">
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">開始訓練</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="tr-sheet-body">
            <div className="tr-card">
              {routines.map(({ routine, exerciseCount, lastUsed }) => (
                <button
                  key={routine.id}
                  className="tr-row"
                  type="button"
                  disabled={busy}
                  data-routine-id={routine.id}
                  onClick={() => onRoutine(routine.id)}
                >
                  <span className="grow">
                    <span className="nm">{String(routine.name)}</span>
                    <span className="sub">
                      {exerciseCount} 個動作{lastUsed ? ` · 上次 ${monthDay(lastUsed)}` : ''}
                    </span>
                  </span>
                  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))}
              <button className="tr-row" type="button" disabled={busy} onClick={onBlank} data-action="start-blank">
                <span className="grow">
                  <span className="nm">空白開始</span>
                  <span className="sub">
                    {backfill ? `補記 ${dateLabel}，不計時，完成時填時長` : '一個一個加動作'}
                  </span>
                </span>
                <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div className="tr-card tr-start-cardio">
              <button className="tr-row" type="button" disabled={busy} onClick={onCardio} data-action="start-cardio">
                <span className="grow">
                  <span className="nm">記一筆有氧</span>
                  <span className="sub">跑步機、拳擊…不用開始訓練</span>
                </span>
                <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            {error && (
              <p className="tr-form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
