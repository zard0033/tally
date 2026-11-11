/* 今日頁頂端的插圖（v2.122，樣張 `_design-sample/storybook-merged.html` 今日頁 A）。
   一個安靜的夏日午後：太陽的位置＝現在幾點（不是今天的那幾頁固定在下午三點），
   山坡上四塊踏腳石＝四餐，記過的那一餐亮起來、現在該記的那一塊有一圈慢慢呼吸的光。
   整幅 aria-hidden：它說的事情（幾點、哪餐記了）時間軸都用文字說過一次。
   位置怎麼算在 src/lib/todayScene.ts；這裡只把比例擺上去。 */
import { useEffect, useState, type CSSProperties } from 'react'
import { localDate } from '@/lib/dates'
import type { MealKey } from '@/lib/meals'
import { FIXED_SCENE_MIN, minutesOf, nextMeal, NO_STONES, rememberStones, skyAt, stonesFor, type Sky } from '@/lib/todayScene'

/* 踏腳石沿著小徑擺，座標在 393×76 的山坡帶裡。y 跟著小徑的起伏走（樣張原圖的 300 高場景下半段，縮成 76）。
   畫面只露出下面 60（viewBox 從 y=16 起）：上緣那 16 是遠山的山頭，靠 overflow:visible 照樣畫出來、但不佔版面。 */
const STONE_AT: [number, number][] = [
  [36, 60],
  [132, 59],
  [232, 55],
  [326, 63],
]

function sunStyle(sky: Sky): CSSProperties {
  if (sky.kind === 'moon') return {}
  /* 弧線只走畫面右半邊：左半是「還能吃」的大數字，太陽不該從字後面升起。
     地平線在山坡帶裡（底下 24px，被山擋住），正午比地平線高 110px，剛好落在大數字的右邊。 */
  return { '--sun-x': `${60 + 34 * sky.t}%`, '--sun-b': `${24 + 110 * sky.h}px` } as CSSProperties
}

/* 太陽一分鐘挪一次就夠了（一分鐘只走 0.05%，肉眼看不出來，但開著不關的話傍晚會落山）。時間收在插圖這一塊裡，
   每分鐘只重畫插圖、不重畫整條時間軸。PWA 從背景回來時立刻對一次，不然太陽和「下一塊」要等下一個 tick 才跟上。 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return now
}

/** logged：這天哪幾餐有紀錄；null＝還在載入（DESIGN「載入態」：還沒讀到不能畫成讀到空）。
 *  onPick：點踏腳石＝開那一餐的記錄（v2.125；跟時間軸的餐別列同一個入口）。 */
