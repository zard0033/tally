import { describe, expect, it } from 'vitest'
import { emptyTrainingDb, routineList, type Row, type TrainingDb, type TrainingTable } from './training'
import {
  dayTraining,
  exerciseBests,
  liveWorkout,
  routineStartNotes,
  sessionRecords,
  todayFocus,
  suggestRoutine,
  trainedGroups,
  weekOrdinal,
  workoutHighlights,
} from './trainingHome'

const db = (p: Partial<Record<TrainingTable, readonly Row[]>> = {}): TrainingDb => ({ ...emptyTrainingDb(), ...p })
// 本地時間建構，避開時區：2026-11-23 是週一
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m)
const iso = (d: number, h: number, m = 0) => at(d, h, m).toISOString()
const NOW = at(23, 18)

const ex = (id: string, name: string, muscle_group: string, kind?: string): Row => ({ id, name, muscle_group, ...(kind ? { kind } : {}) })
const BENCH = ex('e-bench', '槓鈴臥推', 'chest')
const ROW = ex('e-row', '滑輪下拉', 'back')
const LEG = ex('e-leg', '腿推舉', 'legs')
const RUN = ex('e-run', '跑步機', 'other', 'treadmill')

const workout = (id: string, day: number, startH: number, ended: boolean, routine_id: string | null = null): Row => ({
  id,
  performed_on: `2026-11-${String(day).padStart(2, '0')}`,
  started_at: iso(day, startH),
  ended_at: ended ? iso(day, startH + 1) : null,
  routine_id,
})
const entry = (id: string, workout_id: string, exercise_id: string, position = 0): Row => ({ id, workout_id, exercise_id, position })
const set = (id: string, we: string, weight_kg: number, reps: number, done = true, rpe: number | null = null): Row => ({
  id,
  workout_exercise_id: we,
  set_no: 1,
  weight_kg,
  reps,
  done,
  rpe,
})

describe('liveWorkout／dayTraining', () => {
  it('今天開始、沒結束＝即時進行中；天空那一行是 live', () => {
    const d = db({ workouts: [workout('w1', 23, 17, false)] })
    expect(liveWorkout(d, '2026-11-23')?.id).toBe('w1')
    expect(dayTraining(d, '2026-11-23', NOW)).toEqual({ kind: 'live', workoutId: 'w1', startedAt: iso(23, 17) })
  })

  it('補記（過去日、起點 12:00）沒結束不算即時，天空那一行是 done 但時長不算它', () => {
    const backfill: Row = { id: 'w1', performed_on: '2026-11-20', started_at: iso(20, 12), ended_at: null, routine_id: null }
    const d = db({ workouts: [backfill], exercises: [BENCH], workout_exercises: [entry('we1', 'w1', 'e-bench')], workout_sets: [set('s1', 'we1', 60, 10)] })
    expect(liveWorkout(d, '2026-11-23')).toBeNull()
    // 60×10＝600；補記中的那次時長不算
    expect(dayTraining(d, '2026-11-20', NOW)).toEqual({ kind: 'done', volume: 600, minutes: 0, doneSets: 1, count: 1 })
  })

  it('一天兩次已結束：重量、組數、時長加總', () => {
    const d = db({
      workouts: [workout('w1', 23, 8, true), workout('w2', 23, 14, true)],
      exercises: [BENCH],
      workout_exercises: [entry('we1', 'w1', 'e-bench'), entry('we2', 'w2', 'e-bench')],
      workout_sets: [set('s1', 'we1', 62.5, 8), set('s2', 'we2', 60, 10), set('s3', 'we2', 60, 10, false)],
    })
    // 62.5×8＝500、60×10＝600；各 60 分
    expect(dayTraining(d, '2026-11-23', NOW)).toEqual({ kind: 'done', volume: 1100, minutes: 120, doneSets: 2, count: 2 })
  })

  it('沒紀錄：今天是 idle-today，其他日子 idle-other', () => {
    expect(dayTraining(db(), '2026-11-23', NOW)).toEqual({ kind: 'idle-today' })
    expect(dayTraining(db(), '2026-11-22', NOW)).toEqual({ kind: 'idle-other' })
  })
})

