/* 選動作 sheet：訓練中「加動作」「替換為…」與課表編輯的「加動作」用。搜尋＋肌群橫條＋依肌群排好的清單，點一列就選它。
   動作庫的管理（改名、肌群、要點、封存）是另一個畫面（ExerciseLibrary）；這裡負責「挑」，
   以及庫裡沒有時的「新增動作」：開同一張編輯動作 sheet，建好直接當作被挑的那個（走 onPick）。
   新增 sheet 要渲染在 SpringSheet 的子樹裡：Base UI 靠 React 樹判斷巢狀，Escape 才只關最內層。
   搜尋與橫條與動作庫頁共用 ExerciseFilterBar。 */
import { useEffect, useMemo, useState } from 'react'
import ExerciseFilterBar from '@/components/ExerciseFilterBar'
import ExerciseThumb from '@/components/ExerciseThumb'
import GymVisualCredit from '@/components/GymVisualCredit'
import SpringSheet from '@/components/SpringSheet'
import { muscleGroupLabel } from '@/lib/exerciseCatalog'
import { filterExercises, type ExerciseFilter, type Row, type RowOp } from '@/lib/training'
import ExerciseEditSheet from './ExerciseEditSheet'

interface ExercisePickerProps {
  open: boolean
  /** 已排除封存的動作。 */
  exercises: readonly Row[]
  /** 「加動作」或「替換為…」。 */
  title?: string
  /** **全部**動作（含封存、含這次被排除的）：「新增動作」檢查重名要用，傳 `exercises` 那份會漏掉。 */
  allExercises: readonly Row[]
  /** 「新增動作」建好時寫入。 */
  onWrite: (ops: RowOp[]) => Promise<void>
  onClose: () => void
  onPick: (exerciseId: string) => void
}

const NO_FILTER: ExerciseFilter = { q: '', group: 'all' }

export default function ExercisePicker({ open, exercises, title = '加動作', allExercises, onWrite, onClose, onPick }: ExercisePickerProps) {
  const [filter, setFilter] = useState<ExerciseFilter>(NO_FILTER)
  const [createOpen, setCreateOpen] = useState(false)
  const list = useMemo(() => filterExercises(exercises, filter), [exercises, filter])

  // 關閉的出口不只 sheet 自己的關閉（挑一個動作是父層直接關），所以看 open 本身
  useEffect(() => {
    if (!open) setFilter(NO_FILTER)
  }, [open])

  return (
    <SpringSheet open={open} onClose={onClose} title={title} screen="exercise-picker">
    <div className="tr-sheet-body tr-sheet-scroll">
      <ExerciseFilterBar value={filter} onChange={setFilter} />
      {list.length === 0 && <p className="muted">{exercises.length === 0 ? '動作庫是空的' : '沒有符合的動作'}</p>}
      <div className="tr-card">
        {list.map((e) => (
          // 縮圖是獨立的放大鈕，不能包在選取鈕裡：列拆成「縮圖｜主按鈕」並排
          <div key={e.id} className="tr-row has-zoom">
            <ExerciseThumb exercise={e} zoom />
            <button className="tr-row-main" type="button" data-exercise-id={e.id} onClick={() => onPick(e.id)}>
              <span className="nm">{String(e.name)}</span>
              <span className="sub">{muscleGroupLabel(e.muscle_group)}</span>
            </button>
          </div>
        ))}
        {/* 常駐清單末尾（同記一筆 sheet 的「新增食物」）：搜尋沒有結果時也在，那正是最需要它的時候 */}
        <button className="tr-row accent" type="button" data-action="create-exercise" onClick={() => setCreateOpen(true)}>
          <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="grow">
            <span className="nm">新增動作</span>
          </span>
        </button>
      </div>
      <GymVisualCredit exercises={list} />
    </div>
    <ExerciseEditSheet
      open={createOpen}
      exercise={null}
      exercises={allExercises}
      onClose={() => setCreateOpen(false)}
      onWrite={async (ops) => {
        await onWrite(ops)
        // 建好就是被挑的那個。寫入失敗會在上一行丟出，留在新增 sheet 裡說明，不會走到這裡
        const created = ops.find((o) => o.op === 'insert' && o.table === 'exercises')
        if (created) onPick(created.rowId)
      }}
    />
    </SpringSheet>
  )
}
