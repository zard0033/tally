/* 左滑露出刪除鈕的放手判定（飲食列與訓練組列共用；禁沾 DOM）。兩邊的手勢規則不該分岔，
   開啟時停的位置（REVEAL）因版面不同才各自定義。 */

/** 放手時位移超過它就吸附開啟（拖不到一半視為反悔）。 */
const OPEN_AT = 24
/** 甩一下就開：速度夠快時不要求拖滿距離，否則短促的手勢會被判成反悔。 */
const FLING_VELOCITY = 320
const MAX_RELEASE_VELOCITY = 1500
/** 拖曳結束後這段時間內的 click 都當成「瀏覽器補的那一下」吃掉。 */
export const CLICK_GRACE_MS = 150

/** 放手速度交棒給吸附 spring 前先夾上限（px/s）。 */
export const clampReleaseVelocity = (velocity: number): number =>
  Math.max(-MAX_RELEASE_VELOCITY, Math.min(MAX_RELEASE_VELOCITY, velocity))

/** moved 是列實際的位移，不是指標的原始位移。速度也要配 moved < 0 把關：縱向甩動時的
 *  velocity 雜訊不該被判成開啟。 */
export const shouldOpenSwipe = (moved: number, velocity: number): boolean =>
  moved < -OPEN_AT || (velocity < -FLING_VELOCITY && moved < 0)
