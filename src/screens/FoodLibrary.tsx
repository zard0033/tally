/* 食品庫管理頁：搜尋／使用中·已封存分頁／店家分組／就地編輯／以現有食物為範本新增／
   封存＋復原／FAB 新增。三顆列操作圖示（編輯／範本新增／封存）不寫字，靠 aria-label。

   封存的「樂觀＋5 秒復原」刻意不比照 App.tsx 的 intake 刪除（那邊延遲真正的 DELETE
   5 秒才送出，因為硬刪除不可逆，要留一個「還沒真的發生」的窗口）。封存是可逆的
   UPDATE（archived 這一欄），復原本身隨時安全，所以這裡改成「立刻送出封存，畫面樂觀
   隱藏該列，5 秒內按復原就再送一次 UPDATE 解封存」——效果一樣是「看起來可以反悔」，
   但不必重建 pendingDelete／計時器／pagehide flush 那整套只有「不可逆」才需要的機制。
   ponytail: 這個決定只在「archived 語意上等於軟刪除、隨時可逆」成立時才安全，
   換成真的 DELETE 就要照抄 App.tsx 那套。 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import FoodFormFields from '@/components/FoodFormFields'
import { listArchivedFoods, type Food, type NewFood } from '@/lib/api'
import { BLANK_FOOD_FORM, foodToForm, validateFoodForm, vendorOptionsOf, type FoodForm } from '@/lib/foodForm'

export interface FoodLibraryProps {
  /** 使用中的食品庫（App 既有 state，已排除封存）。 */
  foods: Food[] | null
  onCreateFood: (food: NewFood) => Promise<Food>
  onUpdateFood: (id: number, patch: Partial<NewFood>) => Promise<void>
  onArchiveFood: (food: Food) => Promise<Food>
  onUnarchiveFood: (food: Food) => Promise<void>
  onBack: () => void
}

type Tab = 'active' | 'archived'

const byName = (a: Food, b: Food) => a.name.localeCompare(b.name, 'zh-Hant')

function foodMatches(f: Food, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return f.name.toLowerCase().includes(s) || (f.vendor ?? '').toLowerCase().includes(s)
}

/** 依店家分組，未標店家的排最後——它不是一個真的店家名，跟著筆畫排序沒有意義。 */
function groupByVendor(foods: Food[]): { vendor: string; items: Food[] }[] {
  const map = new Map<string, Food[]>()
  for (const f of [...foods].sort(byName)) {
    const key = f.vendor ?? '未標店家'
    const list = map.get(key)
    if (list) list.push(f)
    else map.set(key, [f])
  }
  const named = [...map.entries()]
    .filter(([v]) => v !== '未標店家')
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant-u-co-stroke'))
  const rest = map.get('未標店家')
  return [...named, ...(rest ? [['未標店家', rest] as [string, Food[]]] : [])]
    .map(([vendor, items]) => ({ vendor, items }))
}

const EDIT_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
/* 座標比原稿整體位移 (-0.5, +3.5)：原本的筆畫範圍是 x5–20 / y2–15，重心落在 (12.5, 8.5)，
   而 viewBox 中心是 (12, 12)——等於整顆圖示在 44px 觸控盒裡往上偏了 3.5 個單位（17px 渲染
   尺寸下約 2.5px），跟左右兩顆並排時看起來就是沒對齊（使用者真機回報，量 getBBox 確認）。
   相對指令（a／h／v）不受位移影響，只有起點 M 與絕對的 V 要跟著改。 */
const TEMPLATE_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="7.5" width="11" height="11" rx="2" /><path d="M8.5 7.5V6.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-1" /></svg>
const ARCHIVE_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="4" rx="1" /><path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></svg>
const RESTORE_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>

