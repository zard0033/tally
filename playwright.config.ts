import { defineConfig, devices } from '@playwright/test'

/* UI 回歸 harness。移植自 C:\Users\Administrator\.claude\tools\tally-verify\
   （legacy vanilla 版的手刻 runner）——沿用 WebKit ＋ 393×745 這個組合，理由原封不動：
   iPhone 14 Pro 螢幕高度 852，但 Safari 有網址列時可視高度只剩約 745，
   這是 DESIGN.md 的設計基準，用 852 測會漏掉「一屏不捲」的溢出。

   base /tally/：vite.config.ts 的 base 是 GitHub Pages 子路徑，dev server 與 preview 都吃
   這個 base，頁面在 <站台>/tally/ 不是網站根目錄。 */

/* e2e 站台的位址寫一次就好。port 的真相來源是 vite.config.ts 的 `preview.port`，這裡是
   跟著它的複本——兩邊都是字面數字，改一邊忘了改另一邊，症狀會是「連不上 server」而不是
   「port 不同步」，很容易誤診（precommit-review 提的）。留在兩處而不是共用常數，是因為
   playwright.config 匯入 vite.config 會把整份 vite 設定與外掛一起拉進測試進程；
   改 port 時記得兩邊一起改。 */
const E2E_ORIGIN = 'http://localhost:5501'
const E2E_URL = `${E2E_ORIGIN}/tally/`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  /* 平行單位是「檔案」（fullyParallel: false），所以 worker 數會跟著 spec 檔數長。
     2026-08-05 加到第 9 個檔時撞牆：九個 worker 同時要求模組轉換，**Vite dev server
     自己 OOM 死掉**（`FATAL ERROR: Zone Allocation failed - process out of memory`），
     server 沒了之後每個 worker 一 navigate 就炸成 `Could not connect to server` 與
     `Cannot find parent object page@…`，看起來像瀏覽器崩潰，其實是後端先倒。
     壓到 4 讓 dev server 活下來，但**瀏覽器端接著在同一個地方倒**：4 個 WebKit 實例
     在開發機的實際餘裕下（實測當下 31.7 GB 只剩 5.0 GB 可用——VS Code、Figma、dwm、
     vmmem 先吃掉一大半）撐不住，症狀變成 `Cannot find parent object page@…` 與
     `browserContext.newPage: Target page, context or browser has been closed`。

     **後端那道牆已經拆掉**（webServer 改跑 build 後的靜態 preview，見下方註解），
     但這個數字留在 2：那是**瀏覽器端**的容量，跟 server 怎麼跑無關——會在別人開著
     編輯器與設計工具時偶發紅的測試等於沒有測試。要往上調就要在記憶體同樣吃緊的狀態下
     實測，不是看著閒置機器調。 */
  workers: 2,
  retries: 0,
  /* 15 條路徑跑在同一個 test() 裡（狀態累積，見 spec 檔頭），所以 timeout 是整份的總時長，
     不是單一路徑。預設 30s 在加到 15 條時就撞牆了——調高而不是拆成多個 test，
     因為「一輪走完不中斷」正是這份 harness 的核心紀律。 */
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: E2E_URL,
    ...devices['iPhone 14 Pro'],
    viewport: { width: 393, height: 745 },
    /* 單一操作等不到就快速失敗，不要把整份 harness 拖到 timeout。沒有這行時，一個被
       遮住／不存在的元素會讓 click 一路等到整份逾時，於是「一輪走完拿到全部問題」的
       紀律失效，而且報錯位置指向收尾那行 evaluate，跟真正卡住的地方無關。 */
    actionTimeout: 5_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  /* 跑 **build 後的靜態產物**，不是 dev server。dev server 是「瀏覽器要哪個檔案才現場
     編譯」，每個 worker 都讓它重跑一次整張模組圖的轉譯——那正是 2026-08-05 那輪
     Zone Allocation OOM 的上游。preview 只把打包好的檔案丟出去，壓力歸零，順帶讓 e2e
     驗到真正會部署的產物而不是 dev 中介層。代價是每輪多一次 build：**實測約 3 秒**
     （`npm run build` ＝ `tsc -b && vite build`，vite 那段只佔 0.35 秒，其餘是型別檢查；
     一開始寫 0.5 秒是只讀了 vite 那行的估計，precommit-review 抓到後量了才改）。

     port 5501 而不是 5500：見 vite.config.ts 的 preview 註解（e2e 不走 OAuth，不受
     白名單約束）。因此 `reuseExistingServer` 改成 **false**——分開 port 之後不再有
     「借用開發中的 server」的需求，讓 Playwright 自己起自己收，孤兒 server 的陷阱
     機械消失，不必再靠文件提醒人工避開。 */
  webServer: {
    command: 'npm run build && npm run preview',
    url: E2E_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