describe('todayFocus（今天沒練時天空那一行）', () => {
  it('從沒練過任何肌群 → null', () => {
    expect(todayFocus(db(), NOW)).toBeNull()
  })

  it('已恢復的依最久沒練排、從沒練過的不列；恢復中的寫剩幾天（小時進位）', () => {
    // 胸：今天 8–9 點練 1 組 → 窗口 24 小時，18 點時還剩 15 小時 → 1 天
    // 腿：11/21 8–9 點 → 48 小時，11/23 9 點已恢復；背：11/19 → 已恢復，比腿更久沒練排前面
    const d = db({
      exercises: [BENCH, ROW, LEG],
      workouts: [workout('a', 23, 8, true), workout('b', 21, 8, true), workout('c', 19, 8, true)],
      workout_exercises: [entry('x', 'a', 'e-bench'), entry('y', 'b', 'e-leg'), entry('z', 'c', 'e-row')],
      workout_sets: [set('1', 'x', 60, 8), set('2', 'y', 100, 10), set('3', 'z', 45, 10)],
    })
    expect(todayFocus(d, NOW)).toEqual({ ready: ['背部', '下半身'], recovering: [{ label: '胸部', days: 1 }] })
  })
})

describe('suggestRoutine', () => {
  const routines = [
    { id: 'r-push', name: '推日', archived: false, created_at: '2026-10-01T00:00:00Z' },
    { id: 'r-pull', name: '拉日', archived: false, created_at: '2026-10-02T00:00:00Z' },
    { id: 'r-leg', name: '腿日', archived: false, created_at: '2026-10-03T00:00:00Z' },
  ]
  const routine_exercises = [
    { id: 're1', routine_id: 'r-push', exercise_id: 'e-bench', position: 0 },
    { id: 're2', routine_id: 'r-pull', exercise_id: 'e-row', position: 0 },
    { id: 're3', routine_id: 'r-leg', exercise_id: 'e-leg', position: 0 },
  ]

  it('沒課表 → null', () => {
    expect(suggestRoutine(db(), [], NOW)).toBeNull()
  })

  it('都沒做過：取建立最早的那份', () => {
    const d = db({ routines, routine_exercises, exercises: [BENCH, ROW, LEG] })
    expect(suggestRoutine(d, routineList(d).active, NOW)?.card.routine.id).toBe('r-push')
  })

  it('肌群還在恢復的課表跳過，挑恢復好的裡最久沒做的', () => {
    // 推日今天早上練過（胸恢復中）；腿日 11/21 做過、腿 48 小時→ 11/23 18:00 已過 48 小時以上；拉日 11/19 做過
    const d = db({
      routines,
      routine_exercises,
      exercises: [BENCH, ROW, LEG],
      workouts: [workout('w-push', 23, 8, true, 'r-push'), workout('w-leg', 21, 8, true, 'r-leg'), workout('w-pull', 19, 8, true, 'r-pull')],
      workout_exercises: [entry('a', 'w-push', 'e-bench'), entry('b', 'w-leg', 'e-leg'), entry('c', 'w-pull', 'e-row')],
      workout_sets: [set('s1', 'a', 60, 8), set('s2', 'b', 120, 10), set('s3', 'c', 45, 10)],
    })
    expect(suggestRoutine(d, routineList(d).active, NOW)).toMatchObject({ card: { routine: { id: 'r-pull' } }, ready: true })
  })

  it('routineStartNotes：恢復好的寫肌群＋上次；還在恢復的寫還要幾天', () => {
    const d = db({
      routines,
      routine_exercises,
      exercises: [BENCH, ROW, LEG],
      workouts: [workout('w-push', 23, 8, true, 'r-push'), workout('w-pull', 19, 8, true, 'r-pull')],
      workout_exercises: [entry('a', 'w-push', 'e-bench'), entry('c', 'w-pull', 'e-row')],
      workout_sets: [set('s1', 'a', 60, 8), set('s3', 'c', 45, 10)],
    })
    const notes = routineStartNotes(d, routineList(d).active, NOW)
    expect(notes.get('r-push')).toBe('胸部還要約 1 天 · 上次 11/23')
    expect(notes.get('r-pull')).toBe('背部 · 上次 11/19')
    expect(notes.get('r-leg')).toBe('下半身')
  })

  it('全部都還在恢復：挑最久沒做的，ready＝false', () => {
    const d = db({
      routines: routines.slice(0, 2),
      routine_exercises: routine_exercises.slice(0, 2),
      exercises: [BENCH, ROW],
      workouts: [workout('w-push', 23, 8, true, 'r-push'), workout('w-pull', 23, 10, true, 'r-pull')],
      workout_exercises: [entry('a', 'w-push', 'e-bench'), entry('c', 'w-pull', 'e-row')],
      workout_sets: [set('s1', 'a', 60, 8), set('s3', 'c', 45, 10)],
    })
    // 兩份 lastUsed 同一天 → 取先建立的推日
    expect(suggestRoutine(d, routineList(d).active, NOW)).toMatchObject({ card: { routine: { id: 'r-push' } }, ready: false })
  })
})

