/* 組編輯 sheet（訓練中畫面改版，spec.md「訓練中畫面改版」AC 1–3）：點某一組的重量或次數開這張，
   取代原本「點輸入框在該組下方展開調整列」（使用者回報原地展開把整頁撐很長）。

   **每次 ± 或打字立即寫入**，背景頁該列同步更新，沒有「儲存」鈕。點中間的大數字才叫出鍵盤；
   不合法的輸入（打不出數字、負數、超過 DDL 的上限）放回原值，不截斷成別的數字。
   「上次」是最近一次做這個動作的各組，每顆籤點了就把那組的重量與次數一起套到目前這組。
   底部一列左右並排：🗑 刪除（最左）｜同步剩餘 N 組｜完成。
   走 SpringSheet（含輸入欄位，守 `--kb`／`--vvtop`）。目標與開關分開（呼叫端），關閉動畫期間內容不能消失，
   所以這裡留一份最後一次算得出來的畫面（刪掉這一組後，目標在資料裡已經找不到）。 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import ConfirmDialog from '@/components/ConfirmDialog'
import Flip from '@/components/Flip'
import SpringSheet from '@/components/SpringSheet'
import { NUMBER_FLIP_MS } from '@/lib/durations'
import {
  MUSCLE_GROUP_LABEL,
  RPE_SHEET_VALUES,
  formatKg,
  lastCompletedSets,
  remainingSetsAfter,
  removeSetOps,
  syncSetsForwardOps,
  type MuscleGroup,
  type PrefillSet,
  type Row,
  type RowOp,
  type TrainingDb,
  type WorkoutDetail,
} from '@/lib/training'

export interface SetTarget {
  entryId: string
  setId: string
}

interface SetSheetProps {
  open: boolean
  onClose: () => void
  target: SetTarget | null
  detail: WorkoutDetail
  db: TrainingDb
  run: (ops: RowOp[]) => Promise<boolean>
  /** 關閉後焦點回到哪（被點的那顆重量／次數鈕）。 */
  finalFocus: RefObject<HTMLElement | null>
  /** 同步剩餘組數寫成功後，通知背景頁讓被改的列淡綠閃一下。 */
  onSynced: (setIds: string[]) => void
  /** 刪除成功後（這一組已不存在），呼叫端要把焦點落點改到還在的元素。 */
  onDeleted: () => void
}

const round2 = (n: number) => Math.round(n * 100) / 100
const parseWeight = (raw: string): number | null => {
  const n = Number(raw.trim().replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1000 ? round2(n) : null
}
const parseReps = (raw: string): number | null => {
  const n = Number(raw.trim())
  return raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 999 ? n : null
}
const clampWeight = (n: number) => Math.min(1000, Math.max(0, round2(n)))
const clampReps = (n: number) => Math.min(999, Math.max(0, n))

interface SetView {
  name: string
  group: string
  no: number
  total: number
  set: Row
  last: PrefillSet[]
  remaining: number
}

function viewOf(detail: WorkoutDetail, db: TrainingDb, target: SetTarget | null): SetView | null {
  if (!target) return null
  const ex = detail.exercises.find((e) => e.entry.id === target.entryId)
  const index = ex ? ex.sets.findIndex((s) => s.id === target.setId) : -1
  if (!ex || index < 0) return null
  return {
    name: ex.exercise ? String(ex.exercise.name) : '（已刪除的動作）',
    group: ex.exercise ? (MUSCLE_GROUP_LABEL[ex.exercise.muscle_group as MuscleGroup] ?? '其他') : '',
    no: index + 1,
    total: ex.sets.length,
    set: ex.sets[index],
    last: lastCompletedSets(db, String(ex.entry.exercise_id), detail.workout.id),
    remaining: remainingSetsAfter(detail, target.setId).length,
  }
}

/** 一個數字：平常是大數字鈕，點了才變成輸入框（叫鍵盤）。失焦或 Enter 寫入；Esc 或不合法就放回原值。 */
function BigNumber({
  label,
  value,
  text,
  inputMode,
  parse,
  onCommit,
}: {
  label: string
  value: number
  text: string
  inputMode: 'decimal' | 'numeric'
  parse: (raw: string) => number | null
  onCommit: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  // 在使用者點擊的同一個事件裡聚焦，iOS 才會真的升起鍵盤
  useLayoutEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const finish = () => {
    if (cancelled.current) {
      cancelled.current = false
      setEditing(false)
      return
    }
    const v = parse(draft)
    setEditing(false)
    if (v !== null && v !== value) onCommit(v)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="step-num is-input"
        type="text"
        inputMode={inputMode}
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            // 第一下 Esc 只取消輸入，不連 sheet 一起關掉
            e.stopPropagation()
            cancelled.current = true
            e.currentTarget.blur()
          }
        }}
      />
    )
  }
  return (
    <button
      className="step-num"
      type="button"
      aria-label={`${label}，點一下直接輸入`}
      onClick={() => {
        setDraft(text)
        setEditing(true)
      }}
    >
      <Flip text={text} ms={NUMBER_FLIP_MS} />
    </button>
  )
}

