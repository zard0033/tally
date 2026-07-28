# Tally

個人營養追蹤 web app。手機為主。需求與分期見 [spec.md](spec.md)。

- **動任何 UI 之前先讀 [DESIGN.md](DESIGN.md)。** 顏色、字級、間距一律用其中的 token，不硬編。
- 開場先讀 [session-state/active.md](session-state/active.md)，session 末更新它。
- 前端純 HTML/CSS/JS，無框架無 build，不載第三方資源（GitHub Pages 靜態託管）。Supabase API 不在此列——它是後端。
- 本機開發跑 `python -m http.server 5500`。**port 不能換**——Supabase 的 OAuth redirect 白名單綁死 5500，換了登入就壞；playwright 也擋 `file://`，一定要走 http。
- 專案無測試框架。`app.js` 的計算邏輯有 self-check：開 `?check` 執行、結果進 console。動到公式、捨入或日期處理就跑一次。
- `service_role` / DB 密碼 / OAuth client secret 永不進 repo。repo 是 public，前端只用 anon key ＋ RLS。
