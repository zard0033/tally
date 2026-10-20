/* 動作的示意縮圖（動作庫列表、加動作 sheet、訓練中動作卡、課表編輯共用；規則見 DESIGN.md「動作示意圖」條）。
   預設動作有圖（`src/assets/exercises/<key>.jpg`，180×180，Gym visual 的 3D 人形標出肌群；由列 id 反推 key，見 `lib/exerciseCatalog.ts`）；
   使用者自己新增的動作、與資料集沒有對應的預設動作（徒手深蹲、箱式深蹲）沒有圖，顯示肌群的單字。
   圖片 © Gym visual，致謝見設定頁與 NOTICE.md。
   **尺寸固定、底色先鋪**：圖還沒解碼時是同一塊 `--fill`，列不會因為圖載入而跳高或跳寬。
   **`alt=""` 是刻意的**：旁邊就是動作名稱，讀屏念兩次「腿推舉」是雜訊；圖只是輔助辨識器材，不載資訊。
   **`zoom`＝點了放大**（有圖才有）：縮圖外包一顆 ≥ 44px 的按鈕、右下角有放大鏡角標，所以呼叫端不能把它放進另一顆按鈕裡
   （巢狀按鈕不合法，也會吃掉點擊）——列要拆成「縮圖｜主按鈕」並排。檢視器（ExerciseViewer）lazy 載入，第一次點才抓。 */
import { lazy, Suspense, useRef, useState } from 'react'
import { catalogKey, glyphOf } from '@/lib/exerciseCatalog'
import type { Row } from '@/lib/training'

const ExerciseViewer = lazy(() => import('./ExerciseViewer'))

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
    return (
      <span className="ex-thumb is-glyph" aria-hidden="true">
        {glyphOf(exercise?.muscle_group)}
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