export default function TodayScene({
  date,
  logged,
  onPick,
}: {
  date: string
  logged: ReadonlySet<MealKey> | null
  onPick: (meal: MealKey) => void
}) {
  const now = useNow()
  const isToday = date === localDate(now)
  const sky = skyAt(isToday ? minutesOf(now) : FIXED_SCENE_MIN)
  /* 載入中沿用最後一次讀到的那份（存檔後重撈那一下不閃回「都沒記」）；一次都還沒讀到就不畫石頭——
     四塊空心是「讀到了、今天還沒記」，不是「還不知道」。只有「從沒亮變成亮」的那一塊跳一下，
     第一次讀到時本來就亮的不跳（規則在 lib/todayScene.ts 的 rememberStones）。
     換日期時 Today 用 key 讓整幅重掛，所以這裡只會看到同一天裡的變化。 */
  const [mem, setMem] = useState(() => rememberStones(NO_STONES, logged))
  const next = rememberStones(mem, logged)
  if (next !== mem) setMem(next)
  const { known, lit } = next
  const stones = known && stonesFor(known, isToday ? nextMeal(known, now) : null)

  return (
    <div className="scene" aria-hidden="true">
      <svg className="scene-clouds" viewBox="0 0 120 40" preserveAspectRatio="xMidYMid meet">
        <g fill="var(--snow)" opacity=".9">
          <ellipse cx="22" cy="24" rx="20" ry="8.5" />
          <ellipse cx="38" cy="17" rx="15" ry="10" />
          <ellipse cx="54" cy="25" rx="17" ry="7" />
          {/* 右邊那朵小的跟大朵差不多高：原本高 14 個單位，440 寬時頂到週列「15」那一格（2026-11-11 真機） */}
          <ellipse cx="96" cy="24" rx="12" ry="5.5" />
          <ellipse cx="105" cy="20.5" rx="8.5" ry="6" />
        </g>
      </svg>
      {sky.kind === 'sun' ? (
        <svg className="scene-sun" style={sunStyle(sky)} viewBox="-50 -50 100 100">
          <circle r="46" fill="var(--sun-glow)" opacity=".6" />
          <circle r="28" fill="var(--sun)" />
        </svg>
      ) : (
        <svg className="scene-moon" viewBox="-30 -30 60 60">
          <circle r="27" fill="var(--sun-glow)" opacity=".5" />
          <path d="M3.6-15.8a16 16 0 1 0 9.6 26.4 13 13 0 0 1-9.6-26.4z" fill="var(--snow)" />
        </svg>
      )}
      <svg className="scene-hills" viewBox="0 16 393 60">
        <path d="M0 12 C 60 -6, 120 -4, 178 6 S 292 -18, 393 -6 V76 H0Z" fill="var(--hill-far)" />
        <path d="M0 30 C 80 12, 170 16, 240 26 S 350 14, 393 20 V76 H0Z" fill="var(--hill-mid)" />
        <g transform="translate(286 20)">
          <rect x="-2" y="6" width="4" height="14" rx="2" fill="var(--tree)" />
          <circle cx="0" cy="2" r="11" fill="var(--tree)" />
        </g>
        {/* 小樹壓低 6：原位置樹冠頂離上面的量尺只剩十幾 px，擠在一起（2026-11-11 真機） */}
        <g transform="translate(118 23)">
          <rect x="-1.5" y="4" width="3" height="10" rx="1.5" fill="var(--tree)" />
          <circle cx="0" cy="1" r="7.5" fill="var(--tree)" />
        </g>
        {/* 最前面這層是紙：頁面就是畫裡的地面，營養素與餐別長在這塊地上（v2.125）。原本是最深的 --hill-near，
            整頁最暗的一條直接貼最亮的紙（5.19:1），天空讀起來像貼上去的一塊長方形 */}
        <path d="M0 42 C 90 32, 200 35, 290 42 S 370 39, 393 41 V76 H0Z" fill="var(--paper)" />
        <path
          d="M36 60 C 90 52, 120 66, 168 58 S 230 53, 262 60 S 330 67, 358 59"
          fill="none"
          stroke="var(--ink-faint)"
          strokeOpacity=".7"
          strokeWidth="2"
          strokeDasharray="1 7"
          strokeLinecap="round"
        />
        {stones?.map((s, i) => {
          const [x, y] = STONE_AT[i]
          return (
            <g key={s.key} className={`stone is-${s.state}${lit.has(s.key) ? ' just-lit' : ''}`} transform={`translate(${x} ${y})`}>
              {s.state === 'done' ? (
                <g className="stone-mark">
                  <circle r="9" fill="var(--accent)" />
                  <path d="M-4.2.2l2.8 2.8 5.4-5.6" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              ) : s.state === 'next' ? (
                <>
                  {/* 墊一塊地面色的底：小徑的虛線穿過踏腳石會像線從圈裡串過去，石頭該壓在路上 */}
                  <circle r="13" fill="var(--paper)" />
                  <circle className="stone-pulse" r="13" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
                  <circle r="8" fill="none" stroke="var(--accent)" strokeWidth="2.4" />
                </>
              ) : (
                <circle r="6" fill="var(--paper)" stroke="var(--ink-faint)" strokeWidth="2" />
              )}
              <text x={s.state === 'next' ? 23 : 14} y="4.5" className="stone-label">
                {s.label}
              </text>
            </g>
          )
        })}
      </svg>
      {/* 踏腳石可以點（v2.125）：點了開那一餐的記錄，跟時間軸的餐別列同一個入口。它長得像按鈕，不能點就是假的操作暗示。
          插圖整幅 aria-hidden，這幾顆是給手指的捷徑：tabIndex -1、不進讀屏——鍵盤與讀屏用時間軸的餐別列，不重複一份。
          命中區蓋住石頭加餐名（插圖座標 64 寬），高 44px；位置跟山坡帶一樣用 cqw 算。 */}
      {stones?.map((s, i) => {
        const [x, y] = STONE_AT[i]
        return (
          <button
            key={s.key}
            type="button"
            className="stone-hit"
            tabIndex={-1}
            data-meal={s.key}
            style={{ '--x': x, '--y': y } as CSSProperties}
            onClick={() => onPick(s.key)}
          />
        )
      })}
    </div>
  )
}
