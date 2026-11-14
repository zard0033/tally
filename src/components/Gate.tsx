/* 登入頁、開機畫面、App 內整頁錯誤共用的那一幅畫（v2.135，樣張 `_design-sample/login-directions.html` 甲「日出上山」）。
   整頁是故事書的山坡：最前景是紙色地面，按鈕與字坐在地上、當小徑的起點；小徑爬到山頂那面旗（App 圖示裡同一面），
   沿路四塊踏腳石＝今日頁的四餐。插圖整幅 aria-hidden，狀態用文字說（載入中是讀屏才讀得到的隱藏字）。

   motion：
   - intro：登入頁的開場（山浮上→日出→小徑畫上去→石頭依序亮→旗子立起→按鈕浮上，約 2.1 秒），之後只剩雲飄、旗飄
   - loading：石頭由近到遠輪流亮；整幅延遲 300ms 才淡入——開機通常不到 300ms，快的時候只看到天空色，接著登入頁的開場從天空開始
   - still：沒有開場、石頭不閃（連不上、整頁錯誤）；雲飄、旗飄三種都有
   shifted：有字要說時整幅往上挪，把地面讓給字（山與地面的路徑畫到 y=1000，上挪 236 也不露出底下的天空色）。 */
import type { CSSProperties, ReactNode } from 'react'
import { useId, useRef, useState } from 'react'
import { minutesOf, skyAt } from '@/lib/todayScene'
import { useSkyEdge } from '@/components/useSkyEdge'

/** 這一頁生命週期裡畫已經出現過一次：之後再掛上的（開機→App 內載入）不再等 300ms，不然會閃一下只剩天空 */
let shownOnce = false

const TRAIL = 'M196 700C206 650 128 628 152 584C172 548 252 548 246 508C241 478 206 470 214 444'
/* 小徑的面：沿 TRAIL 取樣、近寬 32 遠窄 2 的多邊形（產法：中線取樣＋法線偏移，寬度照距離比例 30×(1−t)^1.6＋2.2） */
const TRAIL_SHAPE = 'M212.0 701.3 L212.2 689.3 L209.7 676.5 L204.9 665.3 L198.7 655.6 L191.8 647.1 L184.5 639.3 L177.4 632.2 L170.8 625.5 L165.1 619.1 L160.7 613.0 L157.7 607.2 L156.2 601.4 L156.4 595.2 L158.9 587.7 L162.7 581.7 L168.1 575.9 L175.1 570.5 L183.2 565.5 L192.0 560.7 L201.3 556.1 L210.6 551.7 L219.6 547.1 L228.1 542.3 L235.6 537.0 L241.8 531.1 L246.3 524.2 L248.7 516.4 L248.4 507.7 L246.7 501.2 L244.1 495.4 L241.0 490.3 L237.5 485.6 L233.8 481.3 L230.0 477.3 L226.2 473.5 L222.7 469.7 L219.6 466.0 L217.1 462.2 L215.2 458.2 L214.1 454.0 L214.0 449.4 L215.1 444.2 L212.9 443.8 L211.8 449.2 L211.8 454.3 L212.9 459.0 L214.9 463.4 L217.5 467.6 L220.6 471.6 L224.0 475.5 L227.6 479.5 L231.2 483.6 L234.6 487.9 L237.7 492.4 L240.3 497.3 L242.3 502.6 L243.6 508.3 L243.4 515.6 L241.1 521.6 L237.1 526.8 L231.4 531.5 L224.3 535.7 L216.0 539.6 L206.9 543.3 L197.3 547.0 L187.5 550.8 L177.7 554.9 L168.3 559.6 L159.5 565.2 L151.6 572.0 L145.1 580.3 L140.3 591.0 L138.6 601.9 L139.8 612.3 L143.3 622.0 L148.2 630.9 L154.0 639.3 L160.1 647.3 L166.1 655.1 L171.6 662.7 L176.2 670.1 L179.4 677.1 L181.2 683.8 L181.5 690.1 L180.0 698.7Z'
/** 四塊石頭在小徑上的位置與半徑（近大遠小） */
const STONES: [number, number, number][] = [
  [156.1, 624.3, 7.5],
  [172.9, 564.3, 5.6],
  [232.1, 535.3, 4.4],
  [231.6, 481.4, 3.4],
]

