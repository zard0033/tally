/* 動作庫整頁（樣張 ⑦a）：搜尋＋肌群橫條＋平面列表，點一列開「編輯動作」sheet，右上＋新增。
   封存的動作不進選單、歷史仍顯示名稱（AC 2），所以列在清單底下的「已封存」區。
   封存／取消封存是每一列尾端的圖示鈕（v2.93，原本在編輯 sheet 欄位區底下，真機回饋位置怪）：
   點了立刻寫，沒有「5 秒復原」提示條——取消封存隨時在已封存區按得到、不丟資料，復原條只會多一層要等它消失的東西。
   整頁接管畫面（同訓練中），進出時 Training 通知 App 收起底部列。 */
import { useMemo, useState } from 'react'
import ExerciseFilterBar from '@/components/ExerciseFilterBar'
import ExerciseThumb from '@/components/ExerciseThumb'
import GymVisualCredit from '@/components/GymVisualCredit'
import {
  MUSCLE_GROUP_LABEL,
  filterExercises,
  setExerciseArchivedOps,
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

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// 圖示同食品庫的封存／復原（FoodLibrary.tsx 的 ARCHIVE_ICON／RESTORE_ICON），同一個動作用同一個圖
const ARCHIVE_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="4" rx="1" /><path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>
const RESTORE_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>

function ExerciseRow({ exercise, onOpen, onToggleArchive }: { exercise: Row; onOpen: () => void; onToggleArchive: () => void }) {
  const group = MUSCLE_GROUP_LABEL[exercise.muscle_group as MuscleGroup] ?? '其他'
  const hasTips = typeof exercise.tips === 'string' && exercise.tips.trim() !== ''
  const name = String(exercise.name)
  const archived = exercise.archived === true
  return (
    // 縮圖與封存都是獨立的鈕，不能包在開編輯的按鈕裡：列拆成「縮圖｜主按鈕｜封存」並排。
    // 列尾不再放 › ：那個位置給了封存鈕，兩個圖示並排分不出哪個是開編輯（同食品庫的列，沒有箭頭）
    <div className="tr-row has-zoom">
      <ExerciseThumb exercise={exercise} zoom />
      <button className="tr-row-main" type="button" data-exercise-id={exercise.id} onClick={onOpen}>
        <span className="nm">{name}</span>
        <span className="sub">{hasTips ? `${group} · 有要點` : group}</span>
      </button>
      <button
        className="tr-ib tr-row-end"
        type="button"
        aria-label={archived ? `取消封存 ${name}` : `封存 ${name}`}
        onClick={onToggleArchive}
      >
        {archived ? RESTORE_ICON : ARCHIVE_ICON}
      </button>
    </div>
  )
}

export default function ExerciseLibrary({ exercises, onBack, onWrite }: ExerciseLibraryProps) {
  const [filter, setFilter] = useState<ExerciseFilter>({ q: '', group: 'all' })
  // 目標與開關分開：關閉動畫期間表單不能跳成「新增」的空白樣子
  const [target, setTarget] = useState<Row | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  /* 封存是冪等的 UPDATE，連按不擋（同課表的封存）。onWrite 只在排進本機佇列那步會失敗（容量滿、私密模式）；
     離線不算失敗，排進佇列、列表照本機資料立刻換區。失敗時這一頁自己講：訓練頁的同步細條在整頁接管時看不到。 */
  const toggleArchive = async (row: Row) => {
    setError(null)
    try {
      await onWrite(setExerciseArchivedOps({ id: row.id, archived: row.archived !== true }))
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
    }
  }

  const rowOf = (e: Row) => (
    <ExerciseRow key={e.id} exercise={e} onOpen={() => open(e)} onToggleArchive={() => void toggleArchive(e)} />
  )

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

      {/* 放在捲動區外（同訓練中）：清單捲到哪都看得到 */}
      {error && (
        <div className="tr-status is-error" role="alert">
          <span className="grow">{error}</span>
        </div>
      )}

      <div className="tr-scroll">
        <ExerciseFilterBar value={filter} onChange={setFilter} />

        {shown.length === 0 ? (
          <p className="muted">{exercises.length === 0 ? '動作庫是空的，按右上的＋新增' : '沒有符合的動作'}</p>
        ) : (
          <>
            {active.length > 0 && <div className="tr-card">{active.map(rowOf)}</div>}
            {archived.length > 0 && (
              <>
                <div className="tr-sec">已封存</div>
                <div className="tr-card" data-section="archived">
                  {archived.map(rowOf)}
                </div>
              </>
            )}
          </>
        )}
        <GymVisualCredit exercises={shown} />
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
