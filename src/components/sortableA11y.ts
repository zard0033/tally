/* 拖曳排序的讀屏設定（課表編輯頁與訓練中共用）：朗讀改成中文；dnd-kit 預設是英文且念 id，我們的 id 是 uuid，聽不懂。
   每個可排序項目要在 `useSortable({ data: { name } })` 帶名稱。 */
import { Accessibility } from '@dnd-kit/dom'

const nameOf = (source: { data?: Record<string, unknown> } | null | undefined) => String(source?.data?.name ?? '動作')

type Announcements = NonNullable<NonNullable<ConstructorParameters<typeof Accessibility>[1]>['announcements']>

const announcements: Announcements = {
  dragstart: ({ operation: { source } }) => (source ? `拿起${nameOf(source)}` : undefined),
  // source 與 target 同一個＝移動後它成了自己的碰撞目標，念出來是「X移到X的位置」，函式庫預設也不念
  dragover: ({ operation: { source, target } }) =>
    source && target && source.id !== target.id ? `${nameOf(source)}移到${nameOf(target)}的位置` : undefined,
  dragend: ({ operation: { source }, canceled }) =>
    source ? (canceled ? `取消，${nameOf(source)}回到原位` : `放下${nameOf(source)}`) : undefined,
}

export const sortableAccessibility = Accessibility.configure({
  announcements,
  screenReaderInstructions: {
    draggable: '按空白鍵或 Enter 拿起這個動作，用上下方向鍵移動，再按空白鍵放下，按 Esc 取消。',
  },
})
