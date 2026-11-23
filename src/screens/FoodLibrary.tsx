/* 食品庫管理頁：搜尋／使用中·已封存分頁／店家分組／就地編輯／以現有食物為範本新增／
   封存＋復原／FAB 新增。v2.147（子頁換皮 B，使用者 2026-11-20 核可）：列內三顆圖示鈕收掉——
   **點列＝展開就地編輯**，「以此為範本新增」「封存」放進展開區的操作列；列尾放熱量（找食物時要看的數字）。
   列首是類型圖示（v2.120 的類型標籤改畫成圖示），透明的原生 select 疊在上面，點了從固定清單改；改過的 AI 不再覆蓋。

   封存的「樂觀＋5 秒復原」刻意不比照 App.tsx 的 intake 刪除（那邊延遲真正的 DELETE
   5 秒才送出，因為硬刪除不可逆，要留一個「還沒真的發生」的窗口）。封存是可逆的
   UPDATE（archived 這一欄），復原本身隨時安全，所以這裡改成「立刻送出封存，畫面樂觀
   隱藏該列，5 秒內按復原就再送一次 UPDATE 解封存」——效果一樣是「看起來可以反悔」，
   但不必重建 pendingDelete／計時器／pagehide flush 那整套只有「不可逆」才需要的機制。
   ponytail: 這個決定只在「archived 語意上等於軟刪除、隨時可逆」成立時才安全，
   換成真的 DELETE 就要照抄 App.tsx 那套。 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { RESTORE_ICON } from '@/components/archiveIcons'
import CategoryIcon from '@/components/CategoryIcon'
import EmptyNote from '@/components/EmptyNote'
import FoodFormFields from '@/components/FoodFormFields'
import { Skel, SkelBlock } from '@/components/Skeleton'
import SpringSheet, { SheetGrabZone } from '@/components/SpringSheet'
import SubPageTop from '@/components/SubPageTop'
import { listArchivedFoods, listIntakeFoodKcal, scanLabel, type Food, type NewFood } from '@/lib/api'
import { MEAL_TYPE_CATEGORIES, SIDE_CATEGORIES, categoryOf, normalizeCategory, type FoodCategory } from '@/lib/categories'
import { localDate, shiftDate } from '@/lib/dates'
import { errMsg, friendlyError } from '@/lib/errors'
import { BLANK_FOOD_FORM, foodMatches, foodToForm, groupByVendor, validateFoodForm, vendorOptionsOf, type FoodForm } from '@/lib/foodForm'
import { kcalByFood, rankUnverified, sourceTag } from '@/lib/foodSource'
import { duplicateCheck, foodLabel, type DuplicateCheck } from '@/lib/foodMatch'

export interface FoodLibraryProps {
  /** 使用中的食品庫（App 既有 state，已排除封存）。 */
  foods: Food[]
  onCreateFood: (food: NewFood) => Promise<Food>
  onUpdateFood: (id: number, patch: Partial<NewFood>) => Promise<void>
  onArchiveFood: (food: Food) => Promise<Food>
  onUnarchiveFood: (food: Food) => Promise<void>
  onSetCategory: (id: number, category: FoodCategory) => Promise<void>
  onBack: () => void
}

type Tab = 'active' | 'archived'

const CHEV = <svg className="lib-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>

