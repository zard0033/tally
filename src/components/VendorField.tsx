/* 店家欄：可自由輸入的 Autocomplete（DESIGN v2.6）。新增食物表單與份量微調面板的「這一餐在哪買」共用
   （spec「每一餐記店家」）——同一組選項、同一個「打清單外的名字照樣送得出去」的行為，兩邊不該分岔。 */
import type { Ref, RefObject } from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'

interface VendorFieldProps {
  id: string
  value: string
  /** 既有店家，已去重排序。空陣列＝沒有可選項，仍可自由輸入。 */
  options: string[]
  onChange: (v: string) => void
  /** 從清單點選一個店家（打字不算）：今日頁就地編輯在這時存檔。 */
  onPick?: (v: string) => void
  onBlur?: () => void
  portalContainer?: RefObject<HTMLElement | null>
  inputRef?: Ref<HTMLInputElement>
  disabled?: boolean
}

export default function VendorField({ id, value, options, onChange, onPick, onBlur, portalContainer, inputRef, disabled }: VendorFieldProps) {
  return (
    <div className="field-float">
      {/* 可自由輸入的 Autocomplete，不是受限 Combobox——使用者常打錯店家名，這裡讓既有
          店家可選，但打一個清單外的新名字一樣送得出去。Autocomplete.Root 不渲染自己的
          元素，input 與 label 是 `.field-float` 的直接子節點，版面與一般欄位一致。IME 組字：底層共用 combobox 的 AriaCombobox，composition 期間
          本來就不會把中間態送進 onValueChange，不需要另做 query/filterQuery 雙 state。 */}
      <Autocomplete.Root
        items={options}
        value={value}
        onValueChange={(v, details) => {
          onChange(v)
          if (details.reason === 'item-press') onPick?.(v)
        }}
        openOnInputClick
        disabled={disabled}
      >
        <Autocomplete.Input id={id} placeholder=" " ref={inputRef} onBlur={onBlur} />
        <label htmlFor={id}>店家</label>
        <Autocomplete.Portal container={portalContainer}>
          <Autocomplete.Positioner sideOffset={4}>
            <Autocomplete.Popup className="vendor-popup">
              <Autocomplete.Empty className="vendor-empty">沒有符合的店家，直接送出就會新增</Autocomplete.Empty>
              <Autocomplete.List className="vendor-list">
                {(vendor: string) => (
                  <Autocomplete.Item key={vendor} value={vendor} className="vendor-item">
                    {vendor}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </div>
  )
}
