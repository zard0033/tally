import { useEffect } from 'react'

export function useViewportInsets() {
  /* iOS 鍵盤佔掉的高度 → CSS 變數 `--kb`，給貼底的 `.sheet` 當 `bottom` 用。
     鍵盤彈出時 **layout viewport 不變**，只有 visual viewport 縮小，所以
     `position: fixed; bottom: 0` 的 sheet 底緣仍然落在鍵盤底下——真機回報的
     「新增食物表單的蛋白質／脂肪／碳水那排被『加入食品庫』按鈕壓掉、只露一條邊」
     就是這麼來的：可捲區 `.form-wrap` 明明是 `flex:1`，但它算的是那個沒縮水的高度，
     內容沒溢出、於是也捲不動。iOS 表單列上下箭頭「跳得不順」是同一個病灶的表徵
     ——焦點其實跳對了，只是跳到看不見的地方。

     `offsetTop` 要一起扣：iOS 會把 visual viewport 往上推，只看 height 會少算那一段。

     **桌面不是靠 `if (!vv) return` 那道 guard 走掉的**（實測：桌面 WebKit 有
     `visualViewport`，`height === innerHeight`、`offsetTop === 0`）——它照樣跑 `sync()`，
     只是沒有鍵盤、算出來恆為 `0px`，結果等同於沒有這個變數。guard 只擋真的缺這支 API
     的舊瀏覽器。這兩件事結果一樣但機制不同，別再寫成「桌面沒有這個 API」（review 抓到）。
     **這條只能真機驗**——桌面產生不出鍵盤，`--kb` 永遠是 0，模擬不出那個狀態。

     **上面那段描述的效果，在 vaul 的兩個 sheet 上要到 v2.34 才第一次真的發生**：v2.32～v2.33
     期間 vaul 的 `repositionInputs` 用 inline style 蓋著它，這裡算得再對也寫不進版面。
     全文（含關掉 flag 的兩個代價）在 app.css `.sheet` 那段。這個 effect 本身沒有改動——
     它一直是對的，只是沒被套用。

     **第二個變數 `--vvtop`（v2.35）＝ `vv.offsetTop`，補的是完全不同的一件事**：欄位在
     表單下半部時，iOS 為了讓它露出來會**把整個 layout viewport 往上捲**，而
     `position: fixed` 是釘在 layout viewport 上的，sheet 因此整個被推出可見區。
     **`--kb` 管高度、`--vvtop` 管位移，兩者互不取代**——真機實測：品名欄 `vvTop=0`
     一切正常，碳水欄整個畫面上移。
     **只有貼著可見區邊緣的 fixed 元素要補 `--vvtop`**（`.sheet` 貼底是目前唯一一個）；
     `.scrim` 那種 `inset: 0` 撐滿全屏的不必——可見區永遠是 layout viewport 的子集，
     它照樣蓋得住（review 抓到我一開始把 scrim 也算進受害者）。
     **新增貼邊的 fixed 元素時記得比照辦理**，這條在 iOS 上只有真機看得出來。 */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--kb', `${Math.round(hidden)}px`)
      document.documentElement.style.setProperty('--vvtop', `${Math.round(vv.offsetTop)}px`)
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      document.documentElement.style.removeProperty('--kb')
      document.documentElement.style.removeProperty('--vvtop')
    }
  }, [])
}