describe('sessionRecords（訓練中即時的新紀錄）', () => {
  // 之前：11/20 臥推 60×10 → e1RM 80.0
  const base = {
    exercises: [BENCH, ROW],
    workouts: [workout('w-old', 20, 8, true), workout('w-now', 23, 17, false)],
  }

  it('這次最好的一組高過之前的最佳 → 標那一組，差值一位小數', () => {
    const d = db({
      ...base,
      workout_exercises: [entry('old', 'w-old', 'e-bench'), entry('now', 'w-now', 'e-bench')],
      // 62.5×8 → 79.2（沒破）；65×8 → 65×38/30＝82.33 → 82.3；+2.3
      workout_sets: [set('o1', 'old', 60, 10), set('n1', 'now', 62.5, 8), set('n2', 'now', 65, 8)],
    })
    expect(sessionRecords(d, 'w-now')).toEqual([{ exerciseId: 'e-bench', setId: 'n2', e1rm: 82.3, delta: 2.3 }])
  })

  it('沒打勾、超過 10 下的組不算；沒破之前最佳不算', () => {
    const d = db({
      ...base,
      workout_exercises: [entry('old', 'w-old', 'e-bench'), entry('now', 'w-now', 'e-bench')],
      workout_sets: [set('o1', 'old', 60, 10), set('n1', 'now', 70, 8, false), set('n2', 'now', 70, 12), set('n3', 'now', 60, 10)],
    })
    // n3 也是 80.0，跟之前一樣，不算新高
    expect(sessionRecords(d, 'w-now')).toEqual([])
  })

  it('第一次做的動作不算新紀錄；之後才做的（較晚的日子）不算「之前」', () => {
    const d = db({
      exercises: [BENCH, ROW],
      workouts: [workout('w-now', 20, 8, true), workout('w-later', 23, 8, true)],
      workout_exercises: [entry('now', 'w-now', 'e-row'), entry('later', 'w-later', 'e-row')],
      workout_sets: [set('n1', 'now', 45, 10), set('l1', 'later', 40, 10)],
    })
    expect(sessionRecords(d, 'w-now')).toEqual([])
  })
})

describe('exerciseBests（卡頭常駐的 1RM）', () => {
  it('之前的最佳與這次目前最好的一組；之前沒做過 prior＝null；這次還沒勾 current＝null', () => {
    const d = db({
      exercises: [BENCH, ROW, LEG],
      workouts: [workout('w-old', 20, 8, true), workout('w-now', 23, 17, false)],
      workout_exercises: [entry('o1', 'w-old', 'e-bench'), entry('o2', 'w-old', 'e-leg'), entry('n1', 'w-now', 'e-bench'), entry('n2', 'w-now', 'e-row'), entry('n3', 'w-now', 'e-leg')],
      // 臥推之前 80.0、這次 62.5×8＝79.2；下拉第一次 45×10＝60.0；腿推之前 100×10＝133.3、這次沒勾
      workout_sets: [set('a', 'o1', 60, 10), set('b', 'o2', 100, 10), set('c', 'n1', 62.5, 8), set('d', 'n2', 45, 10), set('e', 'n3', 120, 10, false)],
    })
    const m = exerciseBests(d, 'w-now')
    expect(m.get('e-bench')).toEqual({ prior: 80, current: { setId: 'c', e1rm: 79.2 } })
    expect(m.get('e-row')).toEqual({ prior: null, current: { setId: 'd', e1rm: 60 } })
    expect(m.get('e-leg')).toEqual({ prior: 133.3, current: null })
  })
})

describe('weekOrdinal', () => {
  it('同週已結束的、排在前面的加自己；上週的不算', () => {
    const d = db({
      workouts: [
        workout('w-lastweek', 22, 8, true), // 11/22 週日＝上週
        workout('w-mon', 23, 8, true),
        workout('w-mon2', 23, 17, false), // 這次，還沒結束
      ],
    })
    expect(weekOrdinal(d, 'w-mon2')).toBe(2)
    expect(weekOrdinal(d, 'w-mon')).toBe(1)
    expect(weekOrdinal(d, 'w-lastweek')).toBe(1)
  })
})