export default function FoodLibrary(props: FoodLibraryProps) {
  const { foods, onCreateFood, onUpdateFood, onArchiveFood, onUnarchiveFood, onBack } = props

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
  const addSheetRef = useRef<HTMLDivElement | null>(null)
  const [addForm, setAddForm] = useState<FoodForm>(BLANK_FOOD_FORM)
  const [addSourceName, setAddSourceName] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  const [undo, setUndo] = useState<{ food: Food } | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  useEffect(() => {
    if (tab !== 'archived' || archivedFetchedRef.current) return
    archivedFetchedRef.current = true
    void listArchivedFoods().then(setArchived).catch(() => setArchived([]))
  }, [tab])

  function openEdit(f: Food) {
    setEditingId(f.id)
    setEditForm(foodToForm(f))
    setEditErr(null)
  }

  async function saveEdit(id: number) {
    if (editBusy) return
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
      setEditErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function archive(f: Food) {
    setHiddenIds((prev) => new Set(prev).add(f.id))
    window.clearTimeout(undoTimer.current)
    try {
      const archivedFood = await onArchiveFood(f)
      setArchived((prev) => (prev ? [archivedFood, ...prev] : prev))
      setUndo({ food: archivedFood })
      undoTimer.current = window.setTimeout(() => setUndo(null), 5000)
    } catch {
      setHiddenIds((prev) => {
        const next = new Set(prev)
        next.delete(f.id)
        return next
      })
    }
  }

  async function undoArchive() {
    const p = undo
    if (!p) return
    setUndo(null)
    window.clearTimeout(undoTimer.current)
    setHiddenIds((prev) => {
      const next = new Set(prev)
      next.delete(p.food.id)
      return next
    })
    setArchived((prev) => prev?.filter((f) => f.id !== p.food.id) ?? prev)
    try {
      await onUnarchiveFood(p.food)
    } catch {
      setHiddenIds((prev) => new Set(prev).add(p.food.id))
      setArchived((prev) => (prev ? [p.food, ...prev] : prev))
    }
  }

  async function restore(f: Food) {
    setArchived((prev) => prev?.filter((x) => x.id !== f.id) ?? prev)
    try {
      await onUnarchiveFood(f)
    } catch {
      setArchived((prev) => (prev ? [f, ...prev] : prev))
    }
  }

  /* v2.29 之前食品庫的店家是純 text input，沒有自動完成——同一件事從「記一筆」進去能搜、
     從這裡進去不能，是能力差異不是風格差異，一併補上。去重排序的規則走 lib 的共用函式，
     不在這裡再寫一份（precommit-review 抓到過一次）。 */
  const vendorOptions = useMemo(() => vendorOptionsOf(foods), [foods])

  function openAdd(prefill: Food | null) {
    setAddForm(prefill ? foodToForm(prefill) : BLANK_FOOD_FORM)
    setAddSourceName(prefill ? prefill.name : null)
    setAddErr(null)
    setAddOpen(true)
  }

  async function submitAdd() {
    if (addBusy) return
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
      setAddErr(e instanceof Error ? e.message : String(e))
    }
  }

  const addTitle = addSourceName ? `以「${addSourceName}」為範本新增` : '新增食物'

  /* 新增／範本新增的 sheet。走 vaul 跟 LogSheet 同一套，不複製 Settings 那份手刻的
     scrim/animation 樣板——手刻那份的存在理由是 legacy 的 `#sheet-root` id 衝突，
     在 vaul 下不成立，而 vaul 順帶給了拖曳關閉與 Drawer.Content 這個 portal 容器。

     `repositionInputs={false}`：理由同 LogSheet，全文在 app.css `.sheet` 那段。 */
  const addSheet = (
    <Drawer.Root open={addOpen} onOpenChange={(v) => { if (!v) setAddOpen(false) }} direction="bottom" shouldScaleBackground={false} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="scrim" />
        <Drawer.Content ref={addSheetRef} className="sheet" aria-label={addTitle} data-screen="food-add-sheet">
          <Drawer.Handle className="handle" />
          <div className="sheet-head">
            <span className="sheet-title">{addTitle}</span>
            <button className="icon-btn" type="button" aria-label="關閉" onClick={() => setAddOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="form-wrap">
            {addSourceName && <p className="note" style={{ marginBottom: 'var(--s-4)' }}>存成一筆新的食物，原先的「{addSourceName}」不會異動。</p>}
            {/* portalContainer 必傳：vaul 的 Drawer 會把 body 設成 pointer-events:none，
                店家下拉掛在預設的 body 下就會看得到、點不到（見元件檔頭）。 */}
            <FoodFormFields
              form={addForm}
              onChange={setAddForm}
              idPrefix="lf-"
              vendorOptions={vendorOptions}
              portalContainer={addSheetRef}
              vendorAutoFocus={!!addSourceName}
            />
          </div>
          <div className="confirm-wrap">
            {addErr && <p className="sheet-error" role="alert">{addErr}</p>}
            <button className="pick-bar-btn" type="button" disabled={addBusy} onClick={() => void submitAdd()}>
              {addBusy ? '加入中…' : '加入食品庫'}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )

  const sourceList = tab === 'active' ? foods : archived
  // hiddenIds 只套用在使用中分頁——它是「封存中，正在等 5 秒 undo」的樂觀隱藏集合，
  // 已封存分頁的清單本來就該看得到剛封存的那筆（precommit-review 抓到：共用同一份
  // hiddenIds 會讓剛封存的食物在「已封存」分頁也消失，5 秒後永遠救不回來）。
  const visible = sourceList
    ?.filter((f) => tab !== 'active' || !hiddenIds.has(f.id))
    .filter((f) => foodMatches(f, query)) ?? null
  const groups = visible ? groupByVendor(visible) : null

  return (
    <div className="main" data-screen="food-library" style={{ position: 'relative' }}>
      <div className="lib-topbar">
        <button className="icon-btn" type="button" aria-label="返回設定" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1>食品庫管理</h1>
      </div>

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
      </div>

      <div className="settings" style={{ paddingTop: 'var(--s-2)', paddingBottom: 96 }}>
        {groups === null ? (
          <p className="muted">載入中…</p>
        ) : groups.length === 0 ? (
          <p className="muted">{query.trim() ? `找不到「${query.trim()}」` : tab === 'active' ? '食品庫還是空的' : '沒有封存的食物'}</p>
        ) : (
          groups.map((g) => (
            <div className="lib-group" key={g.vendor}>
              <div className="lib-group-title">{g.vendor}</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {g.items.map((f) => (
                  <li className="lib-row" key={f.id}>
                    <div className="lib-row-main">
                      <div className="nm-wrap"><span className="nm">{f.name}</span></div>
                      <button className="icon-btn" type="button" aria-label={`編輯 ${f.name}`} onClick={() => (editingId === f.id ? setEditingId(null) : openEdit(f))}>
                        {EDIT_ICON}
                      </button>
                      {tab === 'active' ? (
                        <>
                          <button className="icon-btn" type="button" aria-label={`以 ${f.name} 為範本新增`} onClick={() => openAdd(f)}>
                            {TEMPLATE_ICON}
                          </button>
                          <button className="icon-btn" type="button" aria-label={`封存 ${f.name}`} onClick={() => void archive(f)}>
                            {ARCHIVE_ICON}
                          </button>
                        </>
                      ) : (
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
                        <div className="lib-edit-actions">
                          <button className="cancel-btn" type="button" onClick={() => setEditingId(null)}>取消</button>
                          {/* 手機上按下就立刻 disabled 的按鈕，觸控結束事件不會正常送達，
                           *  部分行動瀏覽器會讓按下瞬間的 :active 深色視覺卡住，看起來像
                           *  「一直按著」，直到重新整理才恢復——即使資料其實已經存進去
                           *  （使用者 2026-08-04 真機回報）。點下當下先手動 blur 一次，
                           *  跳過對「disabled 元素還能不能收到後續事件」的依賴。 */}
                          <button className="pick-bar-btn" type="button" disabled={editBusy} onClick={(e) => { e.currentTarget.blur(); void saveEdit(f.id) }}>
                            {editBusy ? '儲存中…' : '儲存'}
                          </button>
                        </div>
                        {editErr && <p className="sheet-error" role="alert">{editErr}</p>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* 編輯中隱藏：FAB 是 fixed 定位，展開的編輯區一長，操作列剛好捲到 FAB 那個
       *  高度時兩者會疊在一起，儲存鈕被蓋住一半（使用者截圖回報）。編輯時本來就用不到
       *  「新增食物」，藏起來比調整捲動位置或搶 z-index 乾淨。 */}
      {/* 復原提示出現時也一起藏（v2.29）：pill 從「封頂半個螢幕」放寬成整行之後，長品名
          會水平覆蓋到右下角的 FAB，而 pill 的 z-index 6 高於 FAB 的 5——那 5 秒內按下去
          會變成誤觸復原。同「編輯中隱藏 FAB」的處理：藏起來比互搶 z-index 或調位置乾淨。 */}
      {editingId === null && !undo && (
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
