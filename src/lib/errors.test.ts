import { describe, expect, it } from 'vitest'
import { errMsg, friendlyError } from './errors'

describe('friendlyError', () => {
  it('逾時類換成白話（三種寫法都接住）', () => {
    for (const m of ['TimeoutError: signal timed out', 'AbortError: The operation was aborted', 'signal timed out']) {
      expect(friendlyError(m)).toBe('網路沒回應，請確認連線是否正常')
    }
  })

  it('斷網類換成白話（Chrome 的 Failed to fetch、Safari 的 Load failed）', () => {
    for (const m of ['TypeError: Failed to fetch', 'TypeError: Load failed', 'Load failed']) {
      expect(friendlyError(m)).toBe('連不上網路，請確認 Wi-Fi 或行動網路')
    }
  })

  it('伺服器回的業務訊息原樣放行', () => {
    for (const m of ['numeric field overflow', 'new row violates row-level security policy', '模擬的寫入失敗']) {
      expect(friendlyError(m)).toBe(m)
    }
  })
})

describe('errMsg', () => {
  it('Error 取 message，其他轉字串', () => {
    expect(errMsg(new Error('x'))).toBe('x')
    expect(errMsg('y')).toBe('y')
    expect(errMsg(3)).toBe('3')
  })
})
