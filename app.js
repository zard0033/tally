/* ═══════════════════════════════════════════════════
   Tally — app
   無框架、無 build、不載第三方資源。Supabase 只用 REST：
   Auth 走 OAuth implicit flow，資料直打 PostgREST。
   不用 supabase-js 的理由：CDN 載法違反 DESIGN.md；vendor 進 repo 則是這個專案沒有
   npm 也沒有 lockfile，那 120KB 要手動追版本、手動盯安全更新，而其中只有 OAuth 與
   CRUD 用得到。自己接約 80 行，讀得懂也 debug 得動。
   ═══════════════════════════════════════════════════ */
'use strict';

const SUPABASE_URL = 'https://bpnucfejoiazmsnsuzdb.supabase.co';
/* publishable key 是設計上就公開的——前端一定要送給瀏覽器，藏不住也不必藏，
   隱私由 RLS 扛。sb_secret_ 那把才是永不進 repo 的。 */
const SUPABASE_ANON_KEY = 'sb_publishable_6BS_QZ-T9tPU6Oe74yHj2Q_6uF-2oWF';

const MEALS = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch',     label: '午餐' },
  { key: 'dinner',    label: '晚餐' },
  { key: 'snack',     label: '點心' },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── 日期：一律用本地時區。toISOString() 是 UTC，台灣早上 8 點前會算成前一天 ── */
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ═══════════ Auth ═══════════ */
const SESSION_KEY = 'tally.session';

const session = {
  get() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  },
  set(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); },
  clear() { localStorage.removeItem(SESSION_KEY); },
};

function signIn() {
  const back = location.origin + location.pathname;
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google`
    + `&redirect_to=${encodeURIComponent(back)}`;
}

function signOut() {
  session.clear();
  location.replace(location.origin + location.pathname);
}

/* OAuth 回來時 token 在 URL hash。讀完立刻從網址列抹掉——瀏覽器歷史、
   分享連結、截圖都不該留著 access token。 */
function consumeAuthRedirect() {
  if (!location.hash || location.hash.length < 2) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  const clean = () => history.replaceState(null, '', location.origin + location.pathname);

  if (h.get('error')) {
    clean();
    return { error: h.get('error_description') || h.get('error') };
  }
  const access_token = h.get('access_token');
  if (!access_token) return null;

  clean();
  return {
    session: {
      access_token,
      refresh_token: h.get('refresh_token') || '',
      expires_at: Date.now() + (Number(h.get('expires_in')) || 3600) * 1000,
    },
  };
}

/* refresh token 是一次性的（Supabase 預設 rotation）。頁面載入時三個 query 並行，
   同時過期就會送出三次 refresh、後兩次必定失敗把人踢出去——用 in-flight 去重。 */
let refreshing = null;

async function refreshSession(s) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!res.ok) { session.clear(); return null; }

  const j = await res.json();
  session.set({
    access_token: j.access_token,
    refresh_token: j.refresh_token || s.refresh_token,
    expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  });
  return j.access_token;
}

/* 提前 60 秒換新，避免 request 途中剛好過期 */
async function validToken() {
  const s = session.get();
  if (!s) return null;
  if (Date.now() < s.expires_at - 60_000) return s.access_token;
  if (!s.refresh_token) { session.clear(); return null; }

  refreshing ??= refreshSession(s).finally(() => { refreshing = null; });
  return refreshing;
}

/* ═══════════ Supabase REST ═══════════ */
class AuthError extends Error {}

/* 逾時是這支 app 的必要件，不是保險：記錄發生在美食街、地下室，那裡的失敗形態
   通常不是「連線被拒」而是「連上了但不回」。fetch 對後者永遠不 reject——沒有這道
   逾時，按鈕會停在「加入中…」直到使用者收起手機，他會以為那餐記好了。
   DESIGN.md 不做離線佇列是對的，但「失敗要當場看得見」得先讓失敗真的發生。 */
const DB_TIMEOUT = 8000;

async function db(path, opts = {}) {
  const token = await validToken();
  if (!token) throw new AuthError('no session');

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.prefer) headers.Prefer = opts.prefer;

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(DB_TIMEOUT),
    });
  } catch (e) {
    /* 原始訊息（'Failed to fetch'、'signal timed out'）對使用者沒有意義，換成看得懂的話。
       這裡只講「網路怎麼了」，不講「所以哪件事沒成」——呼叫端才知道自己在讀還是在寫
       （記一筆的錯誤列已經有「存不進去：」前綴） */
    if (e.name === 'TimeoutError') throw new Error('網路沒回應');
    if (e.name === 'TypeError') throw new Error('連不上網路');
    throw e;
  }
  /* RLS 擋下的讀取回的是 200 ＋ []，不是錯誤。真正的「沒有 session」只會是 401，
     兩者必須分開——否則 token 過期時今日頁會安靜地長成「今天什麼都沒吃」。 */
  if (res.status === 401 || res.status === 403) { session.clear(); throw new AuthError('expired'); }
  if (!res.ok) throw new Error(await dbError(res));
  /* 寫入預設回 204 無內容；要拿回新列得帶 Prefer: return=representation */
  if (res.status === 204 || res.headers.get('Content-Length') === '0') return null;
  return res.json();
}

/* PostgREST 的錯誤 body 是 JSON，訊息藏在 message／details。整包丟給使用者看是亂碼，
   但完全不顯示又會讓「存不進去」變成無聲失敗——取 message 那一句 */
async function dbError(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j.message || j.details || j.hint || `${res.status}`;
  } catch { return `${res.status} ${text}`.trim(); }
}

/* ═══════════ 目標計算 ═══════════ */
const num = (v) => (v === null || v === undefined ? NaN : Number(v));

function ageOn(birthDate, today = new Date()) {
  const b = new Date(birthDate + 'T00:00:00');
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

/* Mifflin-St Jeor → ×活動係數 → 目標調整。三大比例讀 profile（原本寫死 27/27/46） */
function computeTargets(profile, weightKg) {
  const age = ageOn(profile.birth_date);
  const h = num(profile.height_cm);
  const af = num(profile.activity_factor);
  const bmr = 10 * weightKg + 6.25 * h - 5 * age + (profile.sex === 'male' ? 5 : -161);
  const tdee = bmr * af;
  const kcal = profile.goal === 'cut' ? tdee * 0.8
             : profile.goal === 'bulk' ? tdee + 500
             : tdee;
  return {
    age, bmr, tdee, kcal,
    protein: kcal * (num(profile.protein_pct) / 100) / 4,
    fat:     kcal * (num(profile.fat_pct)     / 100) / 9,
    carb:    kcal * (num(profile.carb_pct)    / 100) / 4,
  };
}

/* 小計一律由未捨入值加總，只在顯示時捨入。
   營養值取 intake 自己的快照欄，不取 foods——改食物庫的營養值不該改寫過去的紀錄 */
function sumIntake(rows) {
  const t = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  for (const r of rows) {
    const q = num(r.qty);
    t.kcal    += num(r.kcal) * q;
    t.protein += num(r.protein) * q;
    t.fat     += num(r.fat) * q;
    t.carb    += num(r.carb) * q;
  }
  return t;
}

/* ═══════════ 狀態 ═══════════ */
/* 「今天」就是系統日期，不做凌晨分界；跨午夜的宵夜由使用者切到前一天補登 */
const state = {
  date: localDate(),     // 目前檢視的日期
  profile: null,
  weight: null,
  targets: null,
  rows: [],              // 檢視日的 intake
  foods: null,           // 食品庫快取（開 sheet 時才撈）
  recent: null,          // 各餐別的常吃排序（food_id → 次數統計後的陣列）
  sheet: null,           // 開著的覆蓋層，null = 沒開
  tab: 'today',          // 重新載入後要回到的分頁（在設定頁存檔不該被丟回今日頁）
  failed: false,         // 載入失敗中：分頁是空殼，不能讓使用者切過去
};

const isToday = () => state.date === localDate();

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

/* 標題只分三種：今天／昨天／星期幾。日期本身在下面那顆 input 裡，不重複 */
function dateTitle(iso) {
  const today = localDate();
  if (iso === today) return '今天';
  if (iso === shiftDate(today, -1)) return '昨天';
  const [y, m, d] = iso.split('-').map(Number);
  return '週' + '日一二三四五六'[new Date(y, m - 1, d).getDay()];
}

/* ═══════════ 畫面 ═══════════ */
function showPane(which) {
  $('pane-today').hidden    = which !== 'today';
  $('pane-settings').hidden = which !== 'settings';
  $('pane-notice').hidden   = which !== 'notice';
}

function notice(headline, detail, action) {
  const el = $('pane-notice');
  el.innerHTML = `<p class="headline">${esc(headline)}</p>`
    + (detail ? `<p>${esc(detail)}</p>` : '');
  if (action) {
    const b = document.createElement('button');
    b.className = 'cta';
    b.textContent = action.label;
    b.onclick = action.onClick;
    el.appendChild(b);
  }
  /* 記住「現在是壞的」，switchTab 才知道不能把使用者放到空殼分頁上 */
  state.failed = true;
  showPane('notice');
}

/* 進度條寬度。分母為 0 或 NaN 一律回 0，不把 NaN 送進 DOM */
function pct(cur, target) {
  if (!Number.isFinite(cur) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.max(0, (cur / target) * 100));
}

function renderMacro(name, cur, target) {
  const box = document.querySelector(`.macro[data-macro="${name}"]`);
  const over = Math.round(cur) > Math.round(target);   // `>` 才算破表，"超出 0" 看起來像 bug
  box.classList.toggle('over', over);
  box.querySelector('.fill').style.width = pct(cur, target) + '%';

  const label = { protein: '蛋白質', fat: '脂肪', carb: '碳水' }[name];
  const curTxt = cur.toFixed(1), tgtTxt = String(Math.round(target));
  const val = box.querySelector('.val');
  /* 視覺階層對螢幕閱讀器無效，數值由容器的 aria-label 提供、內部 span 全部 aria-hidden */
  val.setAttribute('aria-label',
    `${label} ${curTxt} 克，${over ? '超出目標' : '目標'} ${tgtTxt} 克`);
  val.innerHTML = `<span aria-hidden="true"><span class="cur">${curTxt}</span>`
    + `<span class="sep">/</span><span class="tgt">${tgtTxt}</span></span>`;
}

function renderTimeline(rows) {
  const byMeal = new Map(MEALS.map((m) => [m.key, []]));
  for (const r of rows) byMeal.get(r.meal)?.push(r);

  /* 食品庫有三筆完全同名的「雞胸餐盒」，只靠店家區分。今日頁常態不顯示店家
     （多一行會吃掉「一屏不捲」的餘裕），但同一天出現兩筆同名時就非顯示不可——
     否則回頭核對或刪除都是盲的 */
  const nameCount = new Map();
  for (const r of rows) {
    const n = r.foods?.name;
    if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1);
  }

  const html = MEALS.map((meal, i) => {
    const items = byMeal.get(meal.key);
    const done = items.length > 0;
    /* 線的虛實一律看下端節點——中間餐次空著時這條規則才有唯一解 */
    const nextDone = i < MEALS.length - 1 && byMeal.get(MEALS[i + 1].key).length > 0;
    const line = i === MEALS.length - 1 ? ''
      : `<div class="line${nextDone ? '' : ' todo'}"></div>`;

    let body;
    if (done) {
      const kcal = Math.round(sumIntake(items).kcal);
      const lis = items.map((r) => {
        const q = num(r.qty);
        const name = r.foods?.name || '（食物已刪除）';
        const dup = nameCount.get(name) > 1 && r.foods?.vendor;
        const vendor = dup ? ` <span class="vendor">${esc(r.foods.vendor)}</span>` : '';
        const qty = q === 1 ? '' : ` <span class="qty">×${String(q)}</span>`;
        /* 左滑或點擊都會露出刪除鈕：內容與刪除鈕是同一個橫向 scroll-snap 容器的兩個 snap 點 */
        return `<li class="item" data-row="${r.id}"><div class="item-track"><div class="item-track-row">`
          + `<button class="item-content" type="button" data-del="${r.id}">`
          + `<span class="nm">${esc(name)}${vendor}${qty}</span>`
          + `<span class="kc">${Math.round(num(r.kcal) * q)}</span></button>`
          + `<button class="item-delete" type="button" data-del-go="${r.id}"`
          + ` aria-label="刪除 ${esc(name)} 這一筆">`
          + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>`
          + `</button></div></div></li>`;
      }).join('');
      /* 餐別標題列本身也是入口——已記錄的餐次要追加（早餐記完想補一杯咖啡）時，
         不必按 CTA 從頭再選一次餐別 */
      body = `<button class="node-head" type="button" data-meal="${meal.key}">`
        + `<span class="node-name">${meal.label}</span>`
        + `<span class="node-kcal">${kcal}</span></button><ul class="items">${lis}</ul>`;
    } else {
      body = `<button class="todo-row" type="button" data-meal="${meal.key}"><span class="lb">${meal.label}</span>`
        + `<span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span></button>`;
    }

    return `<div class="node">`
      + `<div class="rail" aria-hidden="true"><div class="dot${done ? '' : ' todo'}"></div>${line}</div>`
      + `<div class="node-body${done ? '' : ' is-todo'}">${body}</div></div>`;
  }).join('');

  $('timeline').innerHTML = html;
}

