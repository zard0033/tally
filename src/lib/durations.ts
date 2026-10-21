/* 動效四級階梯的 JS 端單一來源（DESIGN.md v2.0 定案，CSS 那邊是 app.css 的
   --dur-fast／--dur-base／--dur-mid／--dur-sheet）。

   為什麼需要這個檔：motion 的動畫時長寫在 TSX 裡，而 App.tsx 有一個計時器必須比
   Today.tsx 的退場動畫晚（刪除後的焦點轉移，早了就抓不到焦點已掉回 body 的時刻）。
   兩個檔各自硬編一份數字、靠註解承諾同步，正是那個焦點 bug 的成因模式——precommit
   review 指出時它已經在同一份 diff 裡出現第二次了。改成兩邊都 import 這裡。

   不從 getComputedStyle 讀 CSS token：那會讓每次動畫都付一次強制樣式重算，而這正是
   v2.1 換掉 react-swipeable-list 的理由之一。改動這裡的值時同步改 app.css 的 token。 */
export const DUR = {
  fast: 100,
  base: 160,
  mid: 220,
  sheet: 280,
} as const

/** motion 吃的是秒 */
export const sec = (ms: number) => ms / 1000

/** 組編輯 sheet 的 ± 數字翻動：spec.md 動效表指定 120ms，落在 fast（100）與 base（160）之間，不是階梯的一級，單獨命名。 */
export const NUMBER_FLIP_MS = 120

/** 減少動態時淡入淡出的時長上限（spec.md AC 10：位移與縮放改 ≤120ms 淡入淡出）。 */
export const REDUCED_FADE_MAX_MS = 120

/** 全部完成：資料一次寫入，畫面由上往下逐組換狀態，每組錯開這麼久（spec.md 動效表）。 */
export const CASCADE_STEP_MS = 60

/** 休息條的 RPE 問題：點了 chip 之後，選中那顆停這麼久才把問題列收起（spec.md「階段 4 乙」）。 */
export const RPE_ASK_CLOSE_MS = 600

/* 手勢放手後的吸附——四級階梯的**唯一例外**（v2.38）。固定時長不管手指離開時多快，
   都跑同一條曲線同一段時間；spring 會承接那個速度，甩得快就多衝一點再穩下來。
   階梯管的是「畫面自己要花多久」，這裡管的是「接住使用者的手」，兩件事。

   參數與當初的對照 demo 同一組（`_design-sample/ios-tuning-compare.html`，**2026-09-08 已刪**，
   要看從 git 撿；那邊是手寫積分器，
   stiffness／damping／mass 的語意跟 motion 的 spring 相同）。stiffness 500 ／ damping 42
   落在臨界阻尼（2√500 ≈ 44.7）之下一點，所以會有小幅過衝——demo 實測過衝約 6px，
   看得出來但不誇張；damping 調到 45 以上就完全不過衝，也就失去「接住手勁」的訊號。 */
export const SETTLE_SPRING = { type: 'spring', stiffness: 500, damping: 42 } as const

/* sheet 與動作卡的 spring（全站精緻度改版，spec.md「全站基礎」；訓練中改版樣張實測選定）。
   手勢與開關類用 spring、不用固定時長曲線——使用者試過對照後的裁決：只有 spring 有 iOS 手感。
   Apple 的 damping ratio ζ／response 換成 stiffness／damping：ω = 2π/response，k = ω²，c = 2·ζ·ω。
   - 開：ζ .8、response .3（Apple 的 drawer 值，有一點點回彈）
   - 關：ζ 1.0（臨界阻尼）——收掉不需要彈
   - 卡片展開收合：ζ .9、response ≈ .35 */
export const SPRING_SHEET_OPEN = { type: 'spring', stiffness: 439, damping: 33.5 } as const
export const SPRING_SHEET_CLOSE = { type: 'spring', stiffness: 300, damping: 34.6 } as const
export const SPRING_CARD = { type: 'spring', stiffness: 322, damping: 32.3 } as const