export default function FoodLibrary(props: FoodLibraryProps) {
  const { foods, onCreateFood, onUpdateFood, onArchiveFood, onUnarchiveFood, onSetCategory, onBack } = props

  const [tab, setTab] = useState<Tab>('active')
  const [archived, setArchived] = useState<Food[] | null>(null)
  const archivedFetchedRef = useRef(false)
  const [query, setQuery] = useState('')
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<FoodForm>(BLANK_FOOD_FORM)
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)

  /* 新增／範本新增走 sheet（v2.29），不再是整頁 view——同 LogSheet 的「新增食物」，
     底下的清單留在原地，關掉就回到剛才捲到的位置。 */
  const [addOpen, setAddOpen] = useState(false)
  /** 辨識中鎖住關閉（關閉鈕 ＋ 下滑）——誤關的代價是那張照片白拍。 */
  const [scanBusy, setScanBusy] = useState(false)
  const addSheetRef = useRef<HTMLDivElement | null>(null)
  const [addForm, setAddForm] = useState<FoodForm>(BLANK_FOOD_FORM)
  const [addSourceName, setAddSourceName] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  /* 改類型：送出中先顯示選的那個，失敗退回並在那一列下面講原因。 */
  const [catBusy, setCatBusy] = useState<{ id: number; category: FoodCategory } | null>(null)
  const [catErr, setCatErr] = useState<{ id: number; msg: string } | null>(null)

  const [undo, setUndo] = useState<{ food: Food } | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  useEffect(() => {
    if (tab !== 'archived' || archivedFetchedRef.current) return
    archivedFetchedRef.current = true
    void listArchivedFoods().then(setArchived).catch(() => setArchived([]))
  }, [tab])

  /* 「粗估」篩選（v2.153 起；2026-11-23 起叫「粗估」，原「沒查證過」）：只在使用中分頁、只列粗估的，依近 90 天吃掉的熱量排。
     近 90 天的 intake 第一次打開才撈（約 300 列），不是每次進食品庫都撈。撈失敗就照品名排、講一句。 */
  const [unverified, setUnverified] = useState(false)
  const [eaten, setEaten] = useState<Map<number, number> | 'error' | null>(null)
  const eatenFetchedRef = useRef(false)
  useEffect(() => {
    if (!unverified || eatenFetchedRef.current) return
    eatenFetchedRef.current = true
    void listIntakeFoodKcal(shiftDate(localDate(), -90))
      .then((rows) => setEaten(kcalByFood(rows)))
      .catch(() => {
        // 放掉旗標：關掉再打開「粗估」會再撈一次，不必離開畫面
        eatenFetchedRef.current = false
        setEaten('error')
      })
  }, [unverified])

  function openEdit(f: Food) {
    setEditingId(f.id)
    setEditForm(foodToForm(f))
    setEditErr(null)
  }

  /** 編輯時查重：只在改了品名、店家或別名時查（改數字不查——不然舊資料裡本來就重複的兩筆，哪一筆都改不了數字）。 */
  function editDupOf(f: Food): DuplicateCheck<Food> {
    const vendor = editForm.vendor.trim() || null
    const renamed = editForm.name.trim() !== f.name || vendor !== f.vendor || editForm.aliases.join('、') !== f.aliases.join('、')
    return renamed ? duplicateCheck({ name: editForm.name, vendor, aliases: editForm.aliases }, foods, f.id) : { block: null, note: null }
  }

  async function saveEdit(id: number) {
    const self = foods.find((x) => x.id === id) ?? archived?.find((x) => x.id === id)
    if (editBusy || (self && editDupOf(self).block)) return
    const validated = validateFoodForm(editForm)
    if ('error' in validated) return setEditErr(validated.error)
    setEditBusy(true)
    setEditErr(null)
    try {
      await onUpdateFood(id, validated.food)
      setArchived((prev) => prev?.map((f) => (f.id === id ? { ...f, ...validated.food } : f)) ?? prev)
      setEditingId(null)
      setEditBusy(false)
    } catch (e) {
      setEditBusy(false)
      setEditErr(friendlyError(errMsg(e)))
    }
  }

  async function setCategory(f: Food, category: FoodCategory) {
    setCatBusy({ id: f.id, category })
    setCatErr(null)
    try {
      await onSetCategory(f.id, category)
      setArchived((prev) => prev?.map((x) => (x.id === f.id ? { ...x, category, category_manual: true } : x)) ?? prev)
    } catch (e) {
      setCatErr({ id: f.id, msg: friendlyError(errMsg(e)) })
    } finally {
      setCatBusy((cur) => (cur?.id === f.id ? null : cur))
    }
  }

  async function archive(f: Food) {
    const unhide = () =>
      setHiddenIds((prev) => {
        const next = new Set(prev)
        next.delete(f.id)
        return next
      })
    setHiddenIds((prev) => new Set(prev).add(f.id))
    try {
      const archivedFood = await onArchiveFood(f)
      // 成功後 App 已把它濾出 foods，隱藏功成身退；留著的話之後復原回來還是看不到
      unhide()
      // 成功才收起：失敗時草稿要留著；不收的話復原後編輯區會帶著舊草稿復活。
      // 要讀最新值：請求在路上時可能已經改編輯別列，不能關掉那一列
      setEditingId((cur) => (cur === f.id ? null : cur))
      setArchived((prev) => (prev ? [archivedFood, ...prev] : prev))
      setUndo({ food: archivedFood })
      // 計時器等成功才換：A 的提示還在時封存 B 失敗，A 的 5 秒要照走，不然提示永遠不消失
      window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => setUndo(null), 5000)
    } catch {
      unhide()
    }
  }

  async function undoArchive() {
    const p = undo
    if (!p) return
    setUndo(null)
    window.clearTimeout(undoTimer.current)
    setArchived((prev) => prev?.filter((f) => f.id !== p.food.id) ?? prev)
    try {
      await onUnarchiveFood(p.food)
    } catch {
      setArchived((prev) => (prev ? [p.food, ...prev] : prev))
    }
  }

  async function restore(f: Food) {
    setArchived((prev) => prev?.filter((x) => x.id !== f.id) ?? prev)
    try {
      await onUnarchiveFood(f)
      setEditingId((cur) => (cur === f.id ? null : cur)) // 同封存：復原後編輯區不帶舊草稿復活
    } catch {
      setArchived((prev) => (prev ? [f, ...prev] : prev))
    }
  }

  /* v2.29 之前食品庫的店家是純 text input，沒有自動完成——同一件事從「記一筆」進去能搜、
     從這裡進去不能，是能力差異不是風格差異，一併補上。去重排序的規則走 lib 的共用函式，
     不在這裡再寫一份（precommit-review 抓到過一次）。 */
  const vendorOptions = useMemo(() => vendorOptionsOf(foods), [foods])

  function openAdd(prefill: Food | null) {
    /* 以範本新增是一筆新的食物：來源跟著範本（使用者 2026-11-23），別名不複製
       ——兩筆共用同一個別名，估一筆查食品庫時就對到兩筆（v2.153 review）。 */
    setAddForm(prefill ? { ...foodToForm(prefill), aliases: [] } : BLANK_FOOD_FORM)
    setAddSourceName(prefill ? prefill.name : null)
    setAddErr(null)
    setAddOpen(true)
  }

  /* 新增時查重（spec「食品庫改版」AC 13）：同店家同品名（或別名）擋下；只有品名一樣、店家不同一行提醒、照樣能存。邊打邊算。
     食品庫這裡只講一句、不給「改用那筆」（這裡是在管食品庫，不是在記一餐）。 */
  const addDup = duplicateCheck({ name: addForm.name, vendor: addForm.vendor.trim() || null, aliases: addForm.aliases }, foods)

  async function submitAdd() {
    if (addBusy || addDup.block) return
    const validated = validateFoodForm(addForm)
    if ('error' in validated) return setAddErr(validated.error)
    setAddBusy(true)
    setAddErr(null)
    try {
      await onCreateFood(validated.food)
      setAddOpen(false)
      setAddBusy(false)
    } catch (e) {
      setAddBusy(false)
      setAddErr(friendlyError(errMsg(e)))
    }
  }

  /** 查重的提示：擋下是一個淡藍框，提醒是一行小字。 */
  function renderDup(d: DuplicateCheck<Food>) {
    if (d.block) return <div className="dup-block" role="alert"><span>食品庫已有「{foodLabel(d.block)}」</span></div>
    if (d.note) return <p className="dup-note">食品庫已有{d.note.vendor ? ` ${d.note.vendor} 的` : ''}「{d.note.name}」，不同店家照樣可以存</p>
    return null
  }

  const addTitle = addSourceName ? `以「${addSourceName}」為範本新增` : '新增食物'

  /* 新增／範本新增的 sheet，與 LogSheet 同為 SpringSheet（B1b；原為 vaul）。位置與鍵盤處理沿用
     app.css `.sheet` 那段（`--kb`／`--vvtop`）。

     `locked={scanBusy}`：辨識中鎖住關閉。只擋關閉鈕沒用——下滑、Escape、點 scrim 都會關，
     而誤關的代價是那張照片白拍。函式端 45 秒逾時保證最壞情況不會被關太久。 */
  const addSheet = (
    <SpringSheet open={addOpen} onClose={() => setAddOpen(false)} label={addTitle} screen="food-add-sheet" initialFocus={addSheetRef} popupRef={addSheetRef} locked={scanBusy}>
      <SheetGrabZone className="sheet-head">
        <span className="sheet-title">{addTitle}</span>
        <button className="icon-btn" type="button" aria-label="關閉" disabled={scanBusy} onClick={() => setAddOpen(false)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </SheetGrabZone>
      <div className="form-wrap">
        {addSourceName && <p className="note" style={{ marginBottom: 'var(--s-4)' }}>存成一筆新的食物，原先的「{addSourceName}」不會異動。</p>}
        <FoodFormFields
          form={addForm}
          onChange={setAddForm}
          idPrefix="lf-"
          vendorOptions={vendorOptions}
          portalContainer={addSheetRef}
          vendorAutoFocus={!!addSourceName}
          onScan={scanLabel}
          onBusyChange={setScanBusy}
        />
      </div>
      <div className="confirm-wrap">
        {renderDup(addDup)}
        {addErr && <p className="sheet-error" role="alert">{addErr}</p>}
        {/* scanBusy：確認鈕在 fieldset 之外（confirm-wrap 是 form-wrap 的兄弟節點），鎖不到。
            辨識中送出會建立一筆用舊值組出來的食物。 */}
        <button className="pick-bar-btn" type="button" disabled={addBusy || scanBusy || addDup.block !== null} onClick={() => void submitAdd()}>
          {addBusy ? '加入中…' : '加入食品庫'}
        </button>
      </div>
    </SpringSheet>
  )

  const sourceList = tab === 'active' ? foods : archived
  // hiddenIds 只套用在使用中分頁——它是「封存請求送出中」的樂觀隱藏集合，
  // 已封存分頁的清單本來就該看得到剛封存的那筆（precommit-review 抓到：共用同一份
  // hiddenIds 會讓剛封存的食物在「已封存」分頁也消失，5 秒後永遠救不回來）。
  const visible = sourceList
    ?.filter((f) => tab !== 'active' || !hiddenIds.has(f.id))
    .filter((f) => foodMatches(f, query)) ?? null
  const unverifiedOn = unverified && tab === 'active'
  const eatenMap = eaten instanceof Map ? eaten : new Map<number, number>()
  /* 粗估：不分店家，一張卡照「吃最多的在前」排——分組會把排序打散。90 天還在撈時先不出清單（骨架）。 */
  const groups = !visible
    ? null
    : unverifiedOn
      ? eaten === null
        ? null
        : (() => {
            const ranked = rankUnverified(visible, eatenMap)
            return ranked.length ? [{ vendor: '粗估・近 90 天吃最多的在前', items: ranked }] : []
          })()
      : groupByVendor(visible)
  const editorShown = visible?.some((f) => f.id === editingId) ?? false

  return (
    <div className="main" data-screen="food-library" style={{ position: 'relative' }}>
      <SubPageTop title="食品庫管理" backLabel="返回設定" onBack={onBack} />

      <div className="search-wrap">
        <div className="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>
          <input type="text" placeholder="搜尋品名或店家" aria-label="搜尋食品庫" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {/* 這兩顆比 LogSheet 的餐別 chip 更像真的分頁（確實在換清單內容），但同樣不掛
          role="tab"：完整 tablist 要 roving tabindex ＋ 方向鍵 ＋ aria-controls 指向一個
          role="tabpanel" 的容器，為兩顆篩選鈕做半套只會讓讀屏使用者期待方向鍵可用。
          兩顆互斥的篩選開關用 aria-pressed 表達完整且誠實，跟 LogSheet／Today 一致。 */}
      <div className="tabrow" role="group" aria-label="食品庫篩選">
        <button className="chip" type="button" aria-pressed={tab === 'active'} onClick={() => setTab('active')}>使用中</button>
        <button className="chip" type="button" aria-pressed={tab === 'archived'} onClick={() => setTab('archived')}>已封存</button>
        {/* 不是第三個分頁：是使用中分頁上的開關（spec 決定，review B3），所以推到最右、只在使用中出現 */}
        {tab === 'active' && (
          <button className="chip lib-unverified" type="button" aria-pressed={unverified} onClick={() => setUnverified((v) => !v)}>粗估</button>
        )}
      </div>
      {unverifiedOn && eaten === 'error' && <p className="muted lib-unverified-note" role="status">近 90 天的紀錄沒撈到，先照品名排</p>}

      <div className="settings" style={{ paddingTop: 'var(--s-2)', paddingBottom: 96 }}>
        {groups === null ? (
          /* 一張店家卡、五列，列高同真的食物列（類型圖示＋品名＋類型＋熱量） */
          <SkelBlock className="lib-group">
            <div className="lib-group-title"><Skel w="4em" h="10px" /></div>
            <div className="lib-card">
              {['45%', '60%', '38%', '52%', '44%'].map((w, i) => (
                <div key={i} className="lib-row skel-row lib-skel-row">
                  <Skel h="40px" round />
                  <span className="lib-skel-txt"><Skel w={w} /><Skel w="3em" h="10px" /></span>
                  <Skel w="2.4em" />
                </div>
              ))}
            </div>
          </SkelBlock>
        ) : groups.length === 0 && !query.trim() && unverifiedOn ? (
          <p className="muted">沒有粗估的了，每一樣都是官方標示</p>
        ) : groups.length === 0 && !query.trim() && tab === 'active' ? (
          <EmptyNote art="bowl">食品庫還是空的</EmptyNote>
        ) : groups.length === 0 ? (
          <p className="muted">{query.trim() ? `找不到「${query.trim()}」` : '沒有封存的食物'}</p>
        ) : (
          groups.map((g) => (
            <div className="lib-group" key={g.vendor}>
              <div className="lib-group-title">{g.vendor}</div>
              <ul className="lib-card">
                {g.items.map((f) => {
                  const cat = catBusy?.id === f.id ? catBusy.category : categoryOf(f.category)
                  return (
                  <li className="lib-row" key={f.id} data-open={editingId === f.id || undefined}>
                    <div className="lib-row-main">
                      {/* 原生 select 透明疊在類型圖示上當命中區（同每日目標的 .goal-pick），iOS 叫出系統滾輪 */}
                      <label className="lib-cat" data-empty={cat === null || undefined}>
                        <CategoryIcon category={cat} size={40} decorative />
                          <select
                            aria-label={`${f.name} 的類型：${cat ?? '未分類'}`}
                            value={cat ?? ''}
                            onChange={(e) => void setCategory(f, normalizeCategory(e.target.value))}
                          >
                            {cat === null && <option value="" disabled>未分類</option>}
                            <optgroup label="餐點類型">
                              {MEAL_TYPE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </optgroup>
                            <optgroup label="搭配類">
                              {SIDE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </optgroup>
                          </select>
                      </label>
                      {/* 點列＝展開／收起就地編輯（v2.147）。aria-label 沿用「編輯 品名」 */}
                      <button className="lib-row-hit" type="button" aria-label={`編輯 ${f.name}`} aria-expanded={editingId === f.id}
                        onClick={() => (editingId === f.id ? setEditingId(null) : openEdit(f))}>
                        <span className="nm-wrap">
                          <span className="nm">{f.name}</span>
                          <span className="sub">
                            {cat ?? '未分類'}
                            {unverifiedOn && eatenMap.has(f.id) && <> · 近 90 天 {Math.round(eatenMap.get(f.id)!).toLocaleString()} 卡</>}
                            {sourceTag(f.verified) && <span className="src-tag">{sourceTag(f.verified)}</span>}
                          </span>
                        </span>
                        <span className="lib-kcal">{Math.round(f.kcal)}<small> 卡</small></span>
                        {CHEV}
                      </button>
                      {tab === 'archived' && (
                        <button className="icon-btn" type="button" aria-label={`復原 ${f.name}`} onClick={() => void restore(f)}>
                          {RESTORE_ICON}
                        </button>
                      )}
                    </div>
                    {editingId === f.id && (
                      <div className="lib-edit">
                        {/* 就地編輯不在 sheet 裡，portalContainer 留空走預設的 body 即可。
                            idPrefix 與新增 sheet 分開（le- / lf-）：同一頁可能一邊開著編輯、
                            一邊從別列按範本新增，id 撞在一起 label 的 htmlFor 就指錯欄位。 */}
                        <FoodFormFields
                          form={editForm}
                          onChange={setEditForm}
                          idPrefix="le-"
                          vendorOptions={vendorOptions}
                        />
                        {/* 列上收掉的兩個動作（v2.147）：只有使用中的食物能當範本、能封存；已封存的復原鈕留在列上 */}
                        {tab === 'active' && (
                          <div className="lib-edit-more">
                            {/* 用展開區裡正在編的值當範本（按鈕就在那些欄位下面，review）；草稿不合法就用存好的 */}
                            {/* 2026-11-23 樣張 food-edit-actions.html B：藍字改描邊膠囊，跟取消／儲存分得出輕重 */}
                            <button className="row-pill" type="button" aria-label={`以 ${f.name} 為範本新增`} onClick={() => {
                              const draft = validateFoodForm(editForm)
                              openAdd('error' in draft ? f : { ...f, ...draft.food })
                            }}>
                              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
                              以此為範本新增
                            </button>
                            <button className="row-pill" type="button" aria-label={`封存 ${f.name}`} onClick={() => void archive(f)}>
                              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></svg>
                              封存
                            </button>
                          </div>
                        )}
                        {renderDup(editDupOf(f))}
                        <div className="lib-edit-actions">
                          <button className="cancel-btn" type="button" onClick={() => setEditingId(null)}>取消</button>
                          {/* 手機上按下就立刻 disabled 的按鈕，觸控結束事件不會正常送達，
                           *  部分行動瀏覽器會讓按下瞬間的 :active 深色視覺卡住，看起來像
                           *  「一直按著」，直到重新整理才恢復——即使資料其實已經存進去
                           *  （使用者 2026-08-04 真機回報）。點下當下先手動 blur 一次，
                           *  跳過對「disabled 元素還能不能收到後續事件」的依賴。 */}
                          <button className="pick-bar-btn" type="button" disabled={editBusy || editDupOf(f).block !== null} onClick={(e) => { e.currentTarget.blur(); void saveEdit(f.id) }}>
                            {editBusy ? '儲存中…' : '儲存'}
                          </button>
                        </div>
                        {editErr && <p className="sheet-error" role="alert">{editErr}</p>}
                      </div>
                    )}
                    {catErr?.id === f.id && <p className="sheet-error lib-cat-err" role="alert">類型沒有存到：{catErr.msg}</p>}
                  </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
        {/* 食藥署開放資料的出處標示（政府資料開放授權要求）：2026-11-23 來源併成兩種後分不出哪幾筆是匯入的，一律顯示 */}
        {groups !== null && groups.length > 0 && <p className="lib-attrib">官方數字部分取自衛福部食藥署食品營養成分資料庫（政府資料開放授權）</p>}
      </div>

      {/* 編輯中隱藏：FAB 是 fixed 定位，展開的編輯區一長，操作列剛好捲到 FAB 那個
       *  高度時兩者會疊在一起，儲存鈕被蓋住一半（使用者截圖回報）。編輯時本來就用不到
       *  「新增食物」，藏起來比調整捲動位置或搶 z-index 乾淨。看的是編輯區在不在畫面上，
       *  不是 editingId：那一列被搜尋濾掉時連取消鈕都按不到，新增鈕不能跟著消失。 */}
      {/* 復原提示出現時也一起藏（v2.29）：pill 從「封頂半個螢幕」放寬成整行之後，長品名
          會水平覆蓋到右下角的 FAB，而 pill 的 z-index 6 高於 FAB 的 5——那 5 秒內按下去
          會變成誤觸復原。同「編輯中隱藏 FAB」的處理：藏起來比互搶 z-index 或調位置乾淨。 */}
      {!editorShown && !undo && (
        <button className="lib-fab" type="button" aria-label="新增食物" onClick={() => openAdd(null)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}

      {/* `role="status"` ＋ `aria-live="polite"` 掛在**外層**，不能掛在 button 上——
          顯式 role 會**取代**按鈕的隱含 role，讀屏會把它當成一段通知文字，rotor 的按鈕
          清單裡就找不到它了（v2.28 一度寫錯，v2.29 precommit-review 抓到）。這個結構
          與今日頁的 .undo-bar 一致（App.tsx：外層 div 帶 role=status、button 在裡面）。
          品名包一層 .nm：太長時只截品名，「・復原」不能被切掉，那是唯一的動作。 */}
      {undo && (
        <div className="undo-pill-wrap" role="status" aria-live="polite">
          <button
            className="undo-pill"
            type="button"
            aria-label={`復原剛封存的「${undo.food.name}」`}
            onClick={() => void undoArchive()}
          >
            {RESTORE_ICON}
            已封存「<span className="nm">{undo.food.name}</span>」・復原
          </button>
        </div>
      )}

      {addSheet}
    </div>
  )
}
