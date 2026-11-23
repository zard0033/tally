/* 食物表單的欄位組（品名／店家／熱量／三大營養素）。LogSheet 的「新增食物」、食品庫的
   「新增／以此為範本新增」、食品庫的就地編輯，三處共用這一份。

   抽出來的理由不是「看起來重複」——那兩份各自長大的實作**已經分岔過兩次**：
   ① 品名欄漏了 `inputMode`，手機上跳出數字鍵盤打不出中文（precommit-review 抓到）
   ② 食品庫那份的店家是純 text input，沒有 Autocomplete——同一件事從「記一筆」進去
      可以搜既有店家、從「食品庫」進去不行，是能力差異不是風格差異
   純邏輯（型別／驗證／轉換）早就在 `src/lib/foodForm.ts` 共用了，這裡補上 UI 那半，
   `foodForm.ts` 檔頭那句「UI 留在各自的 screen」隨本檔作廢。

   `portalContainer` 不是可有可無的裝飾：店家下拉的 Portal 若掛在預設的 document.body，
   會落在 sheet 的疊層之外；掛進 sheet 裡，stacking 才跟著 sheet（見 DESIGN.md「店家欄位」條）。
   **放在 sheet 裡用就一定要傳**；不在 sheet 裡（食品庫的就地編輯）留空走預設即可。 */
import { useEffect, useRef, useState } from 'react'
import VendorField from '@/components/VendorField'
import { addAliases, readingToForm, type FoodForm, type LabelReading } from '@/lib/foodForm'
import { SOURCE_CHOICES } from '@/lib/foodSource'
import { compressToDataUri } from './compressImage'
import SegmentedControl from './SegmentedControl'
import { useScrollFocusedIntoView } from './useScrollFocusedIntoView'

interface FieldOpts {
  id: string
  label: string
  required?: boolean
  numeric?: boolean
  value: string
  onChange: (v: string) => void
}

