/* 動作庫整頁（樣張 ⑦a）：搜尋＋肌群橫條＋列表，點一列開「編輯動作」sheet，右上＋新增。
   v2.147（子頁換皮 B）：「全部」且沒搜尋時依肌群分段，段頭一顆肌群單字小圓（同自建動作的縮圖）＋動作數；有篩選或搜尋時是平面列表。
   封存的動作不進選單、歷史仍顯示名稱（AC 2），所以列在清單底下的「已封存」區。
   封存／取消封存在編輯 sheet 底部、跟儲存並排（v2.147，使用者 2026-11-20 核可收掉列尾圖示鈕；v2.93 從 sheet 欄位區底下搬到列尾
   是因為「欄位區底下位置怪」，這次放在釘底的操作列，不回欄位區）。
   **封存先跳確認框**（v2.103，取代 v2.93「不問確認」：真機上點下去那列直接消失到清單最底下，使用者找不到）；取消封存是還原、不問。
   沒有「5 秒復原」提示條——取消封存隨時在已封存區按得到、不丟資料，復原條只會多一層要等它消失的東西。
   整頁接管畫面（同訓練中），放在設定頁的「動作庫管理」（v2.96 從訓練頁搬來）：進出時 Settings 通知 App 收起底部列。 */
import { useMemo, useState } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import ExerciseFilterBar from '@/components/ExerciseFilterBar'
import ExerciseThumb from '@/components/ExerciseThumb'
import GymVisualCredit from '@/components/GymVisualCredit'
import SubPageTop from '@/components/SubPageTop'
import { glyphOf, muscleGroupLabel } from '@/lib/exerciseCatalog'
import {
  MUSCLE_GROUPS,
  filterExercises,
  setExerciseArchivedOps,
  type ExerciseFilter,
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

/** 「全部」且沒搜尋時依肌群分段（v2.147）；有條件時平面列表，副標寫肌群 */
const isGrouped = (f: ExerciseFilter) => f.group === 'all' && f.q.trim() === ''

function ExerciseRow({ exercise, grouped, onOpen }: { exercise: Row; grouped: boolean; onOpen: () => void }) {
  const group = muscleGroupLabel(exercise.muscle_group)
  const hasTips = typeof exercise.tips === 'string' && exercise.tips.trim() !== ''
  const name = String(exercise.name)
  // 分段時段頭已經寫了肌群，副標只剩「有要點」
  const sub = grouped ? (hasTips ? '有要點' : null) : hasTips ? `${group} · 有要點` : group
  return (
    // 縮圖是獨立的鈕（放大檢視），不能包在開編輯的按鈕裡：列拆成「縮圖｜主按鈕」並排，› 只是裝飾
    <div className="tr-row has-zoom">
      <ExerciseThumb exercise={exercise} zoom />
      <button className="tr-row-main" type="button" data-exercise-id={exercise.id} onClick={onOpen}>
        <span className="nm">{name}</span>
        {sub && <span className="sub">{sub}</span>}
      </button>
      <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
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

  // 封存要先問（v2.103，使用者真機：點下去那一列直接消失到清單最底下，找不到）；取消封存是還原，不問
  const [archiveAsk, setArchiveAsk] = useState<Row | null>(null)
  const askName = archiveAsk ? String(archiveAsk.name) : ''

  const grouped = isGrouped(filter)
  const rowOf = (e: Row) => <ExerciseRow key={e.id} exercise={e} grouped={grouped} onOpen={() => open(e)} />
  const sections = grouped
    ? MUSCLE_GROUPS.map((g) => ({ g, rows: active.filter((e) => (MUSCLE_GROUPS as readonly string[]).includes(String(e.muscle_group)) ? e.muscle_group === g : g === 'other') }))
        .filter((s) => s.rows.length > 0)
    : []

  /* sheet 底部的封存鈕（v2.147）：先收 sheet，封存照舊跳確認框；取消封存是還原、直接寫 */
  const archiveFromSheet = () => {
    const row = target
    if (!row) return
    setSheetOpen(false)
    if (row.archived === true) void toggleArchive(row)
    else setArchiveAsk(row)
  }

  return (
    <div className="main" data-screen="exercise-library">
      <SubPageTop title="動作庫" backLabel="返回" onBack={onBack} action={
        <button className="icon-btn" type="button" aria-label="新增動作" onClick={() => open(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      } />

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
            {grouped
              ? sections.map(({ g, rows }) => (
                  <section key={g} aria-label={muscleGroupLabel(g)}>
                    <div className="tr-sec tr-sec-group">
                      <span className="tr-sec-glyph" aria-hidden="true">{glyphOf(g)}</span>
                      {muscleGroupLabel(g)}
                      <span className="cnt">{rows.length}</span>
                    </div>
                    <div className="tr-card">{rows.map(rowOf)}</div>
                  </section>
                ))
              : active.length > 0 && <div className="tr-card">{active.map(rowOf)}</div>}
            {archived.length > 0 && (
              <>
                <div className="tr-sec">已封存</div>
                <div className="tr-card" data-section="archived">
                  {/* 已封存區沒有肌群段頭：副標照舊寫肌群（review） */}
                  {archived.map((e) => <ExerciseRow key={e.id} exercise={e} grouped={false} onOpen={() => open(e)} />)}
                </div>
              </>
            )}
          </>
        )}
        <GymVisualCredit exercises={shown} />
      </div>

      <ConfirmDialog
        open={archiveAsk !== null}
        title={`封存「${askName}」？`}
        cancelLabel="先不要"
        confirmLabel="封存"
        onCancel={() => setArchiveAsk(null)}
        onConfirm={() => {
          const row = archiveAsk
          setArchiveAsk(null)
          if (row) void toggleArchive(row)
        }}
      >
        <p>封存後不會出現在加動作的選單，過去的訓練仍顯示名稱。</p>
        <p>要還原：清單最下面的「已封存」。</p>
      </ConfirmDialog>

      <ExerciseEditSheet
        open={sheetOpen}
        exercise={target}
        exercises={exercises}
        onClose={() => setSheetOpen(false)}
        onWrite={write}
        onToggleArchive={target ? archiveFromSheet : undefined}
      />
    </div>
  )
}