function renderToday(targets, rows) {
  const eaten = sumIntake(rows);

  /* 三個數字要互相對得起來：先各自捨入，剩餘由捨入後的值相減。
     否則 903.4 / 1860.6 會顯示成 903 + 957 ≠ 1861 */
  const eatenKcal = Math.round(eaten.kcal);
  const targetKcal = Math.round(targets.kcal);
  const diff = targetKcal - eatenKcal;
  const over = diff < 0;

  $('pane-today').classList.toggle('is-over', over);
  /* 回頭看過去問的是「那天吃了多少」，不是「還能吃多少」——歷史日主數字換成攝取量，
     版面其餘完全一樣 */
  const past = !isToday();
  $('gauge-lead').textContent = past ? '攝取' : over ? '超出' : '還能吃';
  $('gauge-num').textContent = String(past ? eatenKcal : Math.abs(diff));
  $('gauge-fill').style.width = pct(eaten.kcal, targets.kcal) + '%';

  const side = $('gauge-side');
  side.setAttribute('aria-label', `已攝取 ${eatenKcal} 大卡，目標 ${targetKcal} 大卡`);
  side.innerHTML = `<span aria-hidden="true"><span class="cur">${eatenKcal}</span>`
    + `<span class="sep">/</span><span class="tgt">${targetKcal}</span></span>`;

  renderMacro('protein', eaten.protein, targets.protein);
  renderMacro('fat',     eaten.fat,     targets.fat);
  renderMacro('carb',    eaten.carb,    targets.carb);
  renderTimeline(rows);
  showPane(state.tab);
}