describe('同一天的兩筆補記（起點都是 12:00）', () => {
  it('依建立時間分先後：第二筆是本週第 2 次、不重複「第一次做」、第一筆的組算進第二筆的「之前」', () => {
    const bf = (id: string, created_at: string): Row => ({ id, performed_on: '2026-11-20', started_at: iso(20, 12), ended_at: iso(20, 12), routine_id: null, created_at })
    const d = db({
      exercises: [BENCH],
      // id 的字母順序故意跟建立順序相反（w-b 先建），才驗得到「比建立時間」而不是退到比 id
      workouts: [bf('w-a', '2026-11-23T10:05:00Z'), bf('w-b', '2026-11-23T10:00:00Z')],
      workout_exercises: [entry('a', 'w-b', 'e-bench'), entry('b', 'w-a', 'e-bench')],
      // 第一筆 60×10＝80.0、第二筆 60×8＝76.0：第二筆沒破第一筆
      workout_sets: [set('s1', 'a', 60, 10), set('s2', 'b', 60, 8)],
    })
    expect(weekOrdinal(d, 'w-b')).toBe(1)
    expect(weekOrdinal(d, 'w-a')).toBe(2)
    expect(workoutHighlights(d, 'w-b')).toEqual([{ kind: 'first', name: '槓鈴臥推' }])
    expect(workoutHighlights(d, 'w-a')).toEqual([])
  })
})

describe('workoutHighlights', () => {
  it('依序：新紀錄 → 比上次同課表 → 第一次做；最多三條', () => {
    const d = db({
      exercises: [BENCH, ROW, LEG, RUN],
      routines: [{ id: 'r-push', name: '推日', archived: false }],
      workouts: [workout('w-old', 20, 8, true, 'r-push'), workout('w-now', 23, 17, true, 'r-push')],
      workout_exercises: [
        entry('old', 'w-old', 'e-bench'),
        entry('now', 'w-now', 'e-bench', 0),
        entry('row', 'w-now', 'e-row', 1),
        entry('leg', 'w-now', 'e-leg', 2),
      ],
      // 之前 60×10＝600 kg、e1RM 80；這次 65×8＝520 ＋ 45×10＝450 ＋ 100×10＝1000 → 1970，比 600 多 228.33% → 228
      workout_sets: [set('o1', 'old', 60, 10), set('n1', 'now', 65, 8), set('r1', 'row', 45, 10), set('l1', 'leg', 100, 10)],
    })
    expect(workoutHighlights(d, 'w-now')).toEqual([
      { kind: 'record', name: '槓鈴臥推', e1rm: 82.3, delta: 2.3 },
      { kind: 'vsLast', routineName: '推日', pct: 228 },
      { kind: 'first', name: '滑輪下拉' }, // 腿推舉是第四條，被截掉
    ])
  })

  it('第一次做只算這次真的有做的：只加進來、一組都沒勾的不算', () => {
    const d = db({
      exercises: [BENCH, ROW],
      workouts: [workout('w-now', 23, 8, true)],
      workout_exercises: [entry('a', 'w-now', 'e-bench', 0), entry('b', 'w-now', 'e-row', 1)],
      workout_sets: [set('s1', 'a', 60, 8), set('s2', 'b', 45, 10, false)],
    })
    expect(workoutHighlights(d, 'w-now')).toEqual([{ kind: 'first', name: '槓鈴臥推' }])
  })

  it('上次同課表總重量 0、或差 0% 不寫；沒課表不寫', () => {
    const d = db({
      exercises: [BENCH],
      routines: [{ id: 'r', name: 'A', archived: false }],
      workouts: [workout('w-old', 20, 8, true, 'r'), workout('w-now', 23, 8, true, 'r')],
      workout_exercises: [entry('old', 'w-old', 'e-bench'), entry('now', 'w-now', 'e-bench')],
      workout_sets: [set('o1', 'old', 60, 10), set('n1', 'now', 60, 10)],
    })
    expect(workoutHighlights(d, 'w-now')).toEqual([])
  })
})

describe('trainedGroups', () => {
  it('有打勾的動作的肌群，依固定順序；有氧與沒勾的不列', () => {
    const d = db({
      exercises: [BENCH, ROW, LEG, RUN],
      workouts: [workout('w', 23, 8, true)],
      workout_exercises: [entry('a', 'w', 'e-leg'), entry('b', 'w', 'e-bench'), entry('c', 'w', 'e-row'), entry('d', 'w', 'e-run')],
      workout_sets: [set('s1', 'a', 100, 10), set('s2', 'b', 60, 8), set('s3', 'c', 45, 10, false)],
    })
    expect(trainedGroups(d, 'w')).toEqual(['胸部', '下半身'])
  })
})
