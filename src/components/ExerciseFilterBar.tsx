/* 動作的搜尋框＋肌群橫條。動作庫頁與「加動作」sheet 是同一組欄位、同一個互動（樣張 ⑦a：
   「加動作用同一個畫面」），所以放在這裡共用，兩邊才不會分岔。
   搜尋框字級 16px（iOS 聚焦 <16px 會 zoom，DESIGN「表單控件字級下限」）。 */
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABEL, type ExerciseFilter } from '@/lib/training'

interface ExerciseFilterBarProps {
  value: ExerciseFilter
  onChange: (next: ExerciseFilter) => void
}

export default function ExerciseFilterBar({ value, onChange }: ExerciseFilterBarProps) {
  return (
    <>
      <label className="tr-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4.5-4.5" />
        </svg>
        <input
          type="search"
          value={value.q}
          placeholder="搜尋動作"
          aria-label="搜尋動作"
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
      </label>
      <div className="chiprow tr-filter" role="group" aria-label="肌群">
        {(['all', ...MUSCLE_GROUPS] as const).map((g) => (
          <button
            key={g}
            className="chip"
            type="button"
            aria-pressed={value.group === g}
            onClick={() => onChange({ ...value, group: g })}
          >
            {g === 'all' ? '全部' : MUSCLE_GROUP_LABEL[g]}
          </button>
        ))}
      </div>
    </>
  )
}