const GOAL_LABEL = { cut: '減重', maintain: '維持', bulk: '增肌' };
const GOAL_NOTE  = { cut: '減重再乘 0.8', maintain: '維持不調整', bulk: '增肌再加 500' };

function renderSettings(targets, profile, weight) {
  const kv = (k, v) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
  const goal = GOAL_LABEL[profile.goal] || profile.goal;
  const ratio = [profile.protein_pct, profile.fat_pct, profile.carb_pct]
    .map((v) => String(num(v))).join(' / ');

  $('pane-settings').innerHTML = `
    <h2>今日目標</h2>
    <dl>
      ${kv('熱量', `${Math.round(targets.kcal)} 卡`)}
      ${kv('蛋白質', `${Math.round(targets.protein)} g`)}
      ${kv('脂肪', `${Math.round(targets.fat)} g`)}
      ${kv('碳水', `${Math.round(targets.carb)} g`)}
    </dl>
    <h2>怎麼算出來的</h2>
    <dl>
      ${kv('最新體重', `${num(weight.weight_kg).toFixed(2)} kg`)}
      ${kv('量測日', weight.measured_on)}
      ${kv('身高', `${num(profile.height_cm).toFixed(1)} cm`)}
      ${kv('年齡', `${targets.age} 歲`)}
      ${kv('BMR', `${Math.round(targets.bmr)} 卡`)}
      ${kv('活動係數', String(num(profile.activity_factor)))}
      ${kv('TDEE', `${Math.round(targets.tdee)} 卡`)}
      ${kv('目標', goal)}
      ${kv('三大比例', ratio)}
    </dl>
    <p class="note">Mifflin-St Jeor 公式算 BMR，乘活動係數得 TDEE，${GOAL_NOTE[profile.goal] || ''}。三大營養素按 ${esc(ratio)} 拆分。體重取最新一筆，數值變動時目標會跟著動。</p>
    <button class="link-btn" id="btn-weigh" type="button">記體重</button>
    <button class="link-btn" id="btn-edit-profile" type="button">編輯身體參數</button>
    <button class="signout" id="btn-signout" type="button">登出</button>`;
  $('btn-weigh').onclick = () => openSheet('weight');
  $('btn-edit-profile').onclick = () => openSheet('profile');
  $('btn-signout').onclick = signOut;
}

/* ═══════════ 啟動 ═══════════ */
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  renderHeader();
  /* 載入失敗時兩個分頁都是空殼——設定頁的 innerHTML 只有 load() 成功才會寫，
     切過去是一片空白，切回來重試按鈕也不見了，只剩重新整理一途（而那正是網路最差的時候）。
     這種時候留在提示畫面上，重試按鈕才一直在手邊 */
  showPane(state.failed ? 'notice' : tab);
}

/* 營養值取 intake 的快照欄；foods 只 embed 品名，拿來顯示 */
const intakeQuery = (d) => `intake?eaten_on=eq.${d}`
  + `&select=id,meal,qty,kcal,protein,fat,carb,foods(name,vendor)&order=created_at.asc`;

/* 標題與日期列由同一個函式管——分成兩處寫過一次，載入完成時 renderDate
   會把設定頁的標題蓋回「今天」 */
function renderHeader() {
  const onSettings = state.tab === 'settings';
  $('page-title').textContent = onSettings ? '設定' : dateTitle(state.date);
  $('page-date').hidden = onSettings;
  $('date-input').value = state.date;
  $('date-next').disabled = isToday();     // 看不了未來
  $('page-date').classList.toggle('past', !isToday());
}

/* 只換日期時不必重撈 profile／體重——目標不隨檢視日改變 */
async function loadDay() {
  renderHeader();
  $('timeline').innerHTML = '<p class="muted">載入中…</p>';
  try {
    state.rows = await db(intakeQuery(state.date));
  } catch (e) {
    if (e instanceof AuthError) return showLogin('登入已過期，請重新登入');
    return notice('讀不到這天的紀錄', e.message, { label: '重試', onClick: loadDay });
  }
  renderToday(state.targets, state.rows);
}

async function load() {
  /* 主數字停在破折號、時間軸明說載入中——「讀到空」和「還沒讀到」在畫面上必須分得開，
     否則弱訊號那 1–3 秒看起來就是「今天什麼都沒吃」 */
  $('timeline').innerHTML = '<p class="muted">載入中…</p>';
  showPane(state.tab);
  renderHeader();

  let profile, weights, rows;
  try {
    [profile, weights, rows] = await Promise.all([
      db('profile?select=*&limit=1'),
      db('weight?select=weight_kg,measured_on&order=measured_on.desc&limit=1'),
      db(intakeQuery(state.date)),
    ]);
  } catch (e) {
    if (e instanceof AuthError) return showLogin('登入已過期，請重新登入');
    return notice('連不上 Supabase', e.message, { label: '重試', onClick: load });
  }

  /* 目標算不出來時走降級畫面，不讓 NaN 進 DOM。
     Google 登入建出第二個 UID 時四張表全空，正是這條路徑。 */
  const p = profile[0], w = weights[0];
  if (!p || !w) {
    return notice(
      '還沒有身體參數',
      !p && !w ? '這個帳號的 profile 與體重都是空的。若之前用另一組帳號登入過，資料可能掛在別的 user id 下。'
        : !p ? '缺 profile 資料，算不出目標熱量。'
        : '缺體重紀錄，算不出目標熱量。',
      { label: '重新載入', onClick: load });
  }

  const targets = computeTargets(p, num(w.weight_kg));
  if (!Number.isFinite(targets.kcal)) {
    return notice('目標熱量算不出來', '身體參數有缺漏或格式不對，請檢查 profile 表。',
      { label: '重新載入', onClick: load });
  }

  state.profile = p;
  state.weight = w;
  state.targets = targets;
  state.rows = rows;
  state.failed = false;

  renderToday(targets, rows);
  renderSettings(targets, p, w);
}

function showLogin(msg) {
  $('view-app').hidden = true;
  $('view-login').hidden = false;
  const err = $('signin-error');
  err.textContent = msg || '';
  err.hidden = !msg;
}

function showApp() {
  $('view-login').hidden = true;
  $('view-app').hidden = false;
  load();
}

