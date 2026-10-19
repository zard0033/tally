/* 選動作 sheet：訓練中「加動作」用。搜尋＋肌群橫條＋依肌群排好的清單，點一列就加進這次訓練。
   動作庫的管理（改名、肌群、要點、封存）是另一個畫面（ExerciseLibrary）；這裡只負責「挑」。
   搜尋與橫條與動作庫頁共用 ExerciseFilterBar。 */
import { useEffect, useMemo, useState } from 'react'
import ExerciseFilterBar from '@/components/ExerciseFilterBar'
import ExerciseThumb from '@/components/ExerciseThumb'
import SpringSheet from '@/components/SpringSheet'
import { MUSCLE_GROUP_LABEL, filterExercises, type ExerciseFilter, type MuscleGroup, type Row } from '@/lib/training'

interface ExercisePickerProps {
  open: boolean
  /** 已排除封存的動作。 */
  exercises: readonly Row[]
  onClose: () => void
  onPick: (exerciseId: string) => void
}

const NO_FILTER: ExerciseFilter = { q: '', group: 'all' }

export default function ExercisePicker({ open, exercises, onClose, onPick }: ExercisePickerProps) {
  const [filter, setFilter] = useState<ExerciseFilter>(NO_FILTER)
  const list = useMemo(() => filterExercises(exercises, filter), [exercises, filter])

  // 關閉的出口不只 sheet 自己的關閉（挑一個動作是父層直接關），所以看 open 本身
  useEffect(() => {
    if (!open) setFilter(NO_FILTER)
  }, [open])

  return (
    <SpringSheet open={open} onClose={onClose} label="加動作" title="加動作" screen="exercise-picker">
    <div className="tr-sheet-body tr-sheet-scroll">
      <ExerciseFilterBar value={filter} onChange={setFilter} />
      {list.length === 0 ? (
        <p className="muted">{exercises.length === 0 ? '動作庫是空的' : '沒有符合的動作'}</p>
      ) : (
        <div className="tr-card">
          {list.map((e) => (
            // 縮圖是獨立的放大鈕，不能包在選取鈕裡：列拆成「縮圖｜主按鈕」並排
            <div key={e.id} className="tr-row has-zoom">
              <ExerciseThumb exercise={e} zoom />
              <button className="tr-row-main" type="button" data-exercise-id={e.id} onClick={() => onPick(e.id)}>
                <span className="nm">{String(e.name)}</span>
                <span className="sub">{MUSCLE_GROUP_LABEL[e.muscle_group as MuscleGroup] ?? '其他'}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
    </SpringSheet>
  )
}
