/* 食物表單的欄位組（品名／店家／熱量／三大營養素）。LogSheet 的「新增食物」、食品庫的
   「新增／以此為範本新增」、食品庫的就地編輯，三處共用這一份。

   抽出來的理由不是「看起來重複」——那兩份各自長大的實作**已經分岔過兩次**：
   ① 品名欄漏了 `inputMode`，手機上跳出數字鍵盤打不出中文（precommit-review 抓到）
   ② 食品庫那份的店家是純 text input，沒有 Autocomplete——同一件事從「記一筆」進去
      可以搜既有店家、從「食品庫」進去不行，是能力差異不是風格差異
   純邏輯（型別／驗證／轉換）早就在 `src/lib/foodForm.ts` 共用了，這裡補上 UI 那半，
   `foodForm.ts` 檔頭那句「UI 留在各自的 screen」隨本檔作廢。

   `portalContainer` 不是可有可無的裝飾：店家下拉的 Portal 若掛在預設的 document.body，
   在 vaul Drawer 裡會被 Radix Dialog 的 `pointer-events: none` 擋掉——選單看得到、點不到
   （真機與 e2e 都撞過，見 DESIGN.md「店家欄位」條）。**放在 sheet 裡用就一定要傳**；
   不在 sheet 裡（食品庫的就地編輯）留空走預設即可。 */
import { useEffect, useRef } from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'
import type { FoodForm } from '@/lib/foodForm'

interface FieldOpts {
  id: string
  label: string
  required?: boolean
  numeric?: boolean
  value: string
  onChange: (v: string) => void
}

/* floating label：label 是真的 label 元素、永遠在 DOM 裡，只是視覺上位移（app.css
   .field-float 那組規則）。placeholder=" " 只是給 :placeholder-shown 當開關用的空白值，
   不是拿 placeholder 冒充 label（WCAG 3.3.2）。
   `numeric` 沒帶時不掛 inputMode——品名是純文字欄位，硬套 decimal 鍵盤在手機上打不出中文。 */
function renderField(opts: FieldOpts) {
  return (
    <div className="field-float">
      <input
        id={opts.id}
        type="text"
        inputMode={opts.numeric ? 'decimal' : undefined}
        placeholder=" "
        value={opts.value}
        onChange={(e) => opts.onChange(e.target.value)}
      />
      <label htmlFor={opts.id}>
        {opts.label}
        {opts.required && <span className="req">*</span>}
      </label>
    </div>
  )
}

export interface FoodFormFieldsProps {
  form: FoodForm
  onChange: (f: FoodForm) => void
  /** 欄位 id 前綴。同一頁不會同時掛兩份，但 e2e 與 label htmlFor 需要穩定且互不衝突的 id。 */
  idPrefix: string
  /** 既有店家，已去重排序。空陣列＝沒有可選項，Autocomplete 仍可自由輸入。 */
  vendorOptions: string[]
  /** 在 sheet 裡使用時必傳（見檔頭）。不傳走 Base UI 預設的 document.body。 */
  portalContainer?: React.RefObject<HTMLElement | null>
  /** 品名已經有值（搜尋字串帶入／以範本新增）時，焦點直接落在店家。 */
  vendorAutoFocus?: boolean
}

export default function FoodFormFields(props: FoodFormFieldsProps) {
  const { form, onChange, idPrefix, vendorOptions, portalContainer, vendorAutoFocus } = props
  const vendorInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (vendorAutoFocus) vendorInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const id = (k: string) => `${idPrefix}${k}`
  const set = (patch: Partial<FoodForm>) => onChange({ ...form, ...patch })

  /* 包在 `<form>` 裡是為了 **iOS 的鍵盤上下箭頭**（form accessory bar），不是為了送出——
     `onSubmit` 一律 preventDefault，送出仍然走各畫面自己的按鈕。真機回報：從品名往下切，
     切到熱量就下不去了，但直接從熱量起跳上下都順。桌面 Tab 順序兩條路徑都正常（實測過），
     所以不是 DOM 順序的問題——**accessory bar 走的不是 Tab 順序**，沒有 `<form>` 時 Safari
     只能靠 DOM 相鄰性猜「同一組欄位」，而店家欄的 Autocomplete 會動態掛載／卸載 Portal 裡的
     listbox，那個猜測就從那裡開始歪掉。`<form>` 是把分組明講出來，不讓它猜。
     **這條只能真機驗**：桌面沒有 accessory bar。 */
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <div className="field-row">
        {renderField({ id: id('name'), label: '品名', required: true, value: form.name, onChange: (v) => set({ name: v }) })}
        <div className="field-float">
          {/* 可自由輸入的 Autocomplete，不是受限 Combobox——使用者常打錯店家名，這裡讓既有
              店家可選，但打一個清單外的新名字一樣送得出去。Autocomplete.Root 不渲染自己的
              元素，input 緊接 label 是直接子節點，floating label 的 `input + label` 選擇器
              因此照樣命中。IME 組字：底層共用 combobox 的 AriaCombobox，composition 期間
              本來就不會把中間態送進 onValueChange，不需要另做 query/filterQuery 雙 state。 */}
          <Autocomplete.Root
            items={vendorOptions}
            value={form.vendor}
            onValueChange={(v) => set({ vendor: v })}
            openOnInputClick
          >
            <Autocomplete.Input id={id('vendor')} placeholder=" " ref={vendorInputRef} />
            <label htmlFor={id('vendor')}>店家</label>
            <Autocomplete.Portal container={portalContainer}>
              <Autocomplete.Positioner sideOffset={4} className="vendor-positioner">
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
      </div>
      {renderField({ id: id('kcal'), label: '熱量（卡）', required: true, numeric: true, value: form.kcal, onChange: (v) => set({ kcal: v }) })}
      <div className="field-row">
        {renderField({ id: id('protein'), label: '蛋白質 g', numeric: true, value: form.protein, onChange: (v) => set({ protein: v }) })}
        {renderField({ id: id('fat'), label: '脂肪 g', numeric: true, value: form.fat, onChange: (v) => set({ fat: v }) })}
        {renderField({ id: id('carb'), label: '碳水 g', numeric: true, value: form.carb, onChange: (v) => set({ carb: v }) })}
      </div>
    </form>
  )
}
