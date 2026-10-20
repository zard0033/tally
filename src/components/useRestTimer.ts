/* 組間休息計時器的狀態與副作用（運算在 `lib/restTimer.ts`；規格見 spec.md「階段 3 甲：組間休息計時器」）。
 *
 * 時間來源是 `Date.now()` 與存起來的 endAt，不是每秒遞減：鎖屏或切到背景時網頁的 JS 會被暫停，
 * 回到前景（`visibilitychange`）立刻重算，數字就是準的。這裡的 interval 只是讓畫面每 250ms 重畫，不是計時的依據。
 * 提示音走 `<audio>` 元素（WebKit 回報 Web Audio 在回前景後可能靜音）；iOS 要先有使用者手勢才放行，
 * 所以第一次開始倒數（＝勾組那一下）順手無聲播一次解鎖。靜音開關打開時 `<audio>` 也會靜音，那種情況只剩視覺提示。
 * 狀態不進資料庫：endAt 存 sessionStorage（重新載入、SW 換版重載後續算），時長偏好存 localStorage。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import chimeUrl from '@/assets/rest-chime.wav'
import {
  adjustEnd,
  firedOnTime,
  nextPreset,
  parseEndAt,
  parsePreset,
  remainingMs,
  REST_ADJUST_SEC,
  REST_AUTO_HIDE_MS,
  startRest,
  type RestPreset,
} from '@/lib/restTimer'

const PRESET_KEY = 'tally.rest.preset'
const endKey = (workoutId: string) => `tally.rest.end.${workoutId}`

// 隱私模式或停用儲存時存取會丟錯：讀不到當沒有、寫不進去就算了，計時器本身照常
function readStore(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key)
  } catch {
    return null
  }
}
function writeStore(kind: 'local' | 'session', key: string, value: string | null): void {
  try {
    const s = kind === 'local' ? localStorage : sessionStorage
    if (value === null) s.removeItem(key)
    else s.setItem(key, value)
  } catch {
    /* 見上 */
  }
}

export interface RestTimer {
  /** 倒數的結束時間點；沒有在休息是 null。 */
  endAt: number | null
  /** 上一次重畫時的時間（毫秒時間戳）。 */
  now: number
  /** 下一次開始倒數用的時長（秒）。 */
  preset: RestPreset
  start: () => void
  adjust: (sign: 1 | -1) => void
  skip: () => void
  cyclePreset: () => void
}

export function useRestTimer(workoutId: string, enabled: boolean): RestTimer {
  const [preset, setPreset] = useState<RestPreset>(() => parsePreset(readStore('local', PRESET_KEY)))
  const [endAt, setEndAt] = useState<number | null>(() =>
    enabled ? parseEndAt(readStore('session', endKey(workoutId)), Date.now()) : null,
  )
  const [now, setNow] = useState(() => Date.now())
  const audio = useRef<HTMLAudioElement | null>(null)
  const unlocked = useRef(false)
  const alerted = useRef<number | null>(null)
  const onTime = useRef(false)

  const getAudio = () => (audio.current ??= new Audio(chimeUrl))

  const commit = useCallback(
    (next: number | null, at: number) => {
      setNow(at)
      setEndAt(next)
      writeStore('session', endKey(workoutId), next === null ? null : String(next))
    },
    [workoutId],
  )

  const start = useCallback(() => {
    if (!enabled) return
    const at = Date.now()
    commit(startRest(at, preset), at)
    if (unlocked.current) return
    unlocked.current = true
    const a = getAudio()
    a.muted = true
    a.play()
      .then(() => {
        a.pause()
        a.currentTime = 0
        a.muted = false
      })
      .catch(() => {
        a.muted = false
        unlocked.current = false
      })
  }, [enabled, preset, commit])

  const adjust = useCallback(
    (sign: 1 | -1) => {
      if (endAt === null) return
      const at = Date.now()
      commit(adjustEnd(endAt, sign * REST_ADJUST_SEC, at), at)
    },
    [endAt, commit],
  )

  const skip = useCallback(() => commit(null, Date.now()), [commit])

  const cyclePreset = useCallback(() => {
    const next = nextPreset(preset)
    setPreset(next)
    writeStore('local', PRESET_KEY, String(next))
  }, [preset])

  // 倒數中才重畫；回前景時立刻重算一次（interval 在背景被暫停時，數字靠這一下追上）
  useEffect(() => {
    if (!enabled || endAt === null) return
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 250)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [enabled, endAt])

  // 歸零：準時看著（前景、超時不到 REST_ON_TIME_MS）才響、才自動收起；回前景時已經過了好一陣子就只顯示已過多久
  useEffect(() => {
    // enabled 變 false（訓練在畫面還掛著時被結束）：不響，也不再讀已隱藏的 endAt
    if (!enabled || endAt === null || remainingMs(endAt, now) > 0) return
    if (alerted.current !== endAt) {
      alerted.current = endAt
      onTime.current = document.visibilityState === 'visible' && firedOnTime(endAt, now)
      if (onTime.current) {
        const a = getAudio()
        a.muted = false
        a.currentTime = 0
        void a.play().catch(() => undefined)
      }
    }
    if (onTime.current && now - endAt >= REST_AUTO_HIDE_MS) commit(null, now)
  }, [enabled, endAt, now, commit])

  return { endAt: enabled ? endAt : null, now, preset, start, adjust, skip, cyclePreset }
}
