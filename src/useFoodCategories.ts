import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyFoods, listUncategorizedFoods, setFoodsCategory, type Food } from '@/lib/api'
import type { FoodCategory } from '@/lib/categories'

/** 一次送幾樣給分類模式（函式那端上限 50）。原本 40，qwen 一批要想超過 45 秒、函式逾時（2026-11-11 線上 log）；
 *  逾時不會觸發模型備援，只能把批次切小。15 是假設（思考時間不一定跟樣數成正比），用 `200 classify ok` 的 ms 驗。
 *  食品庫一百多樣時分八趟左右。 */
export const CLASSIFY_BATCH = 15

type FoodRef = Pick<Food, 'id' | 'name' | 'vendor'>

/** 食物類型的背景補判（spec.md C 節「第三版」）。食品庫到齊（＝連得上）之後跑一次：撈 `category is null`
 *  且沒手動改過的食物（含封存的），分批送分類、寫回；失敗或離線就留 null，下次開 app 再補。
 *  新增的食物存完由 classifyNew 補一次——存檔本身從不等它。
 *
 *  overrides：這次 session 補上或手動改的類型。今日頁的當日清單與回看資料是之前撈的，join 出來的
 *  category 還是舊的，App 用它蓋上去（withCategories），建議不必等重撈。
 *  onApplied：寫進資料庫成功的那幾筆，App 拿去更新 foods state（食品庫的標籤）。 */
export function useFoodCategories(
  userId: string | null,
  ready: boolean,
  onApplied: (cats: ReadonlyMap<number, FoodCategory>) => void,
) {
  const [overrides, setOverrides] = useState<ReadonlyMap<number, FoodCategory>>(() => new Map())
  /* 這次 session 手動改過的：補判回來時不採用（資料庫那端的 update 條件已經擋掉，這裡擋畫面）。 */
  const manualRef = useRef<Set<number>>(new Set())
  const ranForRef = useRef<string | null>(null)
  /* 登出就 +1：還在飛的那一批回來時丟棄，不寫到下一個帳號的畫面上。 */
  const epochRef = useRef(0)
  const onAppliedRef = useRef(onApplied)
  useEffect(() => {
    onAppliedRef.current = onApplied
  }, [onApplied])

  /* epoch 由呼叫端在發出第一個請求前取：撈清單還在飛時登出，回來也不能採用。 */
  const classify = useCallback(async (list: FoodRef[], epoch: number) => {
    for (let i = 0; i < list.length; i += CLASSIFY_BATCH) {
      let results: Awaited<ReturnType<typeof classifyFoods>>
      try {
        results = await classifyFoods(list.slice(i, i + CLASSIFY_BATCH))
      } catch (e) {
        // 一批失敗不擋後面的批次；留 null 等下次開 app。印出來，欄位改名或函式壞掉時才查得到
        console.warn('[分類] 一批失敗，下次開 app 再補', e)
        continue
      }
      if (epoch !== epochRef.current) return
      const byCategory = new Map<FoodCategory, number[]>()
      for (const r of results) {
        if (!manualRef.current.has(r.id)) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r.id])
      }
      // 一個類型一次寫；每寫成一批就先採用，後面那批失敗也不會連前面的一起丟掉
      for (const [category, ids] of byCategory) {
        const written = await setFoodsCategory(ids, category)
        if (epoch !== epochRef.current) return
        const applied = new Map(written.filter((id) => !manualRef.current.has(id)).map((id) => [id, category]))
        if (applied.size === 0) continue
        setOverrides((prev) => new Map([...prev, ...applied]))
        onAppliedRef.current(applied)
      }
    }
  }, [])

  useEffect(() => {
    if (!userId || !ready || ranForRef.current === userId) return
    ranForRef.current = userId
    const epoch = epochRef.current
    // 失敗＝這次沒有類型，下次開 app 再補（spec）；不打擾使用者，只留一行給除錯
    listUncategorizedFoods()
      .then((list) => classify(list, epoch))
      .catch((e) => console.warn('[分類] 補判失敗，下次開 app 再補', e))
  }, [userId, ready, classify])

  /** 新增的食物存完之後補判一次；失敗同上，留給下次開 app。 */
  const classifyNew = useCallback(
    (food: Food) => {
      if (food.category !== null || food.category_manual) return
      classify([food], epochRef.current).catch((e) => console.warn('[分類] 新食物補判失敗，下次開 app 再補', e))
    },
    [classify],
  )

  /** 食品庫手動改了類型（已寫入成功）：之後的補判不再覆蓋它。 */
  const markManual = useCallback((id: number, category: FoodCategory) => {
    manualRef.current.add(id)
    setOverrides((prev) => new Map(prev).set(id, category))
  }, [])

  /** 登出：上一個帳號的覆寫與還在飛的補判都不採用，下一次登入重跑。 */
  const reset = useCallback(() => {
    epochRef.current += 1
    ranForRef.current = null
    manualRef.current.clear()
    setOverrides(new Map())
  }, [])

  return { overrides, classifyNew, markManual, reset }
}