function Cloud({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${w / 60})`} fill="var(--snow)" opacity=".9">
      <ellipse cx="22" cy="17" rx="19" ry="8" />
      <ellipse cx="34" cy="11" rx="13" ry="9" />
      <ellipse cx="46" cy="17" rx="13" ry="7" />
    </g>
  )
}

function Tree({ x, y, big }: { x: number; y: number; big?: boolean }) {
  return big ? (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-2" y="6" width="4" height="15" rx="2" fill="var(--tree)" />
      <circle cx="0" cy="2" r="12" fill="var(--tree)" />
    </g>
  ) : (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-1.4" y="3" width="2.8" height="9" rx="1.4" fill="var(--tree)" />
      <circle cx="0" cy="1" r="7" fill="var(--tree)" />
    </g>
  )
}

function GateArt({ night }: { night: boolean }) {
  const id = useId()
  const glow = `${id}g`
  const mask = `${id}m`
  return (
    <svg className="art gate-art" viewBox="0 0 393 745" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id={glow}>
          <stop offset=".5" stopColor={night ? 'var(--moon)' : 'var(--sun-pale)'} stopOpacity={night ? '.7' : '.95'} />
          <stop offset="1" stopColor={night ? 'var(--moon)' : 'var(--sun-pale)'} stopOpacity="0" />
        </radialGradient>
        {/* 小徑「畫上去」：用遮罩沿中線把面揭開（面是多邊形，不能直接動 stroke-dashoffset）。
            間隔 2 而不是 1：位移 1 時下一段的圓頭不會剛好貼在路徑終點，開場前山頂不會先露出一個圓 */}
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="393" height="745">
          <path className="gate-reveal" d={TRAIL} pathLength={1} stroke="var(--snow)" strokeWidth="40" strokeDasharray="1 2" strokeLinecap="round" />
        </mask>
      </defs>
      <g className="gate-shift">
        <g className="gate-sun">
          <circle className="gate-glow" cx="290" cy="300" r="92" fill={`url(#${glow})`} />
          {night ? (
            <path d="M296 270a32 32 0 1 0 19.2 52.8 26 26 0 0 1-19.2-52.8z" fill="var(--snow)" />
          ) : (
            <circle cx="290" cy="300" r="44" fill="var(--sun)" />
          )}
        </g>
        <g className="gate-cloud">
          <g className="gate-drift">
            <Cloud x={24} y={132} w={116} />
            <Cloud x={148} y={226} w={46} />
          </g>
        </g>
        <g className="gate-cloud">
          <g className="gate-drift is-rev">
            <Cloud x={306} y={150} w={62} />
          </g>
        </g>
        <g className="gate-hill is-far">
          <path d="M0 470C70 440 150 432 214 446S330 410 393 430V1000H0z" fill="var(--hill-far)" />
          <Tree x={118} y={432} />
        </g>
        <g className="gate-hill is-mid">
          <path d="M0 540C80 510 170 506 250 520S350 540 393 506V1000H0z" fill="var(--hill-mid)" />
          <Tree x={56} y={512} big />
          <Tree x={84} y={524} />
          <Tree x={354} y={494} big />
        </g>
        {/* 小徑畫在地面之前：地上那段被地面蓋掉，看起來是從地面邊緣冒出來 */}
        <g mask={`url(#${mask})`}>
          <path d={TRAIL_SHAPE} fill="var(--paper)" />
          <path className="gate-dots" d={TRAIL} />
        </g>
        <path className="gate-hill is-ground" d="M0 616C90 598 200 600 290 614S370 610 393 608V1000H0z" fill="var(--paper)" />
        {STONES.map(([x, y, r], i) => (
          <circle key={i} className="gate-stone" style={{ '--i': i } as CSSProperties} cx={x} cy={y} r={r} />
        ))}
        <g transform="translate(214 446) scale(.82)">
          <rect className="gate-pole" x="-1.6" y="-30" width="3.2" height="30" rx="1.6" fill="var(--ink)" />
          <path className="gate-flag" d="M1.6-29.4 15-24.4 1.6-19.4z" fill="var(--clay)" />
        </g>
      </g>
    </svg>
  )
}

interface GateProps {
  motion: 'intro' | 'loading' | 'still'
  shifted?: boolean
  /** 加在外層的 class（App 內的整頁錯誤沿用 `.notice`） */
  className?: string
  /** 地面上的東西（按鈕、字）；載入中只放讀屏用的隱藏字 */
  children?: ReactNode
}

export default function Gate({ motion, shifted, className, children }: GateProps) {
  const { ref } = useSkyEdge()
  /* 太陽或月亮照打開那一刻的時間（同今日頁的白天 5:30–18:45）；不跟著走，這頁停留不會久 */
  const [night] = useState(() => skyAt(minutesOf(new Date())).kind === 'moon')
  const instant = useRef(shownOnce).current
  const cls = ['gate', `is-${motion}`, shifted && 'is-shifted', instant && 'is-instant', className].filter(Boolean).join(' ')
  return (
    <div
      className={cls}
      ref={ref}
      /* 畫開始出現就記：載入中要等延遲 300ms 後的淡入「開始」才算（雲與旗的常駐動畫一掛上就開始，不能算） */
      onAnimationStart={(e) => {
        if (motion !== 'loading' || e.animationName === 'gate-fade') shownOnce = true
      }}
    >
      <GateArt night={night} />
      {children}
    </div>
  )
}
