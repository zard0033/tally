/* 選動作 sheet：訓練中「加動作」用。搜尋＋依肌群排好的清單，點一列就加進這次訓練。
   動作庫的管理（改名、肌群、要點、封存）是另一個畫面（第 3 段）；這裡只負責「挑」。
   搜尋框字級 16px（iOS 聚焦 <16px 會 zoom，DESIGN「表單控件字級下限」）。 */
import { useMemo, useState } from 'react'
import { Drawer } from 'vaul'
import { useSheetFocus } from '@/components/useSheetFocus'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABEL, type MuscleGroup, type Row } from '@/lib/training'

interface ExercisePickerProps {
  open: boolean
  /** 已排除封存的動作。 */
  exercises: readonly Row[]
  onClose: () => void
  onPick: (exerciseId: string) => void
}

const groupOrder = (g: unknown): number => {
  const i = MUSCLE_GROUPS.indexOf(g as MuscleGroup)
  return i === -1 ? MUSCLE_GROUPS.length : i
}

export default function ExercisePicker({ open, exercises, onClose, onPick }: ExercisePickerProps) {
  const attach = useSheetFocus()
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...exercises]
      .filter((e) => needle === '' || String(e.name).toLowerCase().includes(needle))
      .sort(
        (a, b) =>
          groupOrder(a.muscle_group) - groupOrder(b.muscle_group) ||
          String(a.name).localeCompare(String(b.name), 'zh-Hant'),
      )
  }, [exercises, q])

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setQ('')
          onClose()
        }
      }}
      direction="bottom"
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="scrim" />
        <Drawer.Content ref={attach} tabIndex={-1} className="sheet" aria-label="加動作" data-screen="exercise-picker">
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">加動作</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="tr-sheet-body tr-sheet-scroll">
            <label className="tr-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6" />
                <path d="M20 20l-4.5-4.5" />
              </svg>
              <input
                type="search"
                value={q}
                placeholder="搜尋動作"
                aria-label="搜尋動作"
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            {list.length === 0 ? (
              <p className="muted">{exercises.length === 0 ? '動作庫是空的' : '沒有符合的動作'}</p>
            ) : (
              <div className="tr-card">
                {list.map((e) => (
                  <button
                    key={e.id}
                    className="tr-row"
                    type="button"
                    data-exercise-id={e.id}
                    onClick={() => onPick(e.id)}
                  >
                    <span className="grow">
                      <span className="nm">{String(e.name)}</span>
                      <span className="sub">{MUSCLE_GROUP_LABEL[e.muscle_group as MuscleGroup] ?? '其他'}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