function goToDate(iso) {
  if (iso === state.date || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  if (iso > localDate()) return;            // 看不了未來
  state.date = iso;
  loadDay();
}

function init() {
  $('btn-signin').onclick = signIn;
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  $('date-prev').onclick = () => goToDate(shiftDate(state.date, -1));
  $('date-next').onclick = () => goToDate(shiftDate(state.date, 1));
  /* 日曆選了空值（部分瀏覽器的清除鈕）就退回目前這天，不讓 state 變 '' */
  $('date-input').onchange = (e) => {
    if (e.target.value) goToDate(e.target.value);
    else e.target.value = state.date;
  };

  $('btn-add').onclick = () => openSheet(defaultMeal());

  /* 時間軸整塊委派：餐別標題、待記錄行、品項、刪除鈕都在這裡分流 */
  $('timeline').onclick = (e) => {
    const entry = e.target.closest('[data-meal]');
    if (entry) return openSheet(entry.dataset.meal);

    const del = e.target.closest('[data-del-go]');
    if (del) return deleteIntake(Number(del.dataset.delGo), del);

    /* 點品項＝露出刪除鈕。手勢對鍵盤與螢幕閱讀器是死路，這條是它們的路徑 */
    const item = e.target.closest('[data-del]');
    if (item) revealDelete(item.closest('.item-track'));
  };
  /* 左滑開了一列就關掉其他列——同時開兩列沒有意義，且誤觸風險加倍 */
  $('timeline').addEventListener('scroll', (e) => {
    const track = e.target.closest?.('.item-track');
    if (track && track.scrollLeft > 8) closeOtherTracks(track);
  }, true);

  const root = $('sheet-root');
  /* 份量框裡本來就有值（預設 1），聚焦時全選：不然要改成 3 得先自己刪掉那個 1，
     打下去會變成 31 */
  root.addEventListener('focusin', (e) => {
    if (e.target.matches('[data-qty-input]')) e.target.select();
  });
  root.addEventListener('click', onSheetClick);
  root.addEventListener('input', onSheetInput);
  root.addEventListener('change', onSheetChange);
  /* Esc 關閉：手勢與點外面都是滑鼠／觸控的路徑，鍵盤要有自己的一條 */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.sheet) closeSheet();
  });

  if (!SUPABASE_ANON_KEY) {
    $('view-app').hidden = false;
    return notice('尚未設定 Supabase 金鑰', '在 app.js 填入 SUPABASE_ANON_KEY 後重新載入。');
  }

  /* 沒帶 code_challenge 時 Supabase 走 implicit、token 回在 hash。若哪天回的是 ?code=
     就是專案改吃 PKCE 了——講出來，別讓它靜默停在登入頁 */
  if (new URLSearchParams(location.search).get('code')) {
    history.replaceState(null, '', location.origin + location.pathname);
    return showLogin('登入回傳的是授權碼（PKCE），目前的 implicit flow 接不了，需要改 code exchange。');
  }

  const redirect = consumeAuthRedirect();
  if (redirect?.error) return showLogin(`登入失敗：${redirect.error}`);
  if (redirect?.session) session.set(redirect.session);

  if (session.get()) showApp();
  else showLogin();
}

/* ═══════════ 今日頁：刪除 ═══════════ */
const DELETE_W = 57;   // .item-delete 的 min-width 56 ＋ 擋分數像素的 margin-left 1

