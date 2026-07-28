# Tally

個人營養追蹤 web app。手機為主。需求與分期見 [spec.md](spec.md)。

- **動任何 UI 之前先讀 [DESIGN.md](DESIGN.md)。** 顏色、字級、間距一律用其中的 token，不硬編。
- 開場先讀 [session-state/active.md](session-state/active.md)，session 末更新它。
- 前端純 HTML/CSS/JS，無框架無 build，不載第三方資源（GitHub Pages 靜態託管）。Supabase API 不在此列——它是後端。
- `service_role` / DB 密碼 / OAuth client secret 永不進 repo。repo 是 public，前端只用 anon key ＋ RLS。
