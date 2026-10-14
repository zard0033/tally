/* 有氧 sheet（樣張 ④a／④b，AC 10–12）：新增與編輯同一張；row 為 null＝新增，記在畫面選的那天。
   類型二選一用 `.seg` 分段控制器（會改資料值的互斥選擇，DESIGN.md「餐別分段控制器」條），
   **類型決定欄位**：走路＝分鐘＋速度＋坡度，拳擊＝分鐘＋預估熱量。沒有備註、沒有「新類型」入口。
   寫入走 onWrite（排進離線佇列）；失敗留在 sheet 裡說明，不關。刪除不可逆，先問（DESIGN.md「確認對話框」條）。
   欄位狀態放在 CardioForm、以列 id 當 key：每次打開都是一份新的草稿。 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** 每次打開加一：當表單的 key。用列 id 當 key 不夠——關閉動畫還沒跑完就再打開「新增」，會沿用上一份草稿。 */
  session: number
  onClose: () => void
  onWrite: (ops: RowOp[]) => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const FIELD_LABEL: Readonly<Record<'speed_kmh' | 'incline_pct' | 'est_kcal', string>> = {
  speed_kmh: '速度 km/h',
  incline_pct: '坡度 %',
  est_kcal: '預估熱量 kcal',
}

interface FormProps extends Omit<CardioSheetProps, 'open' | 'session'> {
  /** 這張 sheet 的 content 節點：確認對話框要掛進來（見 ConfirmDialog 的註解）。 */
  sheetNode: HTMLDivElement | null
  /** 寫入中：sheet 據此擋下滑關與 X（寫入失敗的說明要有地方出現，AC 20）。 */
  onBusy: (busy: boolean) => void
}

function CardioForm({ row, date, dateNote, sheetNode, onClose, onWrite, onBusy }: FormProps) {
  const [draft, setDraft] = useState<CardioDraft>(() => cardioDraft(row))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askDelete, setAskDelete] = useState(false)
  // 這份表單新增時用的 id 固定一個：就算連按兩次送出，第二次也只是同一列的 upsert，不會多一筆
  const [newId] = useState(() => crypto.randomUUID())

  useEffect(() => onBusy(busy), [busy, onBusy])

  const set = (k: keyof CardioDraft, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }))
    setError(null) // 改了欄位（或換了類型、那一欄已經不在）就不再講上一次的錯
  }
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
      // 成功後 busy 不放回去：sheet 關閉動畫期間表單還在，放回去的話第二次 Enter 會再送一次（同 LogSheet）
      onClose()
    } catch (e) {
      setError(`這筆沒有存下來：${errText(e)}`)
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
        : createCardioOps({ id: newId, date, value: check.value }),
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

export default function CardioSheet({ open, row, date, dateNote, session, onClose, onWrite }: CardioSheetProps) {
  const focus = useSheetFocus()
  const busy = useRef(false)
  const onBusy = useCallback((b: boolean) => {
    busy.current = b
  }, [])
  const close = () => {
    if (!busy.current) onClose()
  }
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
        if (!v) close()
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
          // 確認對話框掛在這張 sheet 裡；vaul 在 document 的捕獲階段先聽到 Escape，不攔的話會連 sheet 一起關。
          // 看「對話框開著沒」而不是事件目標：點過對話框的背景後焦點會落到 sheet 上，目標就不在對話框裡了
          onEscapeKeyDown={(e) => {
            if (sheetNode?.querySelector('[role="alertdialog"]')) e.preventDefault()
          }}
        >
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <h2 className="sheet-title">{title}</h2>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={close}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <CardioForm
            key={session}
            row={row}
            date={date}
            dateNote={dateNote}
            sheetNode={sheetNode}
            onClose={onClose}
            onWrite={onWrite}
            onBusy={onBusy}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