function StepLine({
  label,
  deltas,
  value,
  text,
  inputMode,
  parse,
  clamp,
  unit,
  onChange,
}: {
  label: string
  deltas: readonly [number, number, number, number]
  value: number
  text: string
  inputMode: 'decimal' | 'numeric'
  parse: (raw: string) => number | null
  clamp: (n: number) => number
  unit: string
  onChange: (v: number) => void
}) {
  const signed = (d: number) => (d < 0 ? `−${-d}` : `+${d}`)
  const btn = (d: number) => (
    <button
      key={d}
      className="step-b"
      type="button"
      aria-label={`${label}${d < 0 ? '減' : '加'} ${Math.abs(d)}${unit}`}
      onClick={() => onChange(clamp(value + d))}
    >
      {signed(d)}
    </button>
  )
  return (
    <div className="step-line" role="group" aria-label={label}>
      {btn(deltas[0])}
      {btn(deltas[1])}
      <BigNumber label={label} value={value} text={text} inputMode={inputMode} parse={parse} onCommit={onChange} />
      {btn(deltas[2])}
      {btn(deltas[3])}
    </div>
  )
}

export default function SetSheet({ open, onClose, target, detail, db, run, finalFocus, onSynced, onDeleted }: SetSheetProps) {
  const fresh = viewOf(detail, db, target)
  const cache = useRef<SetView | null>(null)
  if (fresh) cache.current = fresh
  const view = fresh ?? cache.current
  const [askDelete, setAskDelete] = useState(false)
  const [synced, setSynced] = useState(false)

  const patch = (payload: Record<string, unknown>) => {
    if (!target || !fresh) return
    void run([{ op: 'update', table: 'workout_sets', rowId: target.setId, payload }])
    setSynced(false)
  }

  const sync = async () => {
    if (!target) return
    const ops = syncSetsForwardOps(detail, target.setId)
    if (await run(ops)) {
      onSynced(ops.map((o) => o.rowId))
      setSynced(true)
    }
  }

  const doDelete = async () => {
    if (!target) return
    setAskDelete(false)
    if (await run(removeSetOps(detail, target.setId))) {
      onDeleted()
      onClose()
    }
  }

  const label = view ? `${view.name} · 第 ${view.no} 組` : '編輯這一組'
  const weight = view ? Number(view.set.weight_kg) : 0
  const reps = view ? Number(view.set.reps) : 0
  const done = view?.set.done === true
  const rpe = view?.set.rpe == null ? null : Number(view.set.rpe)

  return (
    <SpringSheet open={open} onClose={onClose} label={label} title={label} screen="set-sheet" fit finalFocus={finalFocus}>
      {view && (
        <div className="tr-sheet-body tr-sheet-scroll set-sheet-body">
          <div className="set-last">
            <span className="set-sec">上次</span>
            {view.last.length === 0 ? (
              <span className="set-none">沒有紀錄</span>
            ) : (
              <div className="last-chips" role="group" aria-label="上次">
                {view.last.map((p, i) => (
                  <button
                    key={i}
                    className={`last-chip${p.weight_kg === weight && p.reps === reps ? ' is-current' : ''}`}
                    type="button"
                    aria-label={`套用上次 ${formatKg(p.weight_kg)} 公斤 ${p.reps} 次`}
                    onClick={() => patch({ weight_kg: p.weight_kg, reps: p.reps })}
                  >
                    {formatKg(p.weight_kg)} × {p.reps}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="step-block">
            <span className="set-sec">重量 kg</span>
            <StepLine
              label="重量"
              unit=" 公斤"
              deltas={[-5, -2.5, 2.5, 5]}
              value={weight}
              text={formatKg(weight)}
              inputMode="decimal"
              parse={parseWeight}
              clamp={clampWeight}
              onChange={(v) => patch({ weight_kg: v })}
            />
          </div>
          <div className="step-block">
            <span className="set-sec">次數</span>
            <StepLine
              label="次數"
              unit=""
              deltas={[-5, -1, 1, 5]}
              value={reps}
              text={String(reps)}
              inputMode="numeric"
              parse={parseReps}
              clamp={clampReps}
              onChange={(v) => patch({ reps: v })}
            />
          </div>

          {done && (
            <div className="step-block" data-section="rpe">
              <span className="set-sec">吃力程度 RPE</span>
              <div className="rpe-row" role="group" aria-label="吃力程度 RPE">
                {RPE_SHEET_VALUES.map((v) => (
                  <button
                    key={v}
                    className={`rpe-opt${rpe === v ? ' is-current' : ''}`}
                    type="button"
                    aria-pressed={rpe === v}
                    aria-label={`RPE ${v}`}
                    onClick={() => rpe !== v && patch({ rpe: v })}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="rpe-hint">
                <span>9＝還能再做 1 下，10＝力竭</span>
                <button type="button" disabled={rpe === null} onClick={() => patch({ rpe: null })}>
                  清除
                </button>
              </div>
            </div>
          )}

          <div className="set-acts">
            <button
              className="set-del"
              type="button"
              aria-label="刪除這一組"
              disabled={view.total <= 1}
              onClick={() => (done ? setAskDelete(true) : void doDelete())}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
              </svg>
            </button>
            <button className="tr-secondary set-sync" type="button" disabled={view.remaining === 0} onClick={() => void sync()}>
              {view.remaining === 0 ? '沒有剩餘組' : synced ? '已同步 ✓' : `同步剩餘 ${view.remaining} 組`}
            </button>
            <button className="action-btn" type="button" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={askDelete}
        title="刪除這一組？"
        cancelLabel="先不要"
        confirmLabel="刪除"
        danger
        onCancel={() => setAskDelete(false)}
        onConfirm={() => void doDelete()}
      >
        <p>這一組已經打勾，刪掉後訓練量會跟著減少。</p>
      </ConfirmDialog>
    </SpringSheet>
  )
}
