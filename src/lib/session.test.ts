import { describe, expect, it } from 'vitest'
import { authStorageKey, parseStoredSession } from './session'

const valid = {
  access_token: 'a.b.c',
  refresh_token: 'r',
  expires_at: 1_700_000_000,
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'u-1', aud: 'authenticated' },
}

describe('authStorageKey', () => {
  it('取 URL 第一段子網域組成 supabase-js 預設的 key', () => {
    expect(authStorageKey('https://abcdefgh.supabase.co')).toBe('sb-abcdefgh-auth-token')
  })

  it('子網域帶多段時只取第一段', () => {
    expect(authStorageKey('https://proj.eu.supabase.co/')).toBe('sb-proj-auth-token')
  })
})

describe('parseStoredSession', () => {
  it('欄位齊全的 session 原樣回傳', () => {
    const s = parseStoredSession(JSON.stringify(valid))
    expect(s?.user.id).toBe('u-1')
    expect(s?.access_token).toBe('a.b.c')
  })

  it('已過期的 session 也要回傳——離線開機服務的就是這種', () => {
    const expired = { ...valid, expires_at: 1 }
    expect(parseStoredSession(JSON.stringify(expired))).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['空字串', ''],
    ['不是 JSON', '{oops'],
    ['JSON 但不是物件', '"x"'],
    ['JSON null', 'null'],
    ['陣列', '[]'],
  ])('%s → null', (_label, raw) => {
    expect(parseStoredSession(raw)).toBeNull()
  })

  it.each([
    ['缺 access_token', { ...valid, access_token: undefined }],
    ['空的 access_token', { ...valid, access_token: '' }],
    ['缺 refresh_token', { ...valid, refresh_token: undefined }],
    ['expires_at 不是數字', { ...valid, expires_at: '1700000000' }],
    ['expires_at 是 NaN（序列化成 null）', { ...valid, expires_at: Number.NaN }],
    ['缺 user', { ...valid, user: undefined }],
    ['user 不是物件', { ...valid, user: 'u-1' }],
    ['user 沒有 id', { ...valid, user: { aud: 'authenticated' } }],
  ])('%s → null，交回 getSession 判斷', (_label, obj) => {
    expect(parseStoredSession(JSON.stringify(obj))).toBeNull()
  })
})
