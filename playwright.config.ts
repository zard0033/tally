import { defineConfig, devices } from '@playwright/test'

/* UI 回歸 harness。移植自 C:\Users\Administrator\.claude\tools\tally-verify\
   （legacy vanilla 版的手刻 runner）——沿用 WebKit ＋ 393×745 這個組合，理由原封不動：
   iPhone 14 Pro 螢幕高度 852，但 Safari 有網址列時可視高度只剩約 745，
   這是 DESIGN.md 的設計基準，用 852 測會漏掉「一屏不捲」的溢出。

   base /tally/：vite.config.ts 的 base 是 GitHub Pages 子路徑，dev server 也吃這個 base，
   頁面在 http://localhost:5500/tally/ 不是網站根目錄。 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  /* 15 條路徑跑在同一個 test() 裡（狀態累積，見 spec 檔頭），所以 timeout 是整份的總時長，
     不是單一路徑。預設 30s 在加到 15 條時就撞牆了——調高而不是拆成多個 test，
     因為「一輪走完不中斷」正是這份 harness 的核心紀律。 */
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5500/tally/',
    ...devices['iPhone 14 Pro'],
    viewport: { width: 393, height: 745 },
    /* 單一操作等不到就快速失敗，不要把整份 harness 拖到 timeout。沒有這行時，一個被
       遮住／不存在的元素會讓 click 一路等到整份逾時，於是「一輪走完拿到全部問題」的
       紀律失效，而且報錯位置指向收尾那行 evaluate，跟真正卡住的地方無關。 */
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // port 5500 不能換：Supabase OAuth redirect 白名單綁死這個 port（CLAUDE.md）
    command: 'npm run dev',
    url: 'http://localhost:5500/tally/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
