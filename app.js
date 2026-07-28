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

async function db(path) {
  const token = await validToken();
  if (!token) throw new AuthError('no session');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  /* RLS 擋下的讀取回的是 200 ＋ []，不是錯誤。真正的「沒有 session」只會是 401，
     兩者必須分開——否則 token 過期時今日頁會安靜地長成「今天什麼都沒吃」。 */
  if (res.status === 401 || res.status === 403) { session.clear(); throw new AuthError('expired'); }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
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

/* Mifflin-St Jeor → ×活動係數 → 目標調整。三大比例 27/27/46（active.md 已反推確認） */
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
    protein: kcal * 0.27 / 4,
    fat:     kcal * 0.27 / 9,
    carb:    kcal * 0.46 / 4,
  };
}

/* 小計一律由未捨入值加總，只在顯示時捨入 */
function sumIntake(rows) {
  const t = { kcal: 0, protein: 0, fat: 0, carb: 0 };
  for (const r of rows) {
    const f = r.foods, q = num(r.qty);
    if (!f) continue;   // embed 失敗時寧可少算一筆，也別讓整頁掛掉
    t.kcal    += num(f.kcal) * q;
    t.protein += num(f.protein) * q;
    t.fat     += num(f.fat) * q;
    t.carb    += num(f.carb) * q;
  }
  return t;
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
        const qty = q === 1 ? '' : ` <span class="qty">×${String(q)}</span>`;
        return `<li class="item"><span class="nm">${esc(r.foods.name)}${qty}</span>`
          + `<span class="kc">${Math.round(num(r.foods.kcal) * q)}</span></li>`;
      }).join('');
      body = `<div class="node-head"><span class="node-name">${meal.label}</span>`
        + `<span class="node-kcal">${kcal}</span></div><ul class="items">${lis}</ul>`;
    } else {
      // ponytail: 記錄流程尚未實作，入口先 disabled。接上「記一筆」時移除 disabled 並綁 meal。
      body = `<button class="todo-row" disabled data-meal="${meal.key}"><span class="lb">${meal.label}</span>`
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
  $('gauge-lead').textContent = over ? '超出' : '還能吃';
  $('gauge-num').textContent = String(Math.abs(diff));
  $('gauge-fill').style.width = pct(eaten.kcal, targets.kcal) + '%';

  const side = $('gauge-side');
  side.setAttribute('aria-label', `已攝取 ${eatenKcal} 大卡，目標 ${targetKcal} 大卡`);
  side.innerHTML = `<span aria-hidden="true"><span class="cur">${eatenKcal}</span>`
    + `<span class="sep">/</span><span class="tgt">${targetKcal}</span></span>`;

  renderMacro('protein', eaten.protein, targets.protein);
  renderMacro('fat',     eaten.fat,     targets.fat);
  renderMacro('carb',    eaten.carb,    targets.carb);
  renderTimeline(rows);
  showPane('today');
}

function renderSettings(targets, profile, weight) {
  const kv = (k, v) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
  const goal = { cut: '減重', maintain: '維持', bulk: '增肌' }[profile.goal] || profile.goal;

  $('pane-settings').innerHTML = `
    <h2>今日目標</h2>
    <dl>
      ${kv('熱量', `${Math.round(targets.kcal)} kcal`)}
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
      ${kv('BMR', `${Math.round(targets.bmr)} kcal`)}
      ${kv('活動係數', String(num(profile.activity_factor)))}
      ${kv('TDEE', `${Math.round(targets.tdee)} kcal`)}
      ${kv('目標', goal)}
    </dl>
    <p class="note">Mifflin-St Jeor 公式算 BMR，乘活動係數得 TDEE，減重再乘 0.8。三大營養素按 27 / 27 / 46 拆分。體重取最新一筆，數值變動時目標會跟著動。</p>
    <button class="signout" id="btn-signout">登出</button>`;
  $('btn-signout').onclick = signOut;
}

/* ═══════════ 啟動 ═══════════ */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('page-title').textContent = tab === 'settings' ? '設定' : '今天';
  $('page-date').hidden = tab === 'settings';
  showPane(tab);
}

async function load() {
  /* 主數字停在破折號、時間軸明說載入中——「讀到空」和「還沒讀到」在畫面上必須分得開，
     否則弱訊號那 1–3 秒看起來就是「今天什麼都沒吃」 */
  $('timeline').innerHTML = '<p class="muted">載入中…</p>';
  showPane('today');

  let profile, weights, rows;
  try {
    [profile, weights, rows] = await Promise.all([
      db('profile?select=*&limit=1'),
      db('weight?select=weight_kg,measured_on&order=measured_on.desc&limit=1'),
      db(`intake?eaten_on=eq.${localDate()}&select=id,meal,qty,foods(name,kcal,protein,fat,carb)&order=created_at.asc`),
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

  renderToday(targets, rows);
  renderSettings(targets, p, w);
  $('btn-add').disabled = true;   // ponytail: 記錄流程做完後解開
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
  const d = new Date();
  $('page-date').textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  load();
}

function init() {
  $('btn-signin').onclick = signIn;
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => switchTab(b.dataset.tab);
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

/* ── self-check：?check 執行，結果進 console。目標計算是唯一會靜默算錯的地方 ── */
function check() {
  const fail = [];
  const eq = (name, got, want, tol = 0.5) => {
    if (!(Math.abs(got - want) <= tol)) fail.push(`${name}: got ${got}, want ${want}`);
  };
  /* active.md 的定案值：75.95kg → 1860 kcal / P126 / F56 / C214。
     反推 BMR 1690.9 需身高 175 / 年齡 33（profile 實值以 DB 為準，此處只驗公式鏈） */
  const p = { sex: 'male', birth_date: '1993-01-01', height_cm: 175,
              activity_factor: 1.375, goal: 'cut' };
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
    sumIntake([{ qty: 3, foods: { kcal: 10.4, protein: 0, fat: 0, carb: 0 } }]).kcal, 31.2, 0.001);

  const d = new Date(2026, 0, 5);
  if (localDate(d) !== '2026-01-05') fail.push(`localDate: got ${localDate(d)}`);
  if (ageOn('1993-07-29', new Date(2026, 6, 28)) !== 32) fail.push('ageOn: 生日前一天應為 32');
  if (ageOn('1993-07-29', new Date(2026, 6, 29)) !== 33) fail.push('ageOn: 生日當天應為 33');

  console[fail.length ? 'error' : 'log'](
    fail.length ? `self-check FAIL\n${fail.join('\n')}` : 'self-check PASS');
  return fail;
}

/* 精確比對參數名——authorization code 是隨機字串，includes('check') 可能誤中 */
if (new URLSearchParams(location.search).has('check')) check();
else init();
