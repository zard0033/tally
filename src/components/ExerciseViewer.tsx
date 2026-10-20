/* 動作示意圖的放大檢視（點縮圖開，見 ExerciseThumb 的 `zoom`；規則見 DESIGN.md「動作示意圖」條）。
   底部升起的 SpringSheet（與全站其他 sheet 同一套手感：下滑、點背景、Esc 都能關），中間播放該動作的示意動畫
   （`src/assets/exercise-gifs/<key>.gif`，180×180，Gym visual 的 3D 人形標出肌群），最寬放大到 270px。
   動畫網址的對照表放在這個檔案——ExerciseThumb 用 lazy 載入它，約 150 個網址字串不進主 bundle。
   **離線**：縮圖（jpg）進 precache、動畫（gif，共約 14MB）不進——全進會讓 precache 項數與體積太大（見 DESIGN v2.74／v2.77）。
   所以離線時動畫載不到：載入失敗就退成靜態縮圖並說明，而不是留一個破圖；下次開檢視器會再試一次。
   **減少動態**：GIF 沒辦法暫停，`prefers-reduced-motion` 時直接顯示靜態縮圖。
   **alt 有內容**：這裡的圖就是要看的資訊（縮圖才是裝飾、alt=""）。
   圖片 © Gym visual：每次使用都要附著作權標示（NOTICE.md），所以檢視器底下固定印一行。 */
import { useEffect, useState, type RefObject } from 'react'
import { useReducedMotion } from 'motion/react'
import GymVisualCredit from '@/components/GymVisualCredit'
import SpringSheet from '@/components/SpringSheet'
import { catalogKey } from '@/lib/exerciseCatalog'
import { MUSCLE_GROUP_LABEL, type MuscleGroup, type Row } from '@/lib/training'

const urls = import.meta.glob<string>('/src/assets/exercise-gifs/*.gif', { eager: true, query: '?url', import: 'default' })

/** 該動作的示意動畫網址；沒有回 undefined。 */
function gifUrl(exercise: Row): string | undefined {
  const key = catalogKey(exercise)
  return key ? urls[`/src/assets/exercise-gifs/${key}.gif`] : undefined
}

interface ExerciseViewerProps {
  exercise: Row
  /** 靜態縮圖網址（動畫載不到、或減少動態時顯示）。 */
  thumb: string
  open: boolean
  onClose: () => void
  finalFocus?: RefObject<HTMLElement | null>
}

export default function ExerciseViewer({ exercise, thumb, open, onClose, finalFocus }: ExerciseViewerProps) {
  const name = String(exercise.name)
  const group = MUSCLE_GROUP_LABEL[exercise.muscle_group as MuscleGroup] ?? '其他'
  const reduced = useReducedMotion()
  const [gifFailed, setGifFailed] = useState(false)
  // 每次開啟都重新嘗試動畫：離線時退成靜態圖，回線後再開就看得到
  useEffect(() => {
    if (open) setGifFailed(false)
  }, [open])
  const gif = gifUrl(exercise)
  const playing = gif !== undefined && !gifFailed && !reduced
  const note = reduced ? '已開啟「減少動態」，顯示靜態圖' : gifFailed ? '離線時只能看靜態圖，連上網路後再開就有動畫' : null
  return (
    <SpringSheet open={open} onClose={onClose} label={`${name}示意圖`} title={name} screen="exercise-viewer" fit finalFocus={finalFocus}>
      <div className="tr-sheet-body tr-sheet-scroll ex-viewer">
        <p className="ex-viewer-group">{group}</p>
        <figure className="ex-viewer-fig">
          <img
            key={playing ? 'gif' : 'still'}
            src={playing ? gif : thumb}
            alt={`${name}示意${playing ? '動畫' : '圖'}`}
            width={180}
            height={180}
            decoding="async"
            draggable={false}
            onError={playing ? () => setGifFailed(true) : undefined}
          />
          {note ? <figcaption>{note}</figcaption> : null}
        </figure>
        <GymVisualCredit className="ex-viewer-credit" />
      </div>
    </SpringSheet>
  )
}
