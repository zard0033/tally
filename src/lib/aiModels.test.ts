import { describe, expect, it } from 'vitest'
import { AI_MODELS, aiModelLabel, DEFAULT_AI_MODEL, formatUsd, normalizeAiModel } from './aiModels'

describe('aiModels', () => {
  it('normalizeAiModel：清單上的原樣回；null、舊值、非字串都用預設（清單第一個）', () => {
    expect(DEFAULT_AI_MODEL).toBe(AI_MODELS[0].id)
    for (const m of AI_MODELS) expect(normalizeAiModel(m.id)).toBe(m.id)
    for (const v of [null, undefined, '', 'openai/gpt-4o', 42, {}]) expect(normalizeAiModel(v)).toBe(DEFAULT_AI_MODEL)
  })

  it('aiModelLabel：查得到給顯示名，查不到原樣回 id', () => {
    expect(aiModelLabel('qwen/qwen3.7-flash')).toBe('Qwen 3.7 Flash')
    expect(aiModelLabel('x/y')).toBe('x/y')
  })

  it('formatUsd：取到分；null 是「—」', () => {
    expect(formatUsd(7.5)).toBe('$7.50')
    expect(formatUsd(0.004)).toBe('$0.00')
    expect(formatUsd(12.345)).toBe('$12.35')
    expect(formatUsd(null)).toBe('—')
  })
})
