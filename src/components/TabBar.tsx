import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { DUR, EASE, sec } from '@/lib/durations'

export type Tab = 'today' | 'training' | 'settings'

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: 'today',
    label: '飲食',
    /* 刀叉（v2.53：分頁從「日記」改名「飲食」——這頁現在只管吃，訓練有自己的分頁） */
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v7M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3M7 10.5V21" />
        <path d="M17.5 21V3c-2.4 1.6-3.5 4.2-3.5 7 0 1.8 1.2 3 3.5 3" />
      </svg>
    ),
  },
  {
    id: 'training',
    label: '訓練',
    /* 啞鈴（樣張 ①）：兩端的片與中間的槓 */
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: '設定',
    /* 齒輪（cog），取代原本的圓＋放射線——那組讀起來像太陽／亮度圖示，跟「設定」
       語意不合（review 快篩抓到的）。path 是通用的齒輪幾何座標（lucide 的
       settings 圖示同款輪廓），不 import lucide-react，手抄座標到這裡即可，
       stroke/fill 規格沿用 `.screen svg` 的全域設定，不必額外覆寫 */
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
]

/* 底部列的分頁 pill（<nav> 只包分頁，CTA 不在裡面——理由見 App.tsx 底部列註解）。
   選中態指示器（v2.5）：只在被選中的那顆 .tab 裡渲染 <motion.span layoutId>，
   各分頁共用同一個 layoutId——切換時上一顆卸載、下一顆掛載發生在同一次
   React commit，motion 的 projection 系統把這當成「同一個元素移動」，
   自動在兩個掛載點之間做 FLIP（只動 transform），接管掉原本瞬跳的底色／邊框。
   --dur-mid（220ms）是 DESIGN.md「中等位移」級距，EASE 沿用全站的
   cubic-bezier(0.4,0,0.2,1)；reduced-motion 直接把 duration 降到 0，
   不是另外接 CSS transition-duration（indicator 的位移是 JS 端的
   motion tween，CSS 那條規則對它沒有作用）。 */
export default function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="主要導覽">
      {TABS.map((t) => (
        <button
          key={t.id}
          className="tab"
          type="button"
          aria-current={tab === t.id ? 'page' : undefined}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
        >
          {tab === t.id && (
            <motion.span
              className="tab-indicator"
              layoutId="tab-indicator"
              aria-hidden="true"
              transition={prefersReducedMotion() ? { duration: 0 } : { duration: sec(DUR.mid), ease: EASE }}
            />
          )}
          {t.icon}
        </button>
      ))}
    </nav>
  )
}
