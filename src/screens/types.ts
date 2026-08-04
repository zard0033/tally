/* 三個畫面（Today／LogSheet／Settings）的 props 契約。
   原則：資料讀取與 mutation 全部下沉到 App.tsx（呼叫 src/lib/api.ts），
   screens 純呈現＋互動——改資料流只動這個檔案與 App.tsx，screens 本身不必跟著改，
   後續各 screen 的實作 agent 也因此不需要碰共用檔。

   本檔只定義「跨畫面共用」的形狀；畫面自己內部才需要的本地 UI state
   （例如 LogSheet 的搜尋字、已選清單、qty 輸入草稿）不在這裡，那是各 screen 自己的事。 */

import type { Food, IntakeRow, NewFood, NewIntake, NewWeight, ProfileRow, Weight } from '@/lib/api'
import type { Targets } from '@/lib/formulas'
import type { MealKey } from '@/lib/meals'

/**
 * 目前檢視日期的 intake 快照。
 * rows 為 null＝「還沒讀到」（載入中，畫面該顯示「載入中…」而不是空清單或 0）；
 * []＝「讀到了，但這天什麼都沒記」。這個三態區分是 DESIGN.md「載入態」那條規則的核心，
 * 不能用 rows.length === 0 去合併判斷。
 */
export interface DayData {
  date: string
  rows: IntakeRow[] | null
}

export interface TodayProps {
  dayData: DayData
  profile: ProfileRow
  targets: Targets
  currentDate: string
  /** 前一天／後一天；App 內部已擋看未來與非法日期，Today 只管呼叫。 */
  onShiftDate: (days: number) => void
  /** 原生 input[type=date] 直接跳到某天，同樣的擋法在 App 裡做一次。 */
  onGoToDate: (iso: string) => void
  /** 開記一筆 sheet；CTA 沒有預設餐別時由 Today 自己呼叫 lib/meals 的 defaultMeal() 決定。 */
  onOpenSheet: (meal: MealKey) => void
  /** 刪除單筆 intake；失敗會由 App 轉成全域 Notice 畫面（跟 legacy 的 deleteIntake 一致），
   *  Today 只需要在按下時給出當下的 loading／disabled 回饋。 */
  onDeleteIntake: (id: number) => void
  /** 剛加入成功的 intake id，用來做「短暫高亮後淡出」；App 會在約 1.3s 後自動清空這個集合。 */
  justAddedIds: ReadonlySet<number>
  /** 改單筆份量（點按品項展開的就地編輯區用）。失敗 rejects，Today 自己接住顯示「存不進去：」，
   *  跟 LogSheet 的 onCreateIntake／onCreateFood 是同一套失敗處理慣例。 */
  onUpdateIntakeQty: (id: number, qty: number) => Promise<void>
  /** 改單筆餐別，同一個編輯區的第二排。失敗處理同 onUpdateIntakeQty。 */
  onUpdateIntakeMeal: (id: number, meal: MealKey) => Promise<void>
}

export interface LogSheetProps {
  open: boolean
  /** 目前選中的餐別 chip；null 代表尚未決定（理論上 open=false 時才會是 null）。 */
  meal: MealKey | null
  /** 食品庫；null＝還沒載完（App 開機時與 profile／weight 一起撈，理由見 App.tsx 內註記）。 */
  foods: Food[] | null
  dayData: DayData
  targets: Targets
  onClose: () => void
  /**
   * 送出「加入」——rows 已經是組好的完整 NewIntake（含 eaten_on／meal／營養快照)，
   * LogSheet 自己從 foods 查表組出來，App 只管持久化＋重新載入當天＋標記剛加入的 id。
   * 失敗時 rejects，由 LogSheet 自己接住顯示「存不進去：」＋不清空已選＋按鈕變重試
   * （跟 legacy withBusy 的行為一致，這類寫入失敗不是全域 Notice）。
   */
  onCreateIntake: (rows: NewIntake[]) => Promise<void>
  /** 新增食物到食品庫；成功回傳新列（含 id），LogSheet 自己決定要不要把它選起來。 */
  onCreateFood: (food: NewFood) => Promise<Food>
}

export interface SettingsProps {
  profile: ProfileRow
  targets: Targets
  latestWeight: Weight
  /** 使用中的食品庫（已排除封存），與 LogSheet 共用同一份 App state——食品庫管理頁的
   *  「使用中」分頁直接拿這份，不必自己重撈一次。 */
  foods: Food[] | null
  /** 儲存身體參數編輯（含自訂目標覆寫）。失敗 rejects，Settings 自己接住顯示錯誤。 */
  onSaveProfile: (patch: Partial<ProfileRow>) => Promise<void>
  /**
   * 記體重／體脂率（「更新身體數據」入口）。user_id 由 App 補上，
   * 同一天再記是覆蓋，語意交給 lib/api.ts 的 upsertWeight（on_conflict 已處理）。
   */
  onSaveWeight: (weight: Omit<NewWeight, 'user_id'>) => Promise<void>
  /** 新增食物到食品庫（食品庫管理頁的 FAB／範本新增共用，跟 LogSheet 同一支）。 */
  onCreateFood: (food: NewFood) => Promise<Food>
  /** 就地編輯食物的品名／店家／營養值，不動 archived。 */
  onUpdateFood: (id: number, patch: Partial<NewFood>) => Promise<void>
  /** 封存（軟刪除）。呼叫端傳完整 Food 物件（清單上本來就握著），回傳封存後的完整列
   *  供「復原」不必重撈就能插回畫面。 */
  onArchiveFood: (food: Food) => Promise<Food>
  /** 復原：把整筆連同 id 一起送回去解封存，App 的使用中清單同步插回並排序。 */
  onUnarchiveFood: (food: Food) => Promise<void>
  onSignOut: () => void
  /** 進入／離開次級頁面（每日目標／食品庫管理／體重趨勢）時回報，App 據此隱藏底部
   *  navbar——這幾頁自己有返回鍵，主導覽同時存在會讓使用者以為還在設定頁根層。 */
  onSubViewChange: (isSubView: boolean) => void
}