/* 標籤固定在框上方：label 是真的 label 元素、永遠在 DOM 裡（app.css
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
   * 只擋關閉鈕沒用，sheet 手指往下一滑就關了。
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
  /* 「來源、別名」（spec「食品庫改版」）預設收起：新增食物照舊三行就能送出，不變長。 */
  const [moreOpen, setMoreOpen] = useState(false)
  /** 別名輸入框裡還沒加進去的字。 */
  const [aliasDraft, setAliasDraft] = useState('')
  /** 注音選字中：Enter 是選字、不是加入（同估一筆描述框）。 */
  const composingRef = useRef(false)
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
     `{...form, ...patch}`，等待期間改到的欄位會整組被還原。所以合併時一律讀 ref 的最新值，
     不讀閉包裡那份。目前辨識中整組 fieldset 都鎖住（含店家欄），等待期間打不了字，
     這條是保險（e2e/food-library.spec.ts 的「AI 辨識輸入」段有說明）。 */
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
      // formRef 不是 form：保險，等待期間若有欄位被改到要留著（見上方註解）。辨識讀到的欄位仍以辨識為準
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
  /* iOS 的表單上下箭頭把焦點切走時**不會自己把目標捲進可視區**——vaul 那段 `scrollIntoView`
     在 v2.34 關掉 `repositionInputs` 時一起關掉了（那輪的主旨是讓 `--kb` 單獨執政）。當時表單短、
     底部欄位還在框內所以看不出來；v2.40 把「AI 辨識輸入」加在欄位上方、整份表單長高之後才現形
     ——真機回報：從熱量往下切，蛋白質那排被鍵盤蓋住。**按鈕是誘因不是兇手**，捲得動就證明
     `--kb`／`--vvtop` 那套仍然有效，缺的只是自動捲過去這一步。

     `block: 'nearest'` 對已經在可視區內的欄位是 no-op，所以桌面（沒有鍵盤、不需要捲）完全無感。
     **已知未涵蓋**：第一次點欄位叫出鍵盤那一下，`--kb` 是在 `visualViewport` 事件之後才更新的，
     這裡算的可能是縮之前的版面。真機回報的是「切換時」，先修這條，那條等有回報再說。 */
  /* v2.45 只修了一半，真機仍被蓋住：iOS 切欄位時只發 visualViewport 的 `scroll`、不發 `resize`，
     而那個捲動被 `--vvtop` 依設計抵銷掉了——「版面安定之後再捲一次」那支 listener 的全文理由
     在 `useScrollFocusedIntoView`（v2.91 抽出去，編輯動作 sheet 也用同一支）。

     下面 `onFocus` 那條**留著、不是重複**：它是同步的，跑在 iOS 調整版面之前，所以量到的是
     舊版面——對「版面不會再變」的情況（桌面、鍵盤已就位）剛好對，對 iOS 切欄位的情況剛好錯。
     hook 補的是「版面安定之後再捲一次」，兩者管的是不同時機（e2e 各有一條，互為 mutation 對照）。 */
  const formElRef = useRef<HTMLFormElement | null>(null)
  useScrollFocusedIntoView(formElRef)

  /* 別名：打到頓號、逗號就把前面那段加進去（剩下的留在框裡）；Enter 或離開框把整段加進去。
     選字中不動——注音的頓號在選字結束才算數，compositionEnd 再跑一次。 */
  function aliasInput(v: string) {
    if (composingRef.current || !/[、，,]/.test(v)) return setAliasDraft(v)
    const parts = v.split(/[、，,]/)
    const rest = parts.pop() ?? ''
    set({ aliases: addAliases(form.aliases, parts.join('、')) })
    setAliasDraft(rest)
  }
  function commitAlias() {
    if (!aliasDraft.trim()) return
    set({ aliases: addAliases(form.aliases, aliasDraft) })
    setAliasDraft('')
  }

  const scrollFocusedIntoView = (e: React.FocusEvent) => {
    /* **只認 `<input>`**。掛在 `<form>` 上等於接住底下每一個可聚焦的東西——辨識鈕（它也在
       form 裡）、以及店家 Autocomplete 那份 Portal 出去的清單（React 的合成事件走元件樹不走
       DOM 樹，Portal 的內容照樣冒泡到這裡，而它在 DOM 上不在 `.form-wrap` 內，捲起來會動到
       別的容器）。這兩個都不是這條修法要服務的對象。 */
    const el = e.target as HTMLElement
    if (el.tagName !== 'INPUT') return
    el.scrollIntoView({ block: 'nearest' })
  }

  return (
    <form ref={formElRef} onSubmit={(e) => e.preventDefault()} onFocus={scrollFocusedIntoView}>
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
          {/* AI 的視覺身分（v2.134 樣張 ai-flair A，v2.139 補上這顆）：平常一圈淡太陽色光暈，辨識中光沿邊框繞——
              跟估一筆的描述框同一套 .ai-ring。按鈕本身仍是 .scan-btn（e2e 用它找） */}
          <div className={scanning ? 'ai-ring scan-ring busy' : 'ai-ring scan-ring'}>
          <button
            type="button"
            className="scan-btn ai-inner"
            onClick={() => fileRef.current?.click()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
            {/* 秒數用 tabular-nums 等寬字，否則每跳一秒整串字會左右抖（數字寬度不一） */}
            {scanning ? <>辨識中…<span className="scan-sec">{scanSec}</span>秒</> : 'AI 辨識輸入'}
          </button>
          </div>
          {/* role=status：辨識是非同步的，讀屏使用者不會自己回頭看這一行 */}
          {scanError && <p className="scan-error" role="status">{scanError}</p>}
        </>
      )}
      <div className="field-row">
        {renderField({ id: id('name'), label: '品名', required: true, value: form.name, onChange: (v) => set({ name: v }) })}
        <VendorField
          id={id('vendor')}
          value={form.vendor}
          options={vendorOptions}
          onChange={(v) => set({ vendor: v })}
          portalContainer={portalContainer}
          inputRef={vendorInputRef}
        />
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
      {/* 「更多」留在同一個 fieldset 裡：辨識中一起鎖住，iOS 鍵盤上下箭頭也照樣切得到（見 <form> 那段註解） */}
      {/* 2026-11-23 樣張 food-edit-actions.html B：從藍字連結改成一條可點開的列（上下細線），右邊寫現在的狀態，
          收起時也看得到來源與別名，不必點開才知道 */}
      <button className="form-more-btn" type="button" aria-expanded={moreOpen} aria-controls={id('more')} onClick={() => setMoreOpen((o) => !o)}>
        <span className="form-more-title">來源、別名</span>
        {!moreOpen && (
          <span className="form-more-sum">
            {form.verified ? '官方標示' : '粗估'}・{form.aliases.length ? `${form.aliases.length} 個別名` : '沒有別名'}
          </span>
        )}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      {moreOpen && (
        <div className="form-more" id={id('more')}>
          <p className="form-more-label" aria-hidden="true">來源</p>
          <SegmentedControl label="來源" items={SOURCE_CHOICES} value={form.verified ? 'verified' : 'rough'} onPick={(k) => set({ verified: k === 'verified' })} />
          <p className="form-more-hint">照產品標示或官網打的選官方標示</p>
          <div className="field-float alias-field">
            <input
              id={id('alias')}
              type="text"
              placeholder=" "
              value={aliasDraft}
              onChange={(e) => aliasInput(e.target.value)}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={(e) => {
                composingRef.current = false
                aliasInput(e.currentTarget.value)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || composingRef.current || e.nativeEvent.isComposing) return
                e.preventDefault()
                commitAlias()
              }}
              onBlur={commitAlias}
            />
            <label htmlFor={id('alias')}>別名（按 Enter 或打頓號加入）</label>
          </div>
          {/* spec「別名收一次」：一個「店家 品名」同時搜得到店名與品名，不必兩個都存 */}
          <p className="form-more-hint alias-hint">可寫「店家 品名」，搜店名也找得到</p>
          {form.aliases.length > 0 && (
            <ul className="alias-chips" aria-label="別名">
              {form.aliases.map((a) => (
                <li key={a}>
                  <span>{a}</span>
                  <button type="button" aria-label={`拿掉別名 ${a}`} onClick={() => set({ aliases: form.aliases.filter((x) => x !== a) })}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </fieldset>
    </form>
  )
}
