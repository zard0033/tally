/* 全站 AI 的模型清單（v2.128，使用者 2026-11-11：全站統一成一份設定，主模型＋備援）。
   正本在 supabase/functions/read-label/handler.ts 的 `AI_MODELS`／`VISION_CALIBRATED`（Edge Function 不能 import src），
   這份是給設定頁顯示與選擇用的鏡像，兩份由 handler.test.ts 比對。順序＝預設的主模型、備援。純函式、不碰 DOM。 */

export interface AiModel {
  id: string
  /** 設定頁顯示的名稱。 */
  label: string
}

export const AI_MODELS: readonly AiModel[] = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash' },
]

/** 營養標示辨識只用校準過的模型；選了別的主模型，辨識照舊用這裡的（函式那端決定，這裡只拿來寫說明）。 */
export const VISION_CALIBRATED: readonly string[] = ['qwen/qwen3.7-flash']

export const DEFAULT_AI_MODEL = AI_MODELS[0].id

/** 存起來的值不在清單上（舊值、被改過）就當沒選，用預設。 */
export function normalizeAiModel(v: unknown): string {
  return typeof v === 'string' && AI_MODELS.some((m) => m.id === v) ? v : DEFAULT_AI_MODEL
}

export const aiModelLabel = (id: string): string => AI_MODELS.find((m) => m.id === id)?.label ?? id

/** 額度的金額：OpenRouter 的單位是美元，取到分。null＝上游沒給。 */
export function formatUsd(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}`
}
