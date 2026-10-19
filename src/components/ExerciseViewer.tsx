/* 動作示意圖的放大檢視（點縮圖開，見 ExerciseThumb 的 `zoom`；規則見 DESIGN.md「動作示意圖」條）。
   底部升起的 SpringSheet（與全站其他 sheet 同一套手感：下滑、點背景、Esc 都能關），起始與收尾兩個姿勢上下排、
   各撐滿寬度，一屏看完不必切換。資料集沒有收尾姿勢的動作只顯示一張。
   放大圖（`src/assets/exercises-large/<key>-0|1.webp`，640 寬）網址的對照表放在這個檔案——ExerciseThumb 用 lazy 載入它，
   約 300 個網址字串不進主 bundle。
   **離線**：只有起始姿勢（-0）進 precache；收尾姿勢（-1）不進（precache 到 460 項時 SW 會偶發卡在 activating，見 DESIGN v2.74），
   所以離線時收尾那張載不到——載入失敗就把那一張藏起來、退成單張，而不是留一個破圖。下次開檢視器會再試一次。
   **alt 有內容**：這裡的圖就是要看的資訊（縮圖才是裝飾、alt=""）。 */
import { useEffect, useState, type RefObject } from 'react'
import SpringSheet from '@/components/SpringSheet'
import { catalogKey } from '@/lib/exerciseCatalog'
import { MUSCLE_GROUP_LABEL, type MuscleGroup, type Row } from '@/lib/training'

const urls = import.meta.glob<string>('/src/assets/exercises-large/*.webp', { eager: true, query: '?url', import: 'default' })

/** 該動作的放大圖：[起始, 收尾]；沒有收尾回一張，沒有圖回空陣列。 */
function largeImageUrls(exercise: Row | null): string[] {
  const key = exercise ? catalogKey(exercise) : null
  if (!key) return []
  return [urls[`/src/assets/exercises-large/${key}-0.webp`], urls[`/src/assets/exercises-large/${key}-1.webp`]].filter(
    (u): u is string => typeof u === 'string',
  )
}

interface ExerciseViewerProps {
  exercise: Row
  open: boolean
  onClose: () => void
  finalFocus?: RefObject<HTMLElement | null>
}

export default function ExerciseViewer({ exercise, open, onClose, finalFocus }: ExerciseViewerProps) {
  const name = String(exercise.name)
  const group = MUSCLE_GROUP_LABEL[exercise.muscle_group as MuscleGroup] ?? '其他'
  const [endFailed, setEndFailed] = useState(false)
  // 每次開啟都重新嘗試收尾姿勢：離線時藏起來，回線後再開就看得到
  useEffect(() => {
    if (open) setEndFailed(false)
  }, [open])
  const all = largeImageUrls(exercise)
  const images = endFailed ? all.slice(0, 1) : all
  const poses = ['起始姿勢', '收尾姿勢']
  return (
    <SpringSheet open={open} onClose={onClose} label={`${name}示意圖`} title={name} screen="exercise-viewer" finalFocus={finalFocus}>
      <div className="tr-sheet-body tr-sheet-scroll ex-viewer">
        <p className="ex-viewer-group">{group}</p>
        {images.map((src, i) => (
          <figure className="ex-viewer-fig" key={src}>
            <img
              src={src}
              alt={`${name}・${poses[i]}`}
              width={640}
              height={427}
              decoding="async"
              draggable={false}
              onError={i === 1 ? () => setEndFailed(true) : undefined}
            />
            {all.length > 1 ? <figcaption>{poses[i]}</figcaption> : null}
          </figure>
        ))}
      </div>
    </SpringSheet>
  )
}