function closeOtherTracks(except) {
  document.querySelectorAll('.item-track').forEach((t) => {
    if (t !== except && t.scrollLeft !== 0) t.scrollLeft = 0;
  });
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function revealDelete(track) {
  if (!track) return;
  const open = track.scrollLeft > 8;
  closeOtherTracks(track);
  /* 再點一次收回去——點開之後沒有其他方式取消，否則就得靠滑回去。
     這段捲動是 JS 觸發的，CSS 的 reduced-motion 區塊管不到，要自己判斷 */
  track.scrollTo({ left: open ? 0 : DELETE_W, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

async function deleteIntake(id, btn) {
  btn.disabled = true;
  try {
    await db(`intake?id=eq.${id}`, { method: 'DELETE' });
  } catch (e) {
    btn.disabled = false;
    if (e instanceof AuthError) return showLogin('登入已過期，請重新登入');
    return notice('刪不掉這一筆', e.message, { label: '回今天', onClick: loadDay });
  }
  loadDay();
}

/* ═══════════ 記一筆 sheet ═══════════ */
/* 走同頁覆蓋層，不做獨立頁——獨立頁等於整頁重載加重打 API，還得為今日頁做本地快取 */

const ICON = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
};
const svg = (d, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

/* 主 CTA 沒指定餐別，依時間預選一個 chip */
function defaultMeal() {
  const h = new Date().getHours();
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

const mealLabel = (k) => MEALS.find((m) => m.key === k)?.label || '';
const foodById = (id) => state.foods?.find((f) => f.id === id);
const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hant');

/* 常吃＝該餐別歷史出現次數；順便記住每樣最近一次的份量。
   查詢已按 eaten_on 由新到舊，所以第一次看到的那筆就是最近的一筆。
   茶葉蛋天天 ×2，每天都要多按一次加號的話，一年就是三百多下 */
function tallyRecent(rows) {
  const byMeal = new Map(MEALS.map((m) => [m.key, new Map()]));
  const lastQty = new Map();
  for (const r of rows) {
    const key = `${r.meal}:${r.food_id}`;
    if (!lastQty.has(key)) lastQty.set(key, num(r.qty));
    const c = byMeal.get(r.meal);
    if (c) c.set(r.food_id, (c.get(r.food_id) || 0) + 1);
  }
  state.lastQty = lastQty;
  return new Map([...byMeal].map(([k, counts]) =>
    [k, [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id)]));
}

/* 選取時的預設份量：這一餐上次吃這樣東西是多少，沒記錄過才回 1 */
function defaultQty(meal, foodId) {
  const q = state.lastQty?.get(`${meal}:${foodId}`);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function setBackgroundInert(on) {
  document.querySelectorAll('#view-app > .topbar, #view-app > .main, #view-app > .tabbar-wrap')
    .forEach((el) => { el.inert = on; });
}

/* kind：餐別 key（記一筆）／'weight'（記體重）／'profile'（編輯身體參數） */
async function openSheet(kind) {
  const isMeal = MEALS.some((m) => m.key === kind);
  state.sheet = {
    meal: isMeal ? kind : null,
    view: isMeal ? 'list' : kind,
    picks: new Map(),
    q: '',
    busy: false,
    err: null,
    opener: document.activeElement,
  };
  /* 上一個 sheet 的退場可能還在跑，殘留的 .closing 會讓新的這個一開場就往下滑走 */
  $('sheet-root').classList.remove('closing');
  setBackgroundInert(true);
  renderSheet();
  if (isMeal && !state.foods) await loadFoodLibrary();
}

async function loadFoodLibrary() {
  try {
    /* 常吃只要排出每餐前五名，120 筆綽綽有餘。這支查詢卡在「按下記一筆」到
       「清單可點」之間，是整個流程最容易在弱訊號下卡住的一步，別讓它比需要的更重 */
    const [foods, hist] = await Promise.all([
      db('foods?select=id,name,vendor,kcal,protein,fat,carb'),
      db('intake?select=meal,food_id,qty&order=eaten_on.desc&limit=120'),
    ]);
    state.foods = foods.sort(byName);
    state.recent = tallyRecent(hist);
    if (state.sheet) state.sheet.err = null;
  } catch (e) {
    if (e instanceof AuthError) { closeSheet(); return showLogin('登入已過期，請重新登入'); }
    /* 撈到一半使用者把 sheet 關掉了，state.sheet 已是 null */
    if (state.sheet) state.sheet.err = e.message;
  }
  /* 只換清單，不重建外殼——外殼重建會把進場動畫的 class 一起換掉，
     sheet 才滑到一半就被打斷 */
  if (state.sheet) renderList();
}

function closeSheet() {
  const opener = state.sheet?.opener;
  const root = $('sheet-root');
  if (!root.firstChild) return;
  state.sheet = null;
  setBackgroundInert(false);

  /* 退場要等動畫跑完才清空 DOM。焦點先還回去（不然這 200ms 內焦點懸在
     即將消失的元素上），清空用 animationend；動畫被停用時 fallback 計時器接手 */
  if (opener?.isConnected) opener.focus();
  root.classList.add('closing');
  const done = () => {
    root.classList.remove('closing');
    if (!state.sheet) root.innerHTML = '';   // 這期間又開了新的就不要清掉
  };
  const sheet = root.querySelector('.sheet');
  if (!sheet) return done();
  sheet.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
}

/* ── sheet 內容 ── */
function foodMatches(f, q) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  /* 同時比對品名與店家——五筆「雞胸餐盒」其中三筆完全同名，只靠店家區分 */
  return f.name.toLowerCase().includes(s) || (f.vendor || '').toLowerCase().includes(s);
}

function foodRow(f, picked) {
  const sub = f.vendor ? `<span class="sub">${esc(f.vendor)}</span>` : '';
  const chk = picked
    ? '<circle cx="11" cy="11" r="9"/><path d="M7 11.5l2.5 2.5L15 8.5"/>'
    : '<circle cx="11" cy="11" r="9"/>';
  const btn = `<button class="food-row" type="button" data-pick="${f.id}"`
    + ` aria-pressed="${picked ? 'true' : 'false'}">`
    + `<svg class="chk" viewBox="0 0 22 22" aria-hidden="true">${chk}</svg>`
    + `<div class="nm-wrap"><span class="nm">${esc(f.name)}</span>${sub}</div>`
    + (picked ? '' : `<span class="kc">${Math.round(num(f.kcal))}</span>`)
    + '</button>';

  if (!picked) return `<li><div class="food-item">${btn}</div></li>`;

  /* 選取後熱量欄換成加減鈕組。input 巢在 button 裡不可聚焦，所以兩者並排而非包住 */
  const qty = state.sheet.picks.get(f.id);
  const step = (dir, label, icon, off) =>
    `<button class="qty-btn" type="button" data-qty="${dir}" data-id="${f.id}"`
    + `${off ? ' disabled' : ''} aria-label="${label} ${esc(f.name)} 的份量">${svg(icon)}</button>`;
  return `<li><div class="food-item selected"><div class="food-line">${btn}`
    /* 份量下限是 1；減到底就把減號停用，不要讓「按了沒事」看起來像壞掉 */
    + `<div class="qty-stepper">${step('minus', '減少', ICON.minus, qty <= 1)}`
    + `<input class="qty-value" type="text" inputmode="decimal" data-qty-input="${f.id}"`
    + ` value="${String(qty)}" aria-label="${esc(f.name)} 份量">`
    + `${step('plus', '增加', ICON.plus)}</div></div></div></li>`;
}

function sheetListHtml() {
  const s = state.sheet;
  /* 讀不到食品庫時要給得出下一步。只印錯誤訊息等於把人留在死路上 */
  if (s.err && !state.foods) {
    return `<p class="muted">讀不到食品庫：${esc(s.err)}</p>`
      + '<div class="retry-wrap"><button class="pick-bar-btn" type="button" data-reload-foods>重試</button></div>';
  }
  if (!state.foods) return '<p class="muted">載入中…</p>';

  const list = (items) => `<ul class="food-list">${items.join('')}</ul>`;
  const out = [];

  /* 已選固定在捲動區最上方、不隨餐別切換消失，可就地改份量或取消 */
  if (s.picks.size) {
    const picked = [...s.picks.keys()].map(foodById).filter(Boolean);
    out.push('<div class="sect-lb">已選</div>', list(picked.map((f) => foodRow(f, true))));
  }

  const q = s.q.trim();
  if (q) {
    /* 搜尋框是模式切換器：一有輸入，結果取代常吃與全部食物兩段 */
    const hits = state.foods.filter((f) => !s.picks.has(f.id) && foodMatches(f, q));
    out.push('<div class="sect-lb">搜尋結果</div>');
    if (!hits.length) out.push(`<p class="search-empty-msg">找不到「${esc(q)}」</p>`);
    /* 新增入口只要有輸入就在末尾常駐，不是只在零結果時出現——搜到部分結果時
       使用者一樣可能需要新增 */
    out.push(list([
      ...hits.map((f) => foodRow(f, false)),
      `<li><button class="add-food-row" type="button" data-add-food>${svg(ICON.plus)}`
        + `<span class="txt">新增「${esc(q)}」到食品庫</span></button></li>`,
    ]));
  } else {
    const recentIds = (state.recent?.get(s.meal) || []).filter((id) => !s.picks.has(id));
    const recent = recentIds.map(foodById).filter(Boolean).slice(0, 5);
    const rest = state.foods.filter((f) => !s.picks.has(f.id) && !recent.includes(f));
    if (recent.length) {
      out.push(`<div class="sect-lb">${mealLabel(s.meal)}常吃</div>`,
        list(recent.map((f) => foodRow(f, false))));
    }
    if (rest.length) {
      out.push('<div class="sect-lb">全部食物</div>', list(rest.map((f) => foodRow(f, false))));
    }
    /* 新帳號的食品庫是空的，「新增食物」是唯一出路 */
    if (!recent.length && !rest.length) {
      out.push('<p class="muted">食品庫還是空的。在上面搜尋框輸入品名就能新增第一筆。</p>');
    }
  }
  return out.join('');
}

function pickTotals() {
  const t = { n: 0, kcal: 0 };
  for (const [id, qty] of state.sheet.picks) {
    const f = foodById(id);
    if (!f) continue;
    t.n++;
    t.kcal += num(f.kcal) * qty;
  }
  return t;
}

function remainingAfterPicks(picksKcal) {
  const eaten = sumIntake(state.rows).kcal;
  return Math.round(num(state.targets?.kcal)) - Math.round(eaten + picksKcal);
}

/* 補記過去某天時「剩 479」是錯的語意——那天已經過完了，沒有「剩」可言。
   跟主數字同一套邏輯：歷史日看的是加進去之後那天總共吃了多少 */
function pickBarRight(picksKcal) {
  if (!isToday()) {
    return { text: `共 ${Math.round(sumIntake(state.rows).kcal + picksKcal)}`, over: false };
  }
  const left = remainingAfterPicks(picksKcal);
  return { text: left < 0 ? `超出 ${-left}` : `剩 ${left}`, over: left < 0 };
}

function pickBarHtml() {
  const s = state.sheet;
  if (!s.picks.size) return '';
  const t = pickTotals();
  const right = pickBarRight(t.kcal);
  const label = s.busy ? '加入中…' : s.err ? '重試' : '加入';
  /* 剩餘不用正負號——「+594」會被讀成「多攝取 594」 */
  return `<div class="pick-bar${right.over ? ' is-over' : ''}">`
    + (s.err ? `<p class="sheet-error" role="alert">存不進去：${esc(s.err)}</p>` : '')
    + `<div class="pick-line"><span class="sub">${t.n} 樣 · ${Math.round(t.kcal)} 卡</span>`
    + `<span class="remain">${right.text}</span></div>`
    + `<button class="pick-bar-btn" type="button" data-submit-picks`
    + `${s.busy ? ' disabled' : ''}>${label}</button></div>`;
}

const field = (id, label, opts = {}) =>
  `<div class="field-float"><input id="${id}" type="text"`
  + `${opts.numeric ? ' inputmode="decimal"' : ''} placeholder=" "`
  + ` value="${esc(opts.value ?? '')}"><label for="${id}">${label}</label></div>`;

const selectField = (id, label, options, current) =>
  `<div class="field-float"><select id="${id}">`
  + options.map(([v, t]) =>
      `<option value="${v}"${String(v) === String(current) ? ' selected' : ''}>${t}</option>`).join('')
  + `</select><label for="${id}">${label}</label></div>`;

const REQ = '<span class="req">*</span>';

function foodFormHtml() {
  const s = state.sheet;
  return `<div class="back-row"><button class="back-btn" type="button" data-back>`
    + `${svg(ICON.back)}返回搜尋</button></div>`
    + '<div class="form-wrap">'
    + `<div class="field-row">${field('f-name', `品名${REQ}`, { value: s.q.trim() })}`
    + `${field('f-vendor', '店家（選填）')}</div>`
    + field('f-kcal', `熱量（卡）${REQ}`, { numeric: true })
    + `<div class="field-row">${field('f-protein', `蛋白質 g${REQ}`, { numeric: true })}`
    + `${field('f-fat', `脂肪 g${REQ}`, { numeric: true })}`
    + `${field('f-carb', `碳水 g${REQ}`, { numeric: true })}</div>`
    + '</div>'
    + '<div class="confirm-wrap">'
    + (s.err ? `<p class="sheet-error" role="alert">${esc(s.err)}</p>` : '')
    + `<button class="pick-bar-btn" type="button" data-submit-food${s.busy ? ' disabled' : ''}>`
    + `${s.busy ? '加入中…' : '加入食品庫'}</button></div>`;
}

function weightFormHtml() {
  const s = state.sheet;
  return '<div class="form-wrap">'
    + `<div class="field-float"><input id="w-date" type="date" value="${localDate()}">`
    + '<label for="w-date">量測日</label></div>'
    + field('w-kg', `體重 kg${REQ}`, { numeric: true })
    + field('w-fat', '體脂 %（選填）', { numeric: true })
    + '<p class="note">存體脂計原始讀數，不做校正。同一天再記一次會覆蓋當天那筆。</p>'
    + '</div><div class="confirm-wrap">'
    + (s.err ? `<p class="sheet-error" role="alert">${esc(s.err)}</p>` : '')
    + `<button class="pick-bar-btn" type="button" data-submit-weight${s.busy ? ' disabled' : ''}>`
    + `${s.busy ? '儲存中…' : '儲存'}</button></div>`;
}

function profileFormHtml() {
  const s = state.sheet, p = state.profile;
  return '<div class="form-wrap">'
    + `<div class="field-float"><input id="p-birth" type="date" value="${esc(p.birth_date)}">`
    + '<label for="p-birth">生日</label></div>'
    + `<div class="field-row">${field('p-height', `身高 cm${REQ}`, { numeric: true, value: num(p.height_cm) })}`
    + selectField('p-sex', '性別', [['male', '男'], ['female', '女']], p.sex) + '</div>'
    + `<div class="field-row">`
    + selectField('p-goal', '目標',
        [['cut', '減重'], ['maintain', '維持'], ['bulk', '增肌']], p.goal)
    + field('p-af', `活動係數${REQ}`, { numeric: true, value: num(p.activity_factor) }) + '</div>'
    + '<div class="field-row">'
    + field('p-protein', `蛋白 %${REQ}`, { numeric: true, value: num(p.protein_pct) })
    + field('p-fat', `脂肪 %${REQ}`, { numeric: true, value: num(p.fat_pct) })
    + field('p-carb', `碳水 %${REQ}`, { numeric: true, value: num(p.carb_pct) })
    + '</div>'
    + '<p class="note">活動係數：久坐 1.2、輕度 1.375、中度 1.55、高度 1.725。三大比例相加要等於 100。</p>'
    + '</div><div class="confirm-wrap">'
    + (s.err ? `<p class="sheet-error" role="alert">${esc(s.err)}</p>` : '')
    + `<button class="pick-bar-btn" type="button" data-submit-profile${s.busy ? ' disabled' : ''}>`
    + `${s.busy ? '儲存中…' : '儲存'}</button></div>`;
}

const SHEET_TITLE = { 'food-form': '新增食物', weight: '記體重', profile: '身體參數' };

/* renderSheet 會整塊重建 DOM，使用者打到一半的欄位得自己接住——否則填了五欄、
   漏一欄按下儲存，錯誤訊息會連同其他四欄一起清掉。只在同一個 view 內接續 */
function snapshotFields() {
  const s = state.sheet;
  if (!s) return;
  const vals = {};
  $('sheet-root').querySelectorAll('[id]').forEach((el) => {
    if ('value' in el) vals[el.id] = el.value;
  });
  s.vals = vals;
  s.valsView = s.renderedView;   // 快照屬於「畫面上那個 view」，不是即將切換到的那個
}

function restoreFields() {
  const s = state.sheet;
  if (!s?.vals || s.valsView !== s.view) return;
  $('sheet-root').querySelectorAll('[id]').forEach((el) => {
    if (el.id in s.vals) el.value = s.vals[el.id];
  });
}

function renderSheet() {
  const s = state.sheet;
  if (!s) return;
  snapshotFields();
  const title = s.view === 'list' ? mealLabel(s.meal) : SHEET_TITLE[s.view];

  let body;
  if (s.view === 'list') {
    body = `<div class="chiprow" aria-label="餐別">`
      + MEALS.map((m) => `<button class="chip" type="button" data-chip="${m.key}"`
        + `${m.key === s.meal ? ' aria-current="true"' : ''}>${m.label}</button>`).join('')
      + '</div>'
      /* 切餐別不重置搜尋字，清單用新餐別重新比對 */
      + `<div class="search-wrap"><div class="search-box">${svg(ICON.search)}`
      + `<input id="sheet-q" type="text" placeholder="搜尋品名或店家"`
      + ` value="${esc(s.q)}" aria-label="搜尋食物"></div></div>`
      + `<div class="food-scroll">${sheetListHtml()}</div>`
      + pickBarHtml();
  } else if (s.view === 'food-form') body = foodFormHtml();
  else if (s.view === 'weight') body = weightFormHtml();
  else body = profileFormHtml();

  /* 遮罩是真 button（可點的東西一律 button）。它在 aria-modal 的 dialog 之外，
     輔助技術會略過，不會多讀一次「關閉」 */
  /* 進場動畫只掛在真正開啟那一次。切 view、busy 重繪都會走到這裡，
     每次都帶 .opening 的話 sheet 會反覆從底部彈一次 */
  const opening = s.renderedView === undefined ? ' opening' : '';
  $('sheet-root').innerHTML = '<button class="scrim" type="button" data-close aria-label="關閉"></button>'
    + `<div class="sheet${opening}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">`
    + '<div class="handle" aria-hidden="true"></div>'
    + `<div class="sheet-head"><span class="sheet-title">${esc(title)}</span>`
    + `<button class="icon-btn" type="button" data-close aria-label="關閉">${svg(ICON.close)}</button>`
    + `</div>${body}</div>`;

  s.renderedView = s.view;
  restoreFields();
  document.querySelector('.sheet')?.focus();
}

/* ── 增量更新 ──
   renderSheet 會整塊換掉 innerHTML，用在清單與確認列上會咬到兩件事：
   1. 點「加入」時 input 先失焦觸發重繪，mousedown 的目標離開 DOM，click 根本不派送
      ——填完份量按加入沒反應。
   2. 搜尋框每打一個字就被換掉，中文注音組字到一半會被打斷。
   所以打字與改份量一律走增量：清單重建但搜尋框不動，確認列只改文字不換元素。 */
function renderList() {
  const el = document.querySelector('.food-scroll');
  if (!el) return;
  el.innerHTML = sheetListHtml();
  syncPickBar();
}

function syncPickBar() {
  const s = state.sheet;
  const sheet = document.querySelector('.sheet');
  if (!s || !sheet) return;
  const bar = sheet.querySelector('.pick-bar');

  if (!s.picks.size) { bar?.remove(); return; }
  /* 從 0 樣變成 1 樣時整條長出來——這一刻使用者按的是清單列，不是確認鈕，換元素是安全的 */
  if (!bar) { sheet.insertAdjacentHTML('beforeend', pickBarHtml()); return; }

  const t = pickTotals();
  const right = pickBarRight(t.kcal);
  bar.classList.toggle('is-over', right.over);
  bar.querySelector('.sub').textContent = `${t.n} 樣 · ${Math.round(t.kcal)} 卡`;
  bar.querySelector('.remain').textContent = right.text;
}

/* ── sheet 事件 ── */
/* 加減鈕走的是不重繪的路徑（重繪會把按鈕本身換掉），所以停用狀態得手動跟著份量走 */
function syncMinus(id, qty) {
  const btn = document.querySelector(`[data-qty="minus"][data-id="${id}"]`);
  if (btn) btn.disabled = qty <= 1;
}

function normalizeQty(v) {
  const n = Number(String(v).trim());
  /* 空白或非正數一律回 1：schema 有 check (qty > 0) 擋底，但前端先擋掉才不會
     按了「加入」才失敗。減到 1 就停 */
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 1;
}

function onSheetClick(e) {
  const s = state.sheet;
  if (!s) return;

  if (e.target.closest('[data-close]')) return closeSheet();

  const chip = e.target.closest('[data-chip]');
  if (chip) {
    /* 切餐別不清空已選也不重置搜尋字，已選跟著搬到新餐別 */
    s.meal = chip.dataset.chip;
    document.querySelectorAll('[data-chip]').forEach((c) => {
      if (c === chip) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
    document.querySelector('.sheet-title').textContent = mealLabel(s.meal);
    document.querySelector('.sheet').setAttribute('aria-label', mealLabel(s.meal));
    return renderList();
  }

  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const id = Number(pick.dataset.pick);
    if (s.picks.has(id)) s.picks.delete(id);
    else s.picks.set(id, defaultQty(s.meal, id));
    s.err = null;
    renderList();
    /* 重建清單會把剛按的那顆按鈕連同焦點一起換掉，鍵盤使用者會被丟回 body。
       sheet 是 aria-modal，這是清單裡唯一的導覽路徑，斷了就出不去 */
    return document.querySelector(`[data-pick="${id}"]`)?.focus();
  }

  /* 加減鈕只改那一格的值——重繪清單會把按鈕本身換掉，連按第二下就落空 */
  const qty = e.target.closest('[data-qty]');
  if (qty) {
    const id = Number(qty.dataset.id);
    const cur = s.picks.get(id) ?? 1;
    const next = normalizeQty(qty.dataset.qty === 'plus' ? cur + 1 : cur - 1);
    s.picks.set(id, next);
    const box = document.querySelector(`[data-qty-input="${id}"]`);
    if (box) box.value = String(next);
    syncMinus(id, next);
    return syncPickBar();
  }

  if (e.target.closest('[data-reload-foods]')) {
    s.err = null;
    renderList();
    return loadFoodLibrary();
  }

  if (e.target.closest('[data-add-food]')) {
    s.view = 'food-form';
    s.err = null;
    renderSheet();
    return $('f-kcal')?.focus();
  }
  if (e.target.closest('[data-back]')) {
    s.view = 'list';
    s.err = null;
    return renderSheet();
  }

  if (e.target.closest('[data-submit-picks]')) return submitPicks();
  if (e.target.closest('[data-submit-food]')) return submitFood();
  if (e.target.closest('[data-submit-weight]')) return submitWeight();
  if (e.target.closest('[data-submit-profile]')) return submitProfile();
}

function onSheetInput(e) {
  const s = state.sheet;
  if (!s) return;
  if (e.target.id === 'sheet-q') {
    s.q = e.target.value;
    return renderList();     // 只換清單，搜尋框本身不動（中文組字不能被打斷）
  }
  /* 打字途中不正規化——"1." 這種中間狀態會被改成 1，游標就跳走了。
     值先寬鬆收下，正規化留到 change（失焦）再做 */
  const box = e.target.closest('[data-qty-input]');
  if (box) {
    const n = Number(box.value.trim());
    if (Number.isFinite(n) && n > 0) {
      const id = Number(box.dataset.qtyInput);
      s.picks.set(id, n);
      syncMinus(id, n);
      syncPickBar();
    }
  }
}

function onSheetChange(e) {
  const s = state.sheet;
  if (!s) return;
  const box = e.target.closest('[data-qty-input]');
  if (box) {
    const n = normalizeQty(box.value);
    const id = Number(box.dataset.qtyInput);
    s.picks.set(id, n);
    box.value = String(n);
    syncMinus(id, n);
    syncPickBar();
  }
}

/* ── 寫入 ── */
const val = (id) => $(id)?.value.trim() ?? '';

/* 必填數值：空白或非數字回 NaN，由呼叫端一次擋掉 */
function reqNum(id) {
  const v = val(id);
  return v === '' ? NaN : Number(v);
}

async function withBusy(fn) {
  const s = state.sheet;
  s.busy = true;
  s.err = null;
  renderSheet();
  try {
    await fn();
  } catch (e) {
    if (!state.sheet) return;
    /* 401 時 db() 已經清掉 session，留在 sheet 裡按「重試」只會一直失敗——
       這條路徑要送回登入頁，跟 loadDay／deleteIntake 一致 */
    if (e instanceof AuthError) { closeSheet(); return showLogin('登入已過期，請重新登入'); }
    state.sheet.busy = false;
    state.sheet.err = e.message;
    renderSheet();
  }
}

/* 寫入失敗就地可見、已選不清空、按鈕換「重試」——記錄的地點（美食街、地下室）
   正好收訊最差，按完三秒關掉 app 不會發現沒存進去 */
function submitPicks() {
  const s = state.sheet;
  if (!s.picks.size || s.busy) return;
  return withBusy(async () => {
    const body = [...s.picks].map(([id, qty]) => {
      const f = foodById(id);
      /* 存單份營養快照（不乘 qty）：改食物庫的營養值不該改寫過去的紀錄 */
      return {
        eaten_on: state.date, meal: s.meal, food_id: id, qty,
        kcal: f.kcal, protein: f.protein, fat: f.fat, carb: f.carb,
      };
    });
    const created = await db('intake', { method: 'POST', body, prefer: 'return=representation' });
    /* 常吃排序是開 sheet 時撈的快取。剛記的這幾樣直接提到最前面，
       不必為了排序再打一次 API */
    const recent = state.recent?.get(s.meal);
    if (recent) {
      const ids = [...s.picks.keys()];
      state.recent.set(s.meal, [...ids, ...recent.filter((id) => !ids.includes(id))]);
    }
    closeSheet();
    await loadDay();
    flashRows((created || []).map((r) => r.id));
  });
}

/* 新品項短暫高亮再淡出——回到今日頁只有數字變了，記一個 70 卡的茶葉蛋
   在三秒的一瞥裡不見得注意得到 */
function flashRows(ids) {
  for (const id of ids) {
    document.querySelector(`.item[data-row="${id}"]`)?.classList.add('just-added');
  }
}

function submitFood() {
  const s = state.sheet;
  if (s.busy) return;
  /* 欄位一律在 withBusy 之前讀完——withBusy 會先 renderSheet 把表單 DOM 換掉，
     之後再讀就是讀新畫面的空值（vendor 曾因此靜默存成 null） */
  const name = val('f-name');
  const vendor = val('f-vendor') || null;
  const nums = { kcal: reqNum('f-kcal'), protein: reqNum('f-protein'), fat: reqNum('f-fat'), carb: reqNum('f-carb') };
  if (!name) { s.err = '品名要填'; return renderSheet(); }
  if (Object.values(nums).some((n) => !Number.isFinite(n) || n < 0)) {
    s.err = '熱量與三大營養素都要填數字（0 也可以）';
    return renderSheet();
  }
  return withBusy(async () => {
    const rows = await db('foods', {
      method: 'POST',
      body: { name, vendor, ...nums },
      prefer: 'return=representation',
    });
    const row = rows?.[0];
    /* 沒拿到新列就不能往下選取（會用到 row.id）。食物其實已經建立了，講清楚讓使用者
       重開 sheet 找得到，不要丟一個 TypeError 讓畫面看起來像整件事都失敗 */
    if (!row) throw new Error('食物已建立，但沒拿到回傳資料。重開「記一筆」就能在清單裡找到它。');
    state.foods.push(row);
    state.foods.sort(byName);
    /* 新增完直接選起來，回清單由底部確認列承接——按鈕只承諾「加入食品庫」，
       真正記進 intake 仍要按「加入」，兩件事分開才不會以為記完就關掉 app */
    s.picks.set(row.id, 1);
    s.view = 'list';
    s.q = '';
    s.busy = false;
    renderSheet();
  });
}

function submitWeight() {
  const s = state.sheet;
  if (s.busy) return;
  const kg = reqNum('w-kg');
  const on = val('w-date');
  if (!Number.isFinite(kg) || kg <= 0) { s.err = '體重要填數字'; return renderSheet(); }
  if (!on) { s.err = '量測日要填'; return renderSheet(); }
  const fat = val('w-fat') === '' ? null : Number(val('w-fat'));
  if (fat !== null && !Number.isFinite(fat)) { s.err = '體脂要填數字或留空'; return renderSheet(); }

  return withBusy(async () => {
    /* 同一天再記一次是覆蓋，不是新增一筆——schema 有 unique(user_id, measured_on) */
    await db('weight', {
      method: 'POST',
      body: { measured_on: on, weight_kg: kg, body_fat_pct: fat },
      prefer: 'resolution=merge-duplicates',
    });
    closeSheet();
    load();          // 體重變了，目標要重算
  });
}

function submitProfile() {
  const s = state.sheet;
  if (s.busy) return;
  const p = {
    birth_date: val('p-birth'),
    height_cm: reqNum('p-height'),
    sex: val('p-sex'),
    goal: val('p-goal'),
    activity_factor: reqNum('p-af'),
    protein_pct: reqNum('p-protein'),
    fat_pct: reqNum('p-fat'),
    carb_pct: reqNum('p-carb'),
  };
  if (!p.birth_date) { s.err = '生日要填'; return renderSheet(); }
  if (!Number.isFinite(p.height_cm) || p.height_cm <= 0) { s.err = '身高要填數字'; return renderSheet(); }
  if (!Number.isFinite(p.activity_factor) || p.activity_factor <= 0) {
    s.err = '活動係數要填數字'; return renderSheet();
  }
  const pcts = [p.protein_pct, p.fat_pct, p.carb_pct];
  if (pcts.some((n) => !Number.isFinite(n) || n < 0)) { s.err = '三大比例要填數字'; return renderSheet(); }
  /* schema 有 check 相加 = 100，前端先擋才不會按了儲存才被 DB 退回 */
  if (Math.round(pcts.reduce((a, b) => a + b, 0) * 10) / 10 !== 100) {
    s.err = `三大比例相加要等於 100（目前 ${pcts.reduce((a, b) => a + b, 0)}）`;
    return renderSheet();
  }

  return withBusy(async () => {
    await db(`profile?user_id=eq.${state.profile.user_id}`, { method: 'PATCH', body: p });
    closeSheet();
    load();          // 參數變了，目標要重算
  });
}

/* ── self-check：?check 執行，結果進 console。目標計算是唯一會靜默算錯的地方 ── */
function check() {
  const fail = [];
  const eq = (name, got, want, tol = 0.5) => {
    if (!(Math.abs(got - want) <= tol)) fail.push(`${name}: got ${got}, want ${want}`);
  };
  /* active.md 的定案值：75.95kg → 1860 kcal / P126 / F56 / C214。
     反推 BMR 1690.9 需身高 175 / 年齡 33（profile 實值以 DB 為準，此處只驗公式鏈） */
  const p = { sex: 'male', birth_date: '1993-01-01', height_cm: 175,
              activity_factor: 1.375, goal: 'cut',
              protein_pct: 27, fat_pct: 27, carb_pct: 46 };
  const t = computeTargets(p, 75.95);
  eq('BMR', t.bmr, 10 * 75.95 + 6.25 * 175 - 5 * t.age + 5, 0.01);
  eq('TDEE', t.tdee, t.bmr * 1.375, 0.01);
  eq('kcal', t.kcal, t.tdee * 0.8, 0.01);
  eq('macro 熱量總和', t.protein * 4 + t.fat * 9 + t.carb * 4, t.kcal, 0.01);
  /* 目標 1860 時的三大營養素必須落在 126 / 56 / 214（active.md 定案值） */
  eq('P@1860', 1860 * 0.27 / 4, 126, 0.5);
  eq('F@1860', 1860 * 0.27 / 9, 56, 0.5);
  eq('C@1860', 1860 * 0.46 / 4, 214, 0.5);

  eq('pct 分母 0', pct(10, 0), 0, 0);
  eq('pct NaN', pct(NaN, 100), 0, 0);
  eq('pct 破表夾住', pct(227.9, 214), 100, 0);
  eq('sumIntake 未捨入加總',
    sumIntake([{ qty: 3, kcal: 10.4, protein: 0, fat: 0, carb: 0 }]).kcal, 31.2, 0.001);
  /* 比例改讀 profile，換一組比例目標必須跟著動 */
  const t2 = computeTargets({ ...p, protein_pct: 40, fat_pct: 20, carb_pct: 40 }, 75.95);
  eq('比例讀 profile', t2.protein, t2.kcal * 0.4 / 4, 0.01);
  eq('比例改了熱量不變', t2.kcal, t.kcal, 0.01);

  const d = new Date(2026, 0, 5);
  if (localDate(d) !== '2026-01-05') fail.push(`localDate: got ${localDate(d)}`);
  if (ageOn('1993-07-29', new Date(2026, 6, 28)) !== 32) fail.push('ageOn: 生日前一天應為 32');
  if (ageOn('1993-07-29', new Date(2026, 6, 29)) !== 33) fail.push('ageOn: 生日當天應為 33');

  /* 日期加減要跨月／跨年／閏日，字串直接減會壞 */
  if (shiftDate('2026-03-01', -1) !== '2026-02-28') fail.push('shiftDate: 跨月');
  if (shiftDate('2026-01-01', -1) !== '2025-12-31') fail.push('shiftDate: 跨年');
  if (shiftDate('2024-02-28', 1) !== '2024-02-29') fail.push('shiftDate: 閏日');

  /* 前端先擋掉非正份量，schema 的 check (qty > 0) 只是最後一道 */
  for (const [input, want] of [['', 1], ['0', 1], ['-2', 1], ['abc', 1], ['1.5', 1.5], ['2', 2]]) {
    if (normalizeQty(input) !== want) fail.push(`normalizeQty(${input}): got ${normalizeQty(input)}`);
  }

  console[fail.length ? 'error' : 'log'](
    fail.length ? `self-check FAIL\n${fail.join('\n')}` : 'self-check PASS');
  return fail;
}

/* 精確比對參數名——authorization code 是隨機字串，includes('check') 可能誤中 */
if (new URLSearchParams(location.search).has('check')) check();
else init();
