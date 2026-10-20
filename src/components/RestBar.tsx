/* 組間休息倒數條（訓練中畫面，底部列上方；規則見 DESIGN.md「組間休息計時器」條）。
   倒數中：`休息 1:23`＋−15／＋15／時長（點一下換下一檔）／略過。歸零後（回前景時已超時的情況）：整條換強調色、
   顯示「休息結束 · 已過 0:23」，收起鈕收掉。條在底部列上方、與列表是同一個 flex 欄的兄弟，列表自己縮短，不會蓋住最後一列。
   進退場：淡入＋上移 8px（DUR.base）；減少動態只淡入淡出、時長不超過 REDUCED_FADE_MAX_MS。 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { DUR, REDUCED_FADE_MAX_MS, sec } from '@/lib/durations'
import { formatRest, overtimeText, REST_ADJUST_SEC, remainingMs } from '@/lib/restTimer'
import type { RestTimer } from '@/components/useRestTimer'

export default function RestBar({ timer }: { timer: RestTimer }) {
  const reduced = useReducedMotion()
  const { endAt, now, preset } = timer
  const remaining = endAt === null ? 0 : remainingMs(endAt, now)
  const over = endAt !== null && remaining <= 0
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 8 }
  return (
    <AnimatePresence>
      {endAt !== null && (
        <motion.div
          className={`tr-rest${over ? ' is-over' : ''}`}
          data-rest={over ? 'over' : 'running'}
          initial={hidden}
          animate={{ opacity: 1, y: 0 }}
          exit={hidden}
          transition={{ duration: sec(reduced ? Math.min(DUR.base, REDUCED_FADE_MAX_MS) : DUR.base), ease: 'easeOut' }}
        >
          {over ? (
            <>
              <span className="grow" role="status">
                <span className="time" data-rest-text>
                  {overtimeText(remaining)}
                </span>
              </span>
              <button className="tr-rest-btn" type="button" onClick={timer.skip}>
                收起
              </button>
            </>
          ) : (
            <>
              <span className="grow">
                <span className="lbl">休息</span>
                <span className="time" data-rest-text>
                  {formatRest(remaining)}
                </span>
              </span>
              <button className="tr-rest-btn" type="button" aria-label={`減 ${REST_ADJUST_SEC} 秒`} onClick={() => timer.adjust(-1)}>
                −{REST_ADJUST_SEC}
              </button>
              <button className="tr-rest-btn" type="button" aria-label={`加 ${REST_ADJUST_SEC} 秒`} onClick={() => timer.adjust(1)}>
                ＋{REST_ADJUST_SEC}
              </button>
              <button
                className="tr-rest-btn"
                type="button"
                aria-label={`下一次休息 ${preset} 秒，點一下換下一檔`}
                data-rest-preset={preset}
                onClick={timer.cyclePreset}
              >
                {preset} 秒
              </button>
              <button className="tr-rest-btn" type="button" aria-label="略過休息" onClick={timer.skip}>
                略過
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
