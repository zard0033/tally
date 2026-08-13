/* 把使用者選的照片壓成可以送進辨識的 data URI。**放這裡不放 src/lib/ 是因為它碰 canvas**
   （Web API，照 CLAUDE.md 的分層不進 lib）。「該縮成多大」那段算術在 `src/lib/image.ts`，
   單獨測得動；本檔剩下的是直述的 API 呼叫，沒有分支可錯。 */
import { fitWithin } from '@/lib/image'

/* 1200／0.85 的來源見 spec.md：1200 是拿真實手機照片（反光、彎曲、傾斜、標示僅佔畫面 15%）
   實測過的，四組尺寸全對；0.85 則是因為 **JPEG 品質完全不進 token 計算**（Qwen3.7 每 32×32 px
   一個 token），省它只省到上傳的幾十 KB，卻犧牲小字的清晰度——省錯地方了。 */
const MAX_EDGE = 1200
const QUALITY = 0.85

/**
 * 壓成 `data:image/jpeg;base64,...`（Edge Function 只收這個形狀）。
 *
 * `imageOrientation: 'from-image'` 不可省：**手機照片的方向存在 EXIF 裡**，不套用會把圖側著
 * 送給模型。各家瀏覽器對「畫到 canvas 時要不要自動轉正」的行為並不一致，所以這裡明講，
 * 不靠預設值（校準腳本那邊的 `ImageOps.exif_transpose` 是同一件事）。
 *
 * **刻意沒有檔案大小上限**：原本設 10MB 是怕低階手機解大圖當掉，但那個取捨算錯了——
 * 拒絕的代價是「這功能你完全用不了」，壓縮失敗的代價只是「這次失敗」，而兩者的收場
 * 一模一樣（顯示錯誤、改手打）。解不動時 `createImageBitmap` 自己會 reject，呼叫端接得住。
 */
export async function compressToDataUri(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到 canvas context')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', QUALITY)
  } finally {
    // 明確釋放：bitmap 持有的是解碼後的點陣資料，一張 4000px 的照片就是幾十 MB。
    bitmap.close()
  }
}
