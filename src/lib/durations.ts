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
