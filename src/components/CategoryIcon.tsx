/* 食物類型圖示（v2.122，樣張 `_design-sample/storybook-merged.html` 第 3 節）。今日頁、記一筆 sheet、食品庫共用。
   畫法：平塗、沒有外框、一層暗面一點高光，坐在淡藍圓盤上。**靠輪廓分辨，不靠色塊**——藍白兩族撐住全部 17 個，
   太陽黃與陶土只管「食物本色」（蛋黃、湯麵、麥、雞腿、麵包）。白色物件對盤子只有 1.24:1，一律加 --hill-far 淡描邊。
   圖示永遠跟文字一起出現，不是唯一的資訊來源；跟旁邊文字重複時用 decorative 藏起來，免得螢幕閱讀器念兩次。
   顏色全走 app.css 的插圖 token（--snow／--sun／--clay…），不寫死 hex。 */
import type { CSSProperties, ReactNode } from 'react'
import type { FoodCategory } from '@/lib/categories'

export type CategoryBadge = 'noon' | 'yesterday'

const ICONS: Record<FoodCategory, ReactNode> = {
  '燒臘': (
    <>
      <g transform="translate(24 23) scale(.86) translate(-24 -24) rotate(-40 24 24)">
      <circle cx="21.2" cy="38.6" r="3.1" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.3" />
      <circle cx="26.8" cy="38.6" r="3.1" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.3" />
      <rect x="21.5" y="27" width="5" height="11.4" fill="var(--snow)" />
      <path d="M21.5 30v8M26.5 30v8" stroke="var(--hill-far)" strokeWidth="1.3" />
      <path d="M24 6.5c6.6 0 10.8 5.5 10.8 11.8 0 5.8-3.5 9.6-7.2 11.7h-7.2c-3.7-2.1-7.2-5.9-7.2-11.7C13.2 12 17.4 6.5 24 6.5z" fill="var(--clay)" />
      <path d="M31 9.4c2.4 2.3 3.8 5.5 3.8 8.9 0 5.8-3.5 9.6-7.2 11.7h-3.2c3.6-2.4 6.6-6.4 6.6-11.6 0-3.3 0-6.2 0-9z" fill="var(--clay-deep)" />
      <ellipse cx="19.4" cy="14.6" rx="2" ry="4" fill="var(--snow)" opacity=".45" />
      </g>
    </>
  ),
  '便當': (
    <>
      <rect x="8" y="17" width="32" height="21" rx="4" fill="var(--accent)" />
      <path d="M8 31h32v3a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z" fill="var(--ink)" opacity=".3" />
      <rect x="20.5" y="17" width="7.5" height="21" fill="var(--snow)" />
      <rect x="20.5" y="31" width="7.5" height="7" fill="var(--plate-deep)" />
      <path d="M6.5 12.2l35 3.2M6.5 15.6l35-.6" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  '健康餐盒': (
    <>
      <circle cx="24" cy="24.5" r="15.5" fill="var(--accent)" />
      <circle cx="24" cy="24.5" r="12.3" fill="var(--snow)" />
      <path d="M24 12.2a12.3 12.3 0 0 0 0 24.6z" fill="var(--hill-far)" />
      <path d="M14.6 19.4c3.4-1.4 6.6.6 6.8 3.8-3.4 1.2-6.4-.6-6.8-3.8zM14.2 27.6c3.4-1.6 6.8.4 7.1 3.6-3.4 1.4-6.6-.4-7.1-3.6z" fill="var(--accent)" />
      <circle cx="30" cy="19.3" r="3.9" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.2" />
      <circle cx="30" cy="19.3" r="2.2" fill="var(--sun)" />
      <rect x="25.8" y="25.8" width="9.6" height="2.9" rx="1.45" fill="var(--clay)" />
      <rect x="25.8" y="30.1" width="8" height="2.9" rx="1.45" fill="var(--clay)" />
    </>
  ),
  '飯類': (
    <>
      <path d="M10.5 24.5C10.5 14.6 37.5 14.6 37.5 24.5z" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.4" strokeLinejoin="round" />
      <g fill="var(--hill-far)"><ellipse cx="18" cy="20.6" rx="1.5" ry=".85" /><ellipse cx="24" cy="18" rx="1.5" ry=".85" /><ellipse cx="29.6" cy="20.8" rx="1.5" ry=".85" /><ellipse cx="22.6" cy="22.6" rx="1.5" ry=".85" /></g>
      <path d="M8 24h32c0 8.3-7.2 14.6-16 14.6S8 32.3 8 24z" fill="var(--accent)" />
      <path d="M24 38.6c8.8 0 16-6.3 16-14.6h-3.6c0 7-5.4 12.8-12.4 14.6z" fill="var(--ink)" opacity=".22" />
      <rect x="7.5" y="22.6" width="33" height="3.4" rx="1.7" fill="var(--hill-mid)" />
      <rect x="18" y="37.4" width="12" height="3.2" rx="1.6" fill="var(--ink)" />
    </>
  ),
  '麵食': (
    <>
      <path d="M8 24h32c0 8.3-7.2 14.6-16 14.6S8 32.3 8 24z" fill="var(--accent)" />
      <path d="M24 38.6c8.8 0 16-6.3 16-14.6h-3.6c0 7-5.4 12.8-12.4 14.6z" fill="var(--ink)" opacity=".22" />
      <rect x="7.5" y="22.6" width="33" height="3.4" rx="1.7" fill="var(--sun)" />
      <rect x="18" y="37.4" width="12" height="3.2" rx="1.6" fill="var(--ink)" />
      <path d="M19.4 14.6c-1.6 2.2 1.4 3.8-.2 6.4M23.2 15.2c-1.6 2.2 1.4 3.8-.2 6.4M27 15.6c-1.4 2 1.2 3.4-.2 5.6" stroke="var(--sun-noodle)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M17 13.6L40 5.6M18.4 16.4L41 10.6" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </>
  ),
  '餃類': (
    <>
      <ellipse cx="24" cy="35.4" rx="16.5" ry="4.2" fill="var(--accent)" />
      <path d="M8.5 31.5C8.5 21 16.5 14 24 14s15.5 7 15.5 17.5c-6 3.4-25 3.4-31 0z" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M10.4 30.2c6.4 2.6 20.8 2.6 27.2 0" stroke="var(--hill-far)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M13.8 22.4C16.9 18.6 20.3 16.8 24 16.8s7.1 1.8 10.2 5.6" stroke="var(--accent)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M17.6 19.4l1.4 3.6M24 16.8v3.8M30.4 19.4l-1.4 3.6" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  '速食': (
    <>
      <path d="M9.5 22.5C9.5 12.2 38.5 12.2 38.5 22.5z" fill="var(--clay)" />
      <g fill="var(--snow)"><ellipse cx="18" cy="17" rx="1.4" ry=".85" /><ellipse cx="24" cy="15.2" rx="1.4" ry=".85" /><ellipse cx="30" cy="17.2" rx="1.4" ry=".85" /></g>
      <rect x="8.5" y="25" width="31" height="5.8" rx="2.9" fill="var(--ink)" />
      <path d="M9 22.2h30v3H31l-2.2 3.2-2.2-3.2H9z" fill="var(--sun)" />
      <path d="M10 31.8h28v2a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="var(--clay)" />
      <path d="M10 35.4c.6 1.4 2.2 2.4 4 2.4h20c1.8 0 3.4-1 4-2.4z" fill="var(--clay-deep)" />
    </>
  ),
  '早餐店': (
    <>
      <path d="M14 37V23.2c-3.8-1.3-4.6-8.7 1.4-10.6 3.4-1.8 15.8-1.8 19.2 0 6 1.9 5.2 9.3 1.4 10.6V37a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2z" fill="var(--clay)" />
      <path d="M16.8 36.2V22c-3-1-3.2-6.4 1-7.4 3-1.3 9.4-1.3 12.4 0 4.2 1 4 6.4 1 7.4v14.2z" fill="var(--crumb)" />
      <path d="M24.4 19.4c3.6-.4 6.2 2.2 5.6 5.4.6 3.1-1.7 5.7-5 5.5-2.7 1.6-6.4.6-7-2.4-2.4-2-1.4-6.1 1.6-6.7.9-1.2 2.7-1.8 4.8-1.8z" fill="var(--snow)" stroke="var(--clay)" strokeWidth=".9" strokeOpacity=".5" />
      <circle cx="24.2" cy="25" r="3.3" fill="var(--sun)" />
    </>
  ),
  '滷味／鹽水雞': (
    <>
      <path d="M10.5 41.5L38.5 6.5" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="31.4" cy="15.4" rx="5.6" ry="4.4" transform="rotate(-51 31.4 15.4)" fill="var(--clay)" />
      <ellipse cx="29.6" cy="13.6" rx="1.3" ry="2.2" transform="rotate(-51 29.6 13.6)" fill="var(--snow)" opacity=".45" />
      <rect x="19.6" y="19.1" width="9.8" height="9.8" rx="2.2" transform="rotate(-51 24.5 24)" fill="var(--accent)" />
      <rect x="13.1" y="28.4" width="9.4" height="8.2" rx="3.6" transform="rotate(-51 17.8 32.5)" fill="var(--hill-mid)" />
    </>
  ),
  '鍋物': (
    <>
      <path d="M17.5 11.5c-1.6-1.6 1.6-3.2 0-4.8M24 10.5c-1.6-1.6 1.6-3.2 0-4.8M30.5 11.5c-1.6-1.6 1.6-3.2 0-4.8" stroke="var(--hill-mid)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M10 22.5h28v8.5a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7z" fill="var(--accent)" />
      <rect x="13.5" y="25" width="2.6" height="8" rx="1.3" fill="var(--snow)" opacity=".35" />
      <rect x="4.6" y="24.6" width="6.4" height="3.8" rx="1.9" fill="var(--ink)" />
      <rect x="37" y="24.6" width="6.4" height="3.8" rx="1.9" fill="var(--ink)" />
      <path d="M8.5 23.2C9.6 16.6 38.4 16.6 39.5 23.2z" fill="var(--ink)" />
      <rect x="21" y="14" width="6" height="3.6" rx="1.8" fill="var(--ink)" />
    </>
  ),
  '日式': (
    <>
      <path d="M24 9.5c2 0 3.4 1.3 4.8 3.6l9.4 16.2c2.4 4.1-.2 8.7-4.9 8.7H14.7c-4.7 0-7.3-4.6-4.9-8.7l9.4-16.2c1.4-2.3 2.8-3.6 4.8-3.6z" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.4" />
      <path d="M17.4 27h13.2v11H17.4z" fill="var(--ink)" />
      <path d="M17.4 27h13.2v2.2H17.4z" fill="var(--hill-near)" />
    </>
  ),
  '其他正餐': (
    <>
      <path d="M9 33.5C9 23.6 15.6 17.2 24 17.2s15 6.4 15 16.3z" fill="var(--accent)" />
      <path d="M14.2 29.5c.6-4.2 3.2-7.6 6.8-9.2" stroke="var(--snow)" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity=".5" />
      <rect x="6" y="33" width="36" height="3.8" rx="1.9" fill="var(--ink)" />
      <circle cx="24" cy="15" r="2.9" fill="var(--ink)" />
    </>
  ),
  '飲料': (
    <>
      <path d="M31 4.6L26.8 17" stroke="var(--ink)" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M13.8 17.4C13.8 12.2 34.2 12.2 34.2 17.4z" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.2" />
      <path d="M12.8 17.4h22.4l-2.4 20.1a2.6 2.6 0 0 1-2.6 2.3H17.8a2.6 2.6 0 0 1-2.6-2.3z" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M13.9 25.4h20.2l-1.4 12.1a2.6 2.6 0 0 1-2.6 2.3H17.9a2.6 2.6 0 0 1-2.6-2.3z" fill="var(--accent)" />
      <g fill="var(--ink)"><circle cx="19.3" cy="35.8" r="1.8" /><circle cx="24" cy="36.9" r="1.8" /><circle cx="28.7" cy="35.6" r="1.8" /><circle cx="21.6" cy="31.9" r="1.8" /><circle cx="26.4" cy="31.8" r="1.8" /></g>
      <rect x="11.8" y="16.2" width="24.4" height="2.8" rx="1.4" fill="var(--hill-mid)" />
    </>
  ),
  '蛋白質補充': (
    <>
      <path d="M27.6 11.5V8.2a3.2 3.2 0 0 1 6.4 0v3.3" stroke="var(--ink)" strokeWidth="2.4" fill="none" />
      <rect x="15.4" y="6.6" width="6.6" height="5.4" rx="1.6" fill="var(--ink)" />
      <rect x="12.4" y="11" width="23.2" height="6.2" rx="2.2" fill="var(--ink)" />
      <path d="M13.4 17h21.2v18.6a4 4 0 0 1-4 4H17.4a4 4 0 0 1-4-4z" fill="var(--accent)" />
      <path d="M30.6 17h4v18.6a4 4 0 0 1-4 4z" fill="var(--ink)" opacity=".25" />
      <path d="M17 22h4.6M17 26h3M17 30h4.6M17 34h3" stroke="var(--snow)" strokeWidth="1.7" strokeLinecap="round" opacity=".85" />
    </>
  ),
  '配菜': (
    <>
      <path d="M19 29.5l-.6 8.6a2 2 0 0 0 2 2.1h7.2a2 2 0 0 0 2-2.1l-.6-8.6z" fill="var(--hill-mid)" />
      <path d="M24 31v-5M24 30l-5-4.4M24 30l5-4.4" stroke="var(--hill-mid)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <g fill="var(--accent)"><circle cx="13.6" cy="23.2" r="5.6" /><circle cx="19.6" cy="17.6" r="6.4" /><circle cx="28.4" cy="17.6" r="6.4" /><circle cx="34.4" cy="23.2" r="5.6" /><circle cx="24" cy="22" r="6" /><circle cx="18.4" cy="25.4" r="4" /><circle cx="29.6" cy="25.4" r="4" /></g>
      <path d="M8.6 25.4c2 2.4 6.6 4.2 15.4 4.2s13.4-1.8 15.4-4.2c-3 1.2-8 1.8-15.4 1.8s-12.4-.6-15.4-1.8z" fill="var(--ink)" opacity=".25" />
      <g fill="var(--snow)" opacity=".4"><circle cx="17.6" cy="15.2" r="1.6" /><circle cx="11.8" cy="21.6" r="1.3" /><circle cx="26.4" cy="15.2" r="1.3" /></g>
    </>
  ),
  '主食': (
    <>
      <path d="M24 41.5V12" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M24 37.4c-4.6-.6-7.8-3.6-8.6-8.2 4.6.4 7.8 3.6 8.6 8.2z" fill="var(--accent)" />
      <g fill="var(--sun)" stroke="var(--sun-deep)" strokeWidth="1.1">
      <ellipse cx="19.8" cy="30.4" rx="3.1" ry="5.3" transform="rotate(-38 19.8 30.4)" />
      <ellipse cx="28.2" cy="30.4" rx="3.1" ry="5.3" transform="rotate(38 28.2 30.4)" />
      <ellipse cx="19.8" cy="22.8" rx="3.1" ry="5.3" transform="rotate(-38 19.8 22.8)" />
      <ellipse cx="28.2" cy="22.8" rx="3.1" ry="5.3" transform="rotate(38 28.2 22.8)" />
      <ellipse cx="20.4" cy="15.6" rx="2.9" ry="4.8" transform="rotate(-30 20.4 15.6)" />
      <ellipse cx="27.6" cy="15.6" rx="2.9" ry="4.8" transform="rotate(30 27.6 15.6)" />
      <ellipse cx="24" cy="9.6" rx="2.8" ry="4.6" />
      </g>
    </>
  ),
  '點心': (
    <>
      <path d="M12.8 26.5h22.4l-2.8 11.8a2.4 2.4 0 0 1-2.3 1.8H17.9a2.4 2.4 0 0 1-2.3-1.8z" fill="var(--accent)" />
      <path d="M19.2 28.6l.9 9.8M24 28.6v9.8M28.8 28.6l-.9 9.8" stroke="var(--hill-mid)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11.4 27c-1.6-4.6 1.6-8.2 5.4-8 .2-4.4 4.2-7 8.4-6 3.8-.4 6.8 2.6 6.4 6 3.8.2 6 4 4.6 8z" fill="var(--snow)" stroke="var(--hill-far)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M16 22.6c3.2 1.2 11.6 1.4 16-.2" stroke="var(--hill-far)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M25.8 9.4c.4-2 1.6-3.4 3.4-4" stroke="var(--ink)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="25" cy="11.2" r="3.1" fill="var(--clay)" />
    </>
  ),
}

/* 還沒分類（AI 還沒判、或判失敗）：空盤上一個虛線罩子——「這裡有一份，還不知道是什麼」。刻意不像任何一類。 */
const UNSORTED: ReactNode = (
  <>
    <path d="M10 31.5C10 22.6 16.3 16.4 24 16.4s14 6.2 14 15.1" fill="none" stroke="var(--hill-mid)" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="0.1 4.6" />
    <circle cx="24" cy="14.2" r="2.2" fill="var(--hill-mid)" />
    <rect x="6" y="31" width="36" height="3.8" rx="1.9" fill="var(--hill-far)" />
  </>
)

/* 小太陽＝今天稍早（中午）吃過，淺底；月牙＝昨天吃過，深底。一亮一暗，縮到 11px 靠明暗就分得開。 */
const BADGES: Record<CategoryBadge, ReactNode> = {
  noon: (
    <>
      <circle cx="10" cy="10" r="10" fill="var(--sun-pale)" />
      <path d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.2 1.2M14 14l1.2 1.2M4.8 15.2L6 14M14 6l1.2-1.2" stroke="var(--sun-deep)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="10" r="4.1" fill="var(--sun)" stroke="var(--sun-deep)" strokeWidth="1" />
    </>
  ),
  yesterday: (
    <>
      <circle cx="10" cy="10" r="10" fill="var(--ink)" />
      <path d="M12.4 4.2a6.2 6.2 0 1 0 3.6 10.1 5 5 0 0 1-3.6-10.1z" fill="var(--moon)" />
    </>
  ),
}

const BADGE_TEXT: Record<CategoryBadge, string> = { noon: '中午吃過', yesterday: '昨天吃過' }

export interface CategoryIconProps {
  /** null＝還沒分類，畫中性的「未分類」圖示。 */
  category: FoodCategory | null
  /** 盤子直徑。24 以下把圖在盤子裡放大 14%：細節少一點、輪廓大一點。 */
  size?: 24 | 32 | 40
  badge?: CategoryBadge
  /** 旁邊已經有同樣的文字（品名、組名）時打開，整顆 aria-hidden。 */
  decorative?: boolean
}

export default function CategoryIcon({ category, size = 40, badge, decorative = false }: CategoryIconProps) {
  const name = category ?? '未分類'
  const label = badge ? `${name}，${BADGE_TEXT[badge]}` : name
  return (
    <span
      className={`ci${size <= 24 ? ' is-sm' : ''}`}
      style={{ '--s': `${size}px` } as CSSProperties}
      data-category={name}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <svg className="ci-art" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        {category ? ICONS[category] : UNSORTED}
      </svg>
      {badge && (
        <span className="ci-badge" data-badge={badge}>
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            {BADGES[badge]}
          </svg>
        </span>
      )}
    </span>
  )
}

/** 一餐的幾個類型疊成一排（後一個壓前一個 28%）。整排是裝飾：餐別與品名已經在旁邊。 */
export function CategoryStack({ categories, size = 24 }: { categories: readonly (FoodCategory | null)[]; size?: 24 | 32 }) {
  if (categories.length === 0) return null
  return (
    <span className="ci-stack" aria-hidden="true">
      {categories.map((c) => (
        <CategoryIcon key={c ?? '未分類'} category={c} size={size} decorative />
      ))}
    </span>
  )
}
