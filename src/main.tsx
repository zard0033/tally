import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// react-swipeable-list 的基礎版面 CSS（transform/絕對定位/預設過場時長）。
// 排在 app.css 之前，讓 app.css 對 .swipeable-list-item__content--return 等
// class 的時長覆寫（改用 --dur-mid）能在 cascade 上贏過套件預設值。
import 'react-swipeable-list/dist/styles.css'
// 排在 index.css 之後——讓 legacy 的同名 token（--accent 等）在 cascade 上贏過
// shadcn 的預設值。理由見 src/app.css 檔頭。
import './app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
