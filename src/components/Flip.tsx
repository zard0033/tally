/** 數字變動時翻一下（spec 動效表：下移 35%→歸位、淡入，ease-out）。靠 key 隨文字重掛；第一次出現不動
 *  （開畫面時不該每個數字都翻一次）。減少動態只留淡入、時長不超過 REDUCED_FADE_MAX_MS。
 *  時長由呼叫端給：± 數字 120ms、統計格 160ms。 */
import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { REDUCED_FADE_MAX_MS, sec } from '@/lib/durations'

export default function Flip({ text, ms }: { text: string; ms: number }) {
  const reduced = useReducedMotion()
  const seen = useRef(false)
  useEffect(() => {
    seen.current = true
  }, [])
  return (
    <motion.span
      key={text}
      className="flip"
      initial={seen.current ? (reduced ? { opacity: 0 } : { y: '35%', opacity: 0 }) : false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: sec(reduced ? Math.min(ms, REDUCED_FADE_MAX_MS) : ms), ease: 'easeOut' }}
    >
      {text}
    </motion.span>
  )
}
