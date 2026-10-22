/* 鍵盤升起／切欄位、版面安定之後，把聚焦中的欄位捲進它所在的可捲區。
   食物表單（FoodFormFields，v2.46）與編輯動作 sheet（v2.91）共用；碰 DOM，所以放 components 不放 lib。

   iOS 的表單上下箭頭把焦點切走時**不會自己把目標捲進可視區**——vaul 那段 `scrollIntoView`
   在 v2.34 關掉 `repositionInputs` 時一起關掉了（那輪的主旨是讓 `--kb` 單獨執政）。
   **而 iOS 根本沒發「鍵盤變高」的事件**：用箭頭切欄位時鍵盤已經在、高度沒變 ⇒
   `visualViewport` 只發 `scroll` 不發 `resize`（iOS 是靠**捲 layout viewport** 去露出目標欄位的）。
   那個捲動正是 `--vvtop`（v2.35）在補償的東西——**iOS 自己想幫你露出來，被我們依設計抵銷掉了**，
   所以欄位在表單下半部時要自己捲。

   **掛在呼叫端而不是 App.tsx 那支 listener 裡**：那支是全 repo 最敏感的一段
   （v2.32→v2.35 打了三輪），而且「表單該捲到哪」不是它該知道的事。同一個事件目標上
   listener 依註冊順序執行，呼叫端必定晚於 App.tsx 掛載 ⇒ 輪到這裡時 `--kb`／`--vvtop`
   保證已經更新完，不必自己再算一次版面。

   不怕跟使用者手動捲打架：捲 `.form-wrap` 這種內層容器**不會**觸發 visualViewport 事件
   （它量的是可見區相對 layout viewport 的位移），而 `block: 'nearest'` 對已經在可視區內的
   元素是 no-op——桌面（沒有鍵盤、不需要捲）完全無感。

   只認會叫出鍵盤的文字欄（input、textarea）：食物表單只有 input，編輯動作的要點是 textarea，
   而它正是最下面、最會被鍵盤蓋住的那一欄。`containerRef` 圈定範圍——店家 Autocomplete 的清單
   Portal 出去、在 DOM 上不在容器內，不該被捲。 */
import { useEffect, type RefObject } from 'react'

export function useScrollFocusedIntoView(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const settle = () => {
      const el = document.activeElement
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && containerRef.current?.contains(el)) {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
    vv.addEventListener('resize', settle)
    vv.addEventListener('scroll', settle)
    return () => {
      vv.removeEventListener('resize', settle)
      vv.removeEventListener('scroll', settle)
    }
  }, [containerRef])
}
