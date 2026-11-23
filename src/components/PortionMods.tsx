/* 份量微調（spec「份量微調」，樣張 _design-sample/portion-mods.html B，使用者 2026-11-23 選）：
   列下面一行主色字寫「現在的狀態」（沒調過也寫：大杯・無糖／正常飯量），點了在下面展開控件；
   展開後最下面一行算式。記一筆的「已選」與今日頁就地編輯共用這一份。
   狀態（按了哪些、開著沒）留在呼叫端；這裡只畫、只回報。 */
import { useId } from 'react'
import SegmentedControl from '@/components/SegmentedControl'
import { calcLineOf, groupsFor, optionsOf, summaryOf, toggleMod, type Macros, type ModTarget } from '@/lib/portionMods'

interface PortionModsProps {
  target: ModTarget
  /** 食品庫那一筆的單份基準值 */
  base: Macros
  mods: readonly string[]
  open: boolean
  onToggleOpen: () => void
  onChange: (mods: string[]) => void
  /** 預設帶的是「這樣食物上一筆按的」 */
  fromLast?: boolean
  disabled?: boolean
  /** 展開後算式上面的一句說明（今日頁：用食品庫現在的數字重算） */
  note?: string
}

/** 單選組的「沒按」那一格：用一個不在代碼表裡的 key，SegmentedControl 才有東西可以按下。 */
const NONE = 'none'

const SINGLE_DEFAULT: Record<string, string> = { cup: '大杯', sweet: '無糖', rice: '正常', noodle: '正常', skin: '帶皮' }
const GROUP_LABEL: Record<string, string> = { cup: '杯型', sweet: '甜度', top: '加配料', rice: '飯量', noodle: '麵量', skin: '雞皮' }
/** 甜度六格放得下：選項字縮成一個字（「微糖」→「微」）。 */
const short = (group: string, label: string) => (group === 'sweet' ? label.replace('糖', '') : label)

export default function PortionMods({ target, base, mods, open, onToggleOpen, onChange, fromLast, disabled, note }: PortionModsProps) {
  const panelId = useId()
  const groups = groupsFor(target)
  if (!groups.length) return null
  const summary = summaryOf(mods, target)
  const calc = calcLineOf(base, mods, target)
  return (
    <div className="pmods">
      <button
        className="pmods-sum"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${target.name} 份量微調：${summary}${fromLast ? '，照上次' : ''}`}
        disabled={disabled}
        onClick={onToggleOpen}
      >
        <span>{summary}</span>
        {fromLast && <span className="pmods-last">· 照上次</span>}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="pmods-panel" id={panelId}>
          {groups.map((g) => {
            const opts = optionsOf(g)
            if (g === 'top') {
              return (
                <div key={g} className="pmods-grp">
                  <p className="pmods-lbl" aria-hidden="true">{GROUP_LABEL[g]}</p>
                  <div className="pmods-chips" role="group" aria-label={`${GROUP_LABEL[g]}，${target.name}`}>
                    {opts.map((o) => (
                      <button
                        key={o.code}
                        className="pmods-chip"
                        type="button"
                        aria-pressed={mods.includes(o.code)}
                        disabled={disabled}
                        onClick={() => onChange(toggleMod(mods, o.code, target))}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            }
            const picked = opts.find((o) => mods.includes(o.code))?.code ?? NONE
            const items = [{ key: NONE, label: SINGLE_DEFAULT[g] }, ...opts.map((o) => ({ key: o.code, label: short(g, o.label) }))]
            return (
              <div key={g} className="pmods-grp">
                <p className="pmods-lbl" aria-hidden="true">{GROUP_LABEL[g]}</p>
                <SegmentedControl
                  label={`${GROUP_LABEL[g]}，${target.name}`}
                  items={items}
                  value={picked}
                  onPick={(k) => {
                    if (disabled || k === picked) return
                    onChange(k === NONE ? mods.filter((c) => !opts.some((o) => o.code === c)) : toggleMod(mods, k, target))
                  }}
                />
              </div>
            )
          })}
          {note && <p className="pmods-calc">{note}</p>}
          {calc && <p className="pmods-calc">{calc}</p>}
        </div>
      )}
    </div>
  )
}
