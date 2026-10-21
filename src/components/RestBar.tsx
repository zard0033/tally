/* 組間休息倒數條（訓練中畫面；規則見 DESIGN.md「組間休息計時器」條）。
   **浮在底部列上方的深色 pill**，絕對定位、不走版面流——與「刪除的復原提示」同一套語言（`.undo-bar`），所以它一眼看就
   不是動作卡的一部分；走版面流的話它一出現就把列表擠短、消失再彈回來。掛在 `.tr-bottom` 裡（那是定位基準，
   bottom: 100% 就貼著底部列上緣，不管底部列多高）。條出現時 `.main.has-rest` 給列表多留底部空間，最後一列捲得到條的上方。
   倒數中：`休息 1:23`＋三個動作 −15／＋15／略過；時長固定 1:30（`REST_SEC`），沒有時長選擇。歸零後（回前景時已超時的情況）：
   整條換強調色、顯示「休息結束 · 已過 0:23」，收起鈕收掉。
   進退場：淡入＋上移 8px（DUR.base）；減少動態只淡入淡出、時長不超過 REDUCED_FADE_MAX_MS。
   RPE 問題列（spec.md「階段 4 乙」）：一個動作的最後一組勾完時，條長高成兩列——上列問「最後一組還能再做幾下」＋四顆 chip
   （RPE_CHIPS），下列是原本的倒數不動。點 chip＝呼叫端寫入；選中的變白、其餘退淡，呼叫端約 0.6 秒後把 ask 收掉，問題列收起。
   沒點就一直留到條自己收起為止，不追問。 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { DUR, REDUCED_FADE_MAX_MS, sec } from '@/lib/durations'
import { formatRest, overtimeText, REST_ADJUST_SEC, remainingMs } from '@/lib/restTimer'
import { RPE_CHIPS } from '@/lib/training'
import type { RestTimer } from '@/components/useRestTimer'

/** 要問 RPE 的那一組；picked＝已點的值（問題列正要收起）。 */
export interface RpeAsk {
  setId: string
  picked: number | null
}

export default function RestBar({ timer, ask, onPick }: { timer: RestTimer; ask: RpeAsk | null; onPick: (rpe: number) => void }) {
  const reduced = useReducedMotion()
  const barRef = useRef<HTMLDivElement>(null)
  // 圓角矩形要撐到問題列收完才還原：ask 一變 null 就拿掉的話，條還有 139px 高就變成大膠囊、把問題那行切掉
  const [tall, setTall] = useState(false)
  useEffect(() => {
    if (ask) setTall(true)
  }, [ask])
  // 點了 chip 之後焦點若還在問題列裡（0.6 秒後它就卸載），交給「略過休息」，鍵盤與讀屏使用者不會掉回文件開頭
  const picked = ask?.picked != null
  useEffect(() => {
    if (!picked) return
    const el = barRef.current
    if (el?.querySelector('.rest-ask')?.contains(document.activeElement)) el.querySelector<HTMLElement>('.rest-row button[aria-label="略過休息"]')?.focus()
  }, [picked])
  const { endAt, now } = timer
  const remaining = endAt === null ? 0 : remainingMs(endAt, now)
  const over = endAt !== null && remaining <= 0
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 8 }
  // 問題列收起：高度一起收（減少動態只淡出），條不會在問題列消失的那一幀跳高度
  const collapsed = reduced ? { opacity: 0 } : { opacity: 0, height: 0 }
  const expanded = reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }
  return (
    <AnimatePresence>
      {endAt !== null && (
        <motion.div
          ref={barRef}
          className={`tr-rest${over ? ' is-over' : ''}${ask || tall ? ' has-ask' : ''}`}
          data-rest={over ? 'over' : 'running'}
          initial={hidden}
          animate={{ opacity: 1, y: 0 }}
          exit={hidden}
          transition={{ duration: sec(reduced ? Math.min(DUR.base, REDUCED_FADE_MAX_MS) : DUR.base), ease: 'easeOut' }}
        >
          <AnimatePresence initial={false} onExitComplete={() => setTall(false)}>
            {ask && (
              <motion.div
                key="ask"
                className="rest-ask"
                data-rpe-ask={ask.setId}
                initial={collapsed}
                animate={expanded}
                exit={collapsed}
                transition={{ duration: sec(reduced ? Math.min(DUR.base, REDUCED_FADE_MAX_MS) : DUR.base), ease: 'easeOut' }}
              >
                <span className="q" id="rest-ask-q">這個動作做完了，最後一組還能再做幾下？</span>
                <div className={`rpe-chips${ask.picked !== null ? ' is-picked' : ''}`} role="group" aria-labelledby="rest-ask-q">
                  {RPE_CHIPS.map((c) => (
                    <button
                      key={c.rpe}
                      className={`rpe-chip${ask.picked === c.rpe ? ' is-on' : ''}`}
                      type="button"
                      data-rpe={c.rpe}
                      aria-pressed={ask.picked === c.rpe}
                      aria-disabled={ask.picked !== null}
                      onClick={() => ask.picked === null && onPick(c.rpe)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="rest-row">
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
                <button className="tr-rest-btn" type="button" aria-label="略過休息" onClick={timer.skip}>
                  略過
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
