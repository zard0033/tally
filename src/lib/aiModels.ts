/* 全站 AI 的模型清單（v2.128，使用者 2026-11-11：全站統一成一份設定，主模型＋備援）。
   正本在 supabase/functions/read-label/handler.ts 的 `AI_MODELS`／`VISION_MODELS`（Edge Function 不能 import src），
   這份是給設定頁顯示用的鏡像，兩份由 handler.test.ts 比對。順序＝主模型、備援。
   v2.130（使用者 2026-11-12）：不讓 qwen 當主模型，選單拿掉，只顯示。純函式、不碰 DOM。 */

export interface AiModel {
  id: string
  /** 設定頁顯示的名稱。 */
  label: string
}

export const AI_MODELS: readonly AiModel[] = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash' },
]

/** 讀得了營養標示的模型（函式那端決定辨識送哪些；這裡給比對用）。deepseek 只過了合成標示的冒煙測試，見 handler 的註解。 */
export const VISION_MODELS: readonly string[] = ['deepseek/deepseek-v4.1-flash', 'qwen/qwen3.7-flash']

/** 額度的金額：OpenRouter 的單位是美元，取到分。null＝上游沒給。 */
export function formatUsd(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}`
}
