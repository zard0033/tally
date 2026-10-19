/* 課表編輯整頁（樣張 ⑤）：名稱就地改、動作依序列出、加動作、點一列改預設組次、移除、複製、封存。
   整頁而非 sheet：長清單、有自己的導覽（容器原則，DESIGN v2.54）。進出時 Training 通知 App 收起底部列。
   每個修改當下就存，沒有儲存鈕；名稱用草稿（失焦或 Enter 才寫），不合法就放回原值並說明。
   寫入全走 onWrite；失敗留在頁面上說「這筆沒有存下來」。

   排序：只有左邊握把能拖（整列都能拖會跟捲動打架）。`@dnd-kit/react`：握把是 button，鍵盤聚焦後
   空白鍵／Enter 拿起、方向鍵移動、空白鍵放下、Esc 取消；觸控靠握把的 `touch-action: none`，
   列的其餘部分照常捲動。放下的當下先用本機的 `pending` 順序顯示、寫完才放掉，不然函式庫會先把列
   彈回原位、等寫入完成才跳到新位置，看起來像閃一下。 */
import { useRef, useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'
import ExerciseThumb from '@/components/ExerciseThumb'
import { sortableAccessibility } from '@/components/sortableA11y'
import {
  addRoutineExerciseOps,
  checkRoutineName,
  copyRoutineOps,
  formatRoutineTarget,
  removeRoutineExerciseOps,
  renameRoutineOps,
  reorderRoutineExercisesOps,
  setRoutineArchivedOps,
  type Row,
  type RoutineDetail,
  type RoutineExerciseDetail,
  type RowOp,
  type TrainingDb,
} from '@/lib/training'
import ExercisePicker from './ExercisePicker'
import RoutineTargetSheet from './RoutineTargetSheet'

interface RoutineEditorProps {
  detail: RoutineDetail
  db: TrainingDb
  onBack: () => void
  /** 複製後直接進那份複本。 */
  onOpen: (routineId: string) => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

const newId = () => crypto.randomUUID()
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface SortableRowProps {
  item: RoutineExerciseDetail
  index: number
  label: string
  onEdit: () => void
  onRemove: () => void
}

function SortableRow({ item, index, label, onEdit, onRemove }: SortableRowProps) {
  const { entry } = item
  const { ref, handleRef, isDragging } = useSortable({ id: entry.id, index, data: { name: label } })
  return (
    <li
      className={isDragging ? 'tr-row is-dragging' : 'tr-row'}
      ref={ref}
      data-routine-exercise-id={entry.id}
    >
      <button className="tr-grip" type="button" ref={handleRef} aria-label={`拖曳排序：${label}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
        </svg>
      </button>
      <ExerciseThumb exercise={item.exercise} zoom />
      <button className="tr-row-main" type="button" aria-label={`${label}，改預設組次`} onClick={onEdit}>
        <span className="nm">{label}</span>
        <span className="sub">{formatRoutineTarget(entry)}</span>
      </button>
      <button className="tr-ib tr-row-end" type="button" aria-label={`移除${label}`} onClick={onRemove}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </li>
  )
}

export default function RoutineEditor({ detail, db, onBack, onOpen, onWrite }: RoutineEditorProps) {
  const { routine, exercises } = detail
  const archived = routine.archived === true
  const [name, setName] = useState(String(routine.name))
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  // 目標與開關分開：關閉動畫期間標題不能跳掉
  const [targetRow, setTargetRow] = useState<Row | null>(null)
  const [targetOpen, setTargetOpen] = useState(false)
  // 同步的重入擋（busy state 要等下一次 render 才生效）：只給非冪等的寫入用，見 runOnce
  const inFlight = useRef(false)
  // 放下後到寫入完成之間的顯示順序（entry id）；null＝照資料的順序
  const [pending, setPending] = useState<string[] | null>(null)

  const run = async (ops: RowOp[]): Promise<boolean> => {
    if (ops.length === 0) return false
    setError(null)
    try {
      await onWrite(ops)
      return true
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
      return false
    }
  }

  /** 加動作、複製連按兩次會多一列／多一份複本，要同步擋；改名、封存、移除、排序重送是冪等的，不擋——
   *  擋了的話，剛失焦的名稱寫入還在路上時按 × 或複製，那一下會被默默吃掉。 */
  const runOnce = async (ops: RowOp[]): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    try {
      return await run(ops)
    } finally {
      inFlight.current = false
    }
  }

  const commitName = async () => {
    const check = checkRoutineName(name)
    if (!check.ok) {
      setNameError(check.error)
      setName(String(routine.name))
      return
    }
    setNameError(null)
    setName(check.name)
    await run(renameRoutineOps({ current: routine, name: check.name }))
  }

  const addExercise = async (exerciseId: string) => {
    if (await runOnce(addRoutineExerciseOps({ db, routineId: routine.id, exerciseId, newId }))) setPicker(false)
  }

  const copy = async () => {
    const ops = copyRoutineOps({ db, routineId: routine.id, newId })
    if (await runOnce(ops)) onOpen(ops[0].rowId)
  }

  const toggleArchive = async () => {
    if (await run(setRoutineArchivedOps({ id: routine.id, archived: !archived })) && !archived) onBack()
  }

  const pickable = db.exercises.filter((e) => e.archived !== true)

  const shown = pending
    ? pending.flatMap((id) => exercises.filter((e) => e.entry.id === id))
    : exercises

  const reorder = async (orderedIds: string[]) => {
    try {
      const ops = reorderRoutineExercisesOps({ entries: exercises.map((e) => e.entry), orderedIds })
      if (ops.length === 0) return
      setPending(orderedIds)
      await run(ops)
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="main" data-screen="routine-editor">
      <header className="tr-top">
        <button className="tr-ib" type="button" aria-label="返回" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h1>{String(routine.name)}</h1>
        <button className="tr-ib" type="button" aria-label="複製課表" onClick={() => void copy()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h8" />
          </svg>
        </button>
      </header>

      <div className="tr-scroll">
        <label className="tr-field tr-field-first">
          <span className="lb">課表名稱</span>
          <input
            className="is-text tr-name-input"
            type="text"
            value={name}
            aria-label="課表名稱"
            aria-invalid={nameError !== null}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          {nameError && <span className="hint is-error">{nameError}</span>}
        </label>

        {error && (
          <p className="tr-form-error" role="alert">
            {error}
          </p>
        )}

        <div className="tr-sec">動作（依序）</div>
        <DragDropProvider
          plugins={(defaults) => [...defaults, sortableAccessibility]}
          onDragEnd={(event) => {
            if (event.canceled) return
            void reorder(move(shown.map((e) => e.entry.id), event))
          }}
        >
          <ul className="tr-card tr-list" data-section="routine-exercises">
            {shown.map((item, index) => {
              const label = item.exercise ? String(item.exercise.name) : '（找不到這個動作）'
              return (
                <SortableRow
                  key={item.entry.id}
                  item={item}
                  index={index}
                  label={label}
                  onEdit={() => {
                    setTargetRow(item.entry)
                    setTargetOpen(true)
                  }}
                  onRemove={() => void run(removeRoutineExerciseOps(item.entry.id))}
                />
              )
            })}
            <li>
              <button className="tr-row accent" type="button" data-action="add-routine-exercise" onClick={() => setPicker(true)}>
                <svg className="lead" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span className="grow">
                  <span className="nm">加動作</span>
                </span>
              </button>
            </li>
          </ul>
        </DragDropProvider>

        <p className="tr-note">
          課表不存重量。開始訓練時，組數、次數、重量都取該動作<b>上次實際完成</b>的值；這裡的預設只在動作從沒做過時才用。
        </p>

        <div className="tr-card tr-entry">
          <button className="tr-row" type="button" data-action="toggle-routine-archive" onClick={() => void toggleArchive()}>
            <span className="grow">
              <span className="nm">{archived ? '取消封存這份課表' : '封存這份課表'}</span>
              <span className="sub">{archived ? '回到開始訓練的選單' : '不會刪除，歷史照舊看得到'}</span>
            </span>
          </button>
        </div>
      </div>

      <ExercisePicker open={picker} exercises={pickable} onClose={() => setPicker(false)} onPick={(id) => void addExercise(id)} />

      <RoutineTargetSheet
        open={targetOpen}
        entry={targetRow}
        exerciseName={String(db.exercises.find((e) => e.id === targetRow?.exercise_id)?.name ?? '預設組次')}
        onClose={() => setTargetOpen(false)}
        onWrite={onWrite}
      />
    </div>
  )
}
