import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// 排在 index.css 之後——讓 legacy 的同名 token（--accent 等）在 cascade 上贏過
// shadcn 的預設值。理由見 src/app.css 檔頭。
import './app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
