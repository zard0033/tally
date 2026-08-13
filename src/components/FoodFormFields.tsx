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
import { useEffect, useRef, useState } from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'
import { readingToForm, type FoodForm, type LabelReading } from '@/lib/foodForm'
import { compressToDataUri } from './compressImage'

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
  /**
   * 傳了才出現「拍標示自動填」那顆鈕。**只有兩個「新增」入口該傳**——就地編輯是在改一筆
   * 既有食物，重拍一張標示把欄位整組蓋掉不是那個情境要的事。
   * 只負責送出去辨識；拍照、壓縮、載入與錯誤狀態都在本元件內，呼叫端不必各做一份。
   */
  onScan?: (imageDataUri: string) => Promise<LabelReading>
  /**
   * 辨識期間的忙碌狀態。外層拿它**鎖住關閉**（關閉鈕停用 ＋ sheet 的下滑關閉停用）——
   * 只擋關閉鈕沒用，vaul 的抽屜手指往下一滑就關了。
   * 代價是辨識卡住時會被關在畫面裡，最壞約 50 秒（函式那端 45 秒先放棄，再加上傳）——所以按鈕上要有
   * 秒數，讓被關住的那段時間看得出它還活著。
   */
  onBusyChange?: (busy: boolean) => void
}

export default function FoodFormFields(props: FoodFormFieldsProps) {
  const { form, onChange, idPrefix, vendorOptions, portalContainer, vendorAutoFocus, onScan } = props
  const vendorInputRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  /** 填入瞬間的一次性動效開關（數值由上而下依序浮現），~0.7 秒後自己關掉。 */
  const [justFilled, setJustFilled] = useState(false)
  /* 辨識已經等了幾秒。**刻意不做百分比或進度條**：真實進度拿不到（上傳只佔一小段、模型在吐出
     結果前不回報任何東西），而實測同一張圖 12.9／22.4 秒差 1.7 倍，任何百分比都只能用猜的，
     結果就是卡在 90% 或衝到 99% 乾等——比沒有更煩。秒數不假裝知道還要多久，
     但回答了使用者真正在問的問題：**它還活著嗎**（辨識期間表單是鎖住的，這點更重要）。 */
  const [scanSec, setScanSec] = useState(0)
  useEffect(() => {
    if (!scanning) return
    const id = setInterval(() => setScanSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [scanning])

  useEffect(() => {
    if (vendorAutoFocus) vendorInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 辨識是非同步的，而 `form` 這個 prop 會被閉包凍在「按下按鈕那一刻」。直接用它去組
     `{...form, ...patch}`，使用者在等待期間打的字會整組被還原——**包含辨識根本沒讀的店家欄**，
     而那正是我們刻意留給他邊等邊填的地方。所以合併時一律讀 ref 的最新值，不讀閉包裡那份。 */
  const formRef = useRef(form)
  formRef.current = form

  /* 卸載守衛。辨識中若元件被卸載（LogSheet 的「返回搜尋」會直接把這層拆掉），晚到的結果
     仍會呼叫父層還活著的 setState——而 `formRef.current` 停在卸載那一刻的舊值。使用者若在
     這段期間點了別的食物（`setFoodForm({...BLANK, name: prefillName})`），晚到的那次寫入會把
     他剛帶入的品名整組蓋回舊值。**這正是本輪修掉的 stale closure，換一扇門走回來**，
     所以除了鎖住出口（外層按鈕），這裡也要真的把結果丟掉。

     **setup 那半不可省**：StrictMode（dev）會 mount → cleanup → mount，只寫 cleanup 的話
     第一次 cleanup 就把旗標永久壓成 false，之後每次辨識的結果都被丟掉、`setScanning(false)`
     也跳過（畫面永遠停在「辨識中…」）。production 不做 double-invoke，所以這隻只在 dev 發作，
     而 e2e 跑的是 preview（production build）——整套測試都照不到，只有真的手動開 dev 才會遇到。 */
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const id = (k: string) => `${idPrefix}${k}`
  /* 使用者一動手打字就把辨識失敗那行清掉——他已經在走手打這條路了，那行紅字再留著只是噪音。
     （原本它會一直掛到關閉 sheet 為止。） */
  const set = (patch: Partial<FoodForm>) => {
    if (scanError) setScanError('')
    onChange({ ...form, ...patch })
  }

  /* 辨識結果**一律是草稿**（spec.md AC6）：只填欄位，不送出、不擋畫面。失敗也只是留一行字，
     使用者照樣手打——那條路本來就存在且免費，不需要為它蓋復原流程。
     店家刻意不動：標示上沒有店家，那欄是使用者自己的分類。
     `onBusyChange` 讓外層在辨識期間鎖住關閉：**誤按關閉的代價是要重拍一張照片**，值得擋。 */
  async function handleFile(file: File) {
    setScanError('')
    // 歸零跟開始鎖在同一批 state 更新裡：放進 effect 的話，上一次的秒數會在畫面上閃一格才被重設
    setScanSec(0)
    setScanning(true)
    props.onBusyChange?.(true)
    try {
      const patch = readingToForm(await onScan!(await compressToDataUri(file)))
      // 已經卸載就整包丟掉：寫進去會蓋掉使用者這期間換到的另一筆食物（見 aliveRef 註解）。
      if (!aliveRef.current) return
      setScanError('')
      // formRef 不是 form：等待期間打的字要留著（見上方註解）。辨識讀到的欄位仍以辨識為準
      // ——使用者按的就是「AI 辨識輸入」，那是他要的；而且結果是草稿，不滿意可以再改。
      onChange({ ...formRef.current, ...patch })
      setJustFilled(true)
      // 只是把 CSS 動畫的開關關掉，晚一點關沒有副作用，所以不為它做 unmount 清理。
      setTimeout(() => setJustFilled(false), 700)
    } catch {
      /* 所有失敗同一句：登入真的過期時 supabase-js 會發 SIGNED_OUT，App.tsx 直接把人踢回
         登入頁並顯示「登入已過期，請重新登入」（App.tsx onAuthStateChange），比在這裡多印
         一句話有用得多——所以這裡不為 401 另開分支。 */
      setScanError('辨識失敗，請手動填寫')
    } finally {
      // 卸載後就沒有 state 可設，但 onBusyChange 仍要放行——否則外層的 scanBusy 會永遠卡住，
      // 抽屜的下滑關閉就再也回不來（那個 state 活在父層，不隨本元件卸載）。
      if (aliveRef.current) setScanning(false)
      props.onBusyChange?.(false)
      // 清掉 value，否則再選同一個檔不會觸發 change（重拍同一張是合理操作）
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* 包在 `<form>` 裡是為了 **iOS 的鍵盤上下箭頭**（form accessory bar），不是為了送出——
     `onSubmit` 一律 preventDefault，送出仍然走各畫面自己的按鈕。真機回報：從品名往下切，
     切到熱量就下不去了，但直接從熱量起跳上下都順。桌面 Tab 順序兩條路徑都正常（實測過），
     所以不是 DOM 順序的問題——**accessory bar 走的不是 Tab 順序**，沒有 `<form>` 時 Safari
     只能靠 DOM 相鄰性猜「同一組欄位」，而店家欄的 Autocomplete 會動態掛載／卸載 Portal 裡的
     listbox，那個猜測就從那裡開始歪掉。`<form>` 是把分組明講出來，不讓它猜。
     **這條只能真機驗**：桌面沒有 accessory bar。 */
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      {/* 辨識中整組鎖住。用原生 `<fieldset disabled>` 而不是逐個欄位傳 disabled——一個屬性
          就關掉底下所有表單控件（含店家的 Autocomplete，它底下是真的 <input>），
          少寫六處、也不會有漏掉一處的可能。`.form-lock` 只做樣式重置：fieldset 預設帶邊框、
          內距與一個會撐破 flex 版面的 min-width。 */}
      <fieldset className={`form-lock${justFilled ? ' scan-filled' : ''}`} disabled={scanning}>
      {onScan && (
        <>
          {/* capture="environment" 在 iOS Safari 直接開後鏡頭；桌面沒有相機就退成檔案選擇器。
              `type="button"` 不可省——`<form>` 裡沒標 type 的 button 預設是 submit
              （DESIGN.md「多欄輸入一律包 `<form>`」條末尾那句）。 */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            data-testid={`${idPrefix}scan-input`}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <button
            type="button"
            className="scan-btn"
            disabled={scanning}
            onClick={() => fileRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
            {/* 秒數用 tabular-nums 等寬字，否則每跳一秒整串字會左右抖（數字寬度不一） */}
            {scanning ? <>辨識中…<span className="scan-sec">{scanSec}</span>秒</> : 'AI 辨識輸入'}
          </button>
          {/* role=status：辨識是非同步的，讀屏使用者不會自己回頭看這一行 */}
          {scanError && <p className="scan-error" role="status">{scanError}</p>}
        </>
      )}
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
      {/* `form-macros` 是給填入動效的 stagger 用的穩定掛勾。原本寫 `.field-row:nth-of-type(2)`
          ——`:nth-of-type` 是照**標籤名**數的，而 fieldset 底下第 2 個 div 是熱量那個
          `.field-float`（renderField 直接回傳、沒外包 field-row），所以那條規則一個元素都選不到
          （precommit review 抓到）。換成靠位置的另一種寫法只是換一個會再壞的。
          **前綴不可省**：第一版就叫 `macros`，撞上 Today 首頁那排營養素的同名 class，
          白吃了它的 `padding: 0 var(--s-5)`，表單這排左右憑空內縮（使用者實機看出來的）。
          全域 CSS 沒有命名空間，掛勾類一律加自己的前綴。 */}
      <div className="field-row form-macros">
        {renderField({ id: id('protein'), label: '蛋白質 g', numeric: true, value: form.protein, onChange: (v) => set({ protein: v }) })}
        {renderField({ id: id('fat'), label: '脂肪 g', numeric: true, value: form.fat, onChange: (v) => set({ fat: v }) })}
        {renderField({ id: id('carb'), label: '碳水 g', numeric: true, value: form.carb, onChange: (v) => set({ carb: v }) })}
      </div>
      </fieldset>
    </form>
  )
}
