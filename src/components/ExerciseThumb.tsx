/* 動作的示意縮圖（動作庫列表、加動作 sheet、訓練中動作卡共用；規則見 DESIGN.md「動作示意圖」條）。
   預設動作有照片（`src/assets/exercises/<key>.webp`，由列 id 反推 key，見 `lib/exerciseCatalog.ts`）；
   使用者自己新增的動作沒有圖，顯示肌群的單字。
   **尺寸固定、底色先鋪**：圖還沒解碼時是同一塊 `--fill`，列不會因為圖載入而跳高或跳寬。
   **`alt=""` 是刻意的**：旁邊就是動作名稱，讀屏念兩次「腿推舉」是雜訊；圖只是輔助辨識器材，不載資訊。 */
import { catalogKey, glyphOf } from '@/lib/exerciseCatalog'
import type { Row } from '@/lib/training'

// 只取網址（eager）：圖本身不進 JS，由瀏覽器按需載入、PWA precache 負責離線
const urls = import.meta.glob<string>('/src/assets/exercises/*.webp', { eager: true, query: '?url', import: 'default' })

/** 這一列的圖片網址；沒有圖回 undefined。 */
function exerciseImageUrl(exercise: Row | null): string | undefined {
  const key = exercise ? catalogKey(exercise) : null
  return key ? urls[`/src/assets/exercises/${key}.webp`] : undefined
}

export default function ExerciseThumb({ exercise }: { exercise: Row | null }) {
  const src = exerciseImageUrl(exercise)
  return src ? (
    <img className="ex-thumb" src={src} alt="" width={54} height={36} loading="lazy" decoding="async" draggable={false} />
  ) : (
    <span className="ex-thumb is-glyph" aria-hidden="true">
      {glyphOf(exercise?.muscle_group)}
    </span>
  )
}
