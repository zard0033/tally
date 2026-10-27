/* 動作的示意縮圖（動作庫列表、加動作 sheet、訓練中動作卡、課表編輯共用；規則見 DESIGN.md「動作示意圖」條）。
   預設動作有圖（`src/assets/exercises/<key>.jpg`，180×180，Gym visual 的 3D 人形標出肌群；由列 id 反推 key，見 `lib/exerciseCatalog.ts`）；
   使用者自己新增的動作、與資料集沒有對應的預設動作（徒手深蹲、箱式深蹲、有氧拳擊）沒有圖，顯示肌群的單字；
   沒有圖、但這個動作的類型有自己的圖示時（`KIND_ICON`，目前只有有氧拳擊的拳擊手套），同一個方塊裡改放線稿圖示。
   圖示是自繪的、不是 Gym visual 的圖，所以不能點、不放大，著作權標示也不因它而印（`hasCatalogImage` 仍是 false）。
   圖片 © Gym visual，每次使用都要附標示：致謝由各畫面的 `GymVisualCredit` 印（列表底部、放大檢視、設定頁），來源見 NOTICE.md。
   **尺寸固定、底色先鋪**：圖還沒解碼時是同一塊 `--fill`，列不會因為圖載入而跳高或跳寬。
   **`alt=""` 是刻意的**：旁邊就是動作名稱，讀屏念兩次「腿推舉」是雜訊；圖只是輔助辨識器材，不載資訊。
   **`zoom`＝點了放大**（有圖才有）：縮圖外包一顆 ≥ 44px 的按鈕、右下角有放大鏡角標，所以呼叫端不能把它放進另一顆按鈕裡
   （巢狀按鈕不合法，也會吃掉點擊）——列要拆成「縮圖｜主按鈕」並排。檢視器（ExerciseViewer）lazy 載入，第一次點才抓。 */
import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { catalogKey, glyphOf } from '@/lib/exerciseCatalog'
import { exerciseKind, type ExerciseKind, type Row } from '@/lib/training'

const ExerciseViewer = lazy(() => import('./ExerciseViewer'))

/** 沒有圖的動作依類型顯示的線稿圖示（描邊與 ✕、⇄、› 同一套：1.6、圓端圓角，顏色跟方塊的 `--ink-muted`）。
 *  樣張 `_design-sample/cardio-icon.html`（使用者 2026-10-22 從五個造型裡定這版）：正面直立的拳擊手套——圓頂拳頭、
 *  左側一道拇指、底下一段袖口。資料集沒有適合有氧拳擊的圖（只有一個出拳技術動作、目標肌是肩）。 */
const KIND_ICON: Partial<Record<ExerciseKind, ReactNode>> = {
  boxing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 15C7.3 14.1 6.5 12.7 6.5 11V8c0-2.8 2.2-5 5-5h1.5c2.8 0 5 2.2 5 5v3.5c0 1.6-.8 2.8-2 3.5" />
      <path d="M6.5 9.5c1.9 0 3.5 1.3 3.5 3.5" />
      <path d="M8 15h8v4.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
    </svg>
  ),
}

// 只取網址（eager）：圖本身不進 JS，由瀏覽器按需載入、PWA precache 負責離線
const urls = import.meta.glob<string>('/src/assets/exercises/*.jpg', { eager: true, query: '?url', import: 'default' })

/** 這一列的圖片網址；沒有圖回 undefined。 */
function exerciseImageUrl(exercise: Row | null): string | undefined {
  const key = exercise ? catalogKey(exercise) : null
  return key ? urls[`/src/assets/exercises/${key}.jpg`] : undefined
}

export default function ExerciseThumb({ exercise, zoom = false }: { exercise: Row | null; zoom?: boolean }) {
  const src = exerciseImageUrl(exercise)
  const [open, setOpen] = useState(false)
  // 檢視器第一次點才掛上（lazy chunk 才會被抓）；之後常駐，關閉動畫才跑得完
  const [mounted, setMounted] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  if (!src) {
    const icon = KIND_ICON[exerciseKind(exercise)]
    return (
      <span className={`ex-thumb is-glyph${icon ? ' is-icon' : ''}`} aria-hidden="true">
        {icon ?? glyphOf(exercise?.muscle_group)}
      </span>
    )
  }
  const img = <img className="ex-thumb" src={src} alt="" width={52} height={52} loading="lazy" decoding="async" draggable={false} />
  if (!zoom || !exercise) return img
  return (
    <>
      <button
        ref={btnRef}
        className="ex-zoom"
        type="button"
        aria-label={`放大${String(exercise.name)}的示意圖`}
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
      >
        {img}
        <svg className="ex-zoom-badge" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="M15 15l5 5" />
        </svg>
      </button>
      {mounted ? (
        <Suspense fallback={null}>
          <ExerciseViewer exercise={exercise} thumb={src} open={open} onClose={() => setOpen(false)} finalFocus={btnRef} />
        </Suspense>
      ) : null}
    </>
  )
}
