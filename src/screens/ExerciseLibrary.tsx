/* 動作庫整頁（樣張 ⑦a）：搜尋＋肌群橫條＋平面列表，點一列開「編輯動作」sheet，右上＋新增。
   封存的動作不進選單、歷史仍顯示名稱（AC 2），所以列在清單底下的「已封存」區，可取消封存。
   整頁接管畫面（同訓練中），進出時 Training 通知 App 收起底部列。 */
import { useMemo, useState } from 'react'
import ExerciseFilterBar from '@/components/ExerciseFilterBar'
import ExerciseThumb from '@/components/ExerciseThumb'
import {
  MUSCLE_GROUP_LABEL,
  filterExercises,
  type ExerciseFilter,
  type MuscleGroup,
  type Row,
  type RowOp,
} from '@/lib/training'
import ExerciseEditSheet from './ExerciseEditSheet'

interface ExerciseLibraryProps {
  exercises: readonly Row[]
  onBack: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

function ExerciseRow({ exercise, onOpen }: { exercise: Row; onOpen: () => void }) {
  const group = MUSCLE_GROUP_LABEL[exercise.muscle_group as MuscleGroup] ?? '其他'
  const hasTips = typeof exercise.tips === 'string' && exercise.tips.trim() !== ''
  return (
    <button className="tr-row" type="button" data-exercise-id={exercise.id} onClick={onOpen}>
      <ExerciseThumb exercise={exercise} />
      <span className="grow">
        <span className="nm">{String(exercise.name)}</span>
        <span className="sub">{hasTips ? `${group} · 有要點` : group}</span>
      </span>
      <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  )
}

export default function ExerciseLibrary({ exercises, onBack, onWrite }: ExerciseLibraryProps) {
  const [filter, setFilter] = useState<ExerciseFilter>({ q: '', group: 'all' })
  // 目標與開關分開：關閉動畫期間表單不能跳成「新增」的空白樣子
  const [target, setTarget] = useState<Row | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const shown = useMemo(() => filterExercises(exercises, filter), [exercises, filter])
  const active = shown.filter((e) => e.archived !== true)
  const archived = shown.filter((e) => e.archived === true)

  // 新增成功後清掉搜尋與肌群條件：新動作的肌群若不在目前條件裡，會像「沒存到」而讓人再按一次
  const write = async (ops: RowOp[]) => {
    await onWrite(ops)
    if (ops.some((o) => o.op === 'insert')) setFilter({ q: '', group: 'all' })
  }

  const open = (row: Row | null) => {
    setTarget(row)
    setSheetOpen(true)
  }

  return (
    <div className="main" data-screen="exercise-library">
      <header className="tr-top">
        <button className="tr-ib" type="button" aria-label="返回" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h1>動作庫</h1>
        <button className="tr-ib" type="button" aria-label="新增動作" onClick={() => open(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </header>

      <div className="tr-scroll">
        <ExerciseFilterBar value={filter} onChange={setFilter} />

        {shown.length === 0 ? (
          <p className="muted">{exercises.length === 0 ? '動作庫是空的，按右上的＋新增' : '沒有符合的動作'}</p>
        ) : (
          <>
            {active.length > 0 && (
              <div className="tr-card">
                {active.map((e) => (
                  <ExerciseRow key={e.id} exercise={e} onOpen={() => open(e)} />
                ))}
              </div>
            )}
            {archived.length > 0 && (
              <>
                <div className="tr-sec">已封存</div>
                <div className="tr-card" data-section="archived">
                  {archived.map((e) => (
                    <ExerciseRow key={e.id} exercise={e} onOpen={() => open(e)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <ExerciseEditSheet
        open={sheetOpen}
        exercise={target}
        exercises={exercises}
        onClose={() => setSheetOpen(false)}
        onWrite={write}
      />
    </div>
  )
}
