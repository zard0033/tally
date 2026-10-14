/* 有氧 sheet（樣張 ④a／④b，AC 10–12）：新增與編輯同一張；row 為 null＝新增，記在畫面選的那天。
   類型二選一用 `.seg` 分段控制器（會改資料值的互斥選擇，DESIGN.md「餐別分段控制器」條），
   **類型決定欄位**：走路＝分鐘＋速度＋坡度，拳擊＝分鐘＋預估熱量。沒有備註、沒有「新類型」入口。
   寫入走 onWrite（排進離線佇列）；失敗留在 sheet 裡說明，不關。刪除不可逆，先問（DESIGN.md「確認對話框」條）。
   欄位狀態放在 CardioForm、以列 id 當 key：每次打開都是一份新的草稿。 */
import { useCallback, useState } from 'react'
import { Drawer } from 'vaul'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useSheetFocus } from '@/components/useSheetFocus'
import {
  CARDIO_FIELDS,
  CARDIO_KINDS,
  CARDIO_KIND_LABEL,
  cardioDraft,
  checkCardio,
  createCardioOps,
  deleteCardioOps,
  updateCardioOps,
  type CardioDraft,
  type Row,
  type RowOp,
} from '@/lib/training'

interface CardioSheetProps {
  open: boolean
  /** null＝新增。 */
  row: Row | null
  /** 新增時記在哪一天。 */
  date: string
  /** 「週一 10/12」；選到的不是今天才顯示，告訴使用者這筆會記在哪天。 */
  dateNote: string | null
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const FIELD_LABEL: Readonly<Record<'speed_kmh' | 'incline_pct' | 'est_kcal', string>> = {
  speed_kmh: '速度 km/h',
  incline_pct: '坡度 %',
  est_kcal: '預估熱量 kcal',
}

interface FormProps extends Omit<CardioSheetProps, 'open'> {
  /** 這張 sheet 的 content 節點：確認對話框要掛進來（見 ConfirmDialog 的註解）。 */
  sheetNode: HTMLDivElement | null
}

function CardioForm({ row, date, dateNote, sheetNode, onClose, onWrite }: FormProps) {
  const [draft, setDraft] = useState<CardioDraft>(() => cardioDraft(row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askDelete, setAskDelete] = useState(false)

  const set = (k: keyof CardioDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const kind = draft.kind as (typeof CARDIO_KINDS)[number]
  const optional = CARDIO_FIELDS[kind] ?? []

  const run = async (ops: RowOp[]) => {
    if (ops.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onWrite(ops)
      onClose()
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkCardio(draft)
    if (!check.ok) {
      setError(check.error)
      return
    }
    void run(
      row
        ? updateCardioOps({ current: row, value: check.value })
        : createCardioOps({ id: crypto.randomUUID(), date, value: check.value }),
    )
  }

  return (
    <form className="tr-sheet-body tr-sheet-scroll" onSubmit={save} noValidate>
      {dateNote && <p className="muted tr-cardio-date">記在 {dateNote}</p>}
      <div className="seg tr-cardio-kind" role="group" aria-label="有氧類型">
        {CARDIO_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => set('kind', k)}>
            {CARDIO_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className={`tr-cardio-grid cols-${1 + optional.length}`}>
        <label className="tr-field">
          <span className="lb">分鐘</span>
          <input
            inputMode="decimal"
            value={draft.minutes}
            aria-label="分鐘"
            autoComplete="off"
            onChange={(e) => set('minutes', e.target.value)}
          />
        </label>
        {optional.map((f) => (
          <label key={f} className="tr-field">
            <span className="lb">
              {FIELD_LABEL[f]}
              <em>選填</em>
            </span>
            <input
              inputMode="decimal"
              value={draft[f]}
              aria-label={FIELD_LABEL[f]}
              autoComplete="off"
              onChange={(e) => set(f, e.target.value)}
            />
          </label>
        ))}
      </div>

      {error && (
        <p className="tr-form-error" role="alert">
          {error}
        </p>
      )}
      <button className="action-btn" type="submit" disabled={busy}>
        {row ? '儲存' : '存下這筆'}
      </button>
      {row && (
        <button
          className="tr-text-btn is-quiet tr-text-btn-center"
          type="button"
          disabled={busy}
          onClick={() => setAskDelete(true)}
        >
          刪除這筆
        </button>
      )}

      {row && (
        <ConfirmDialog
          open={askDelete}
          title="刪除這筆有氧？"
          cancelLabel="先不要"
          confirmLabel="刪除"
          danger
          container={sheetNode}
          onCancel={() => setAskDelete(false)}
          onConfirm={() => {
            setAskDelete(false)
            void run(deleteCardioOps(row.id))
          }}
        >
          <p>刪掉就找不回來。</p>
        </ConfirmDialog>
      )}
    </form>
  )
}

export default function CardioSheet({ open, row, date, dateNote, onClose, onWrite }: CardioSheetProps) {
  const focus = useSheetFocus()
  const [sheetNode, setSheetNode] = useState<HTMLDivElement | null>(null)
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      focus(node)
      setSheetNode(node)
    },
    [focus],
  )
  const title = row ? '編輯有氧' : '記一筆有氧'

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
        <Drawer.Content ref={attach} tabIndex={-1} className="sheet"
          aria-label={title}
          data-screen="cardio-sheet"
          // 確認對話框掛在這張 sheet 裡；vaul 在 document 的捕獲階段先聽到 Escape，不攔的話會連 sheet 一起關
          onEscapeKeyDown={(e) => {
            if ((e.target as Element | null)?.closest?.('[role="alertdialog"]')) e.preventDefault()
          }}
        >
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">{title}</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <CardioForm
            key={row?.id ?? 'new'}
            row={row}
            date={date}
            dateNote={dateNote}
            sheetNode={sheetNode}
            onClose={onClose}
            onWrite={onWrite}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
