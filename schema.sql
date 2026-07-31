-- Tally schema v2
-- Supabase Dashboard → SQL Editor → 貼上 → Run

create table foods (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  kcal       numeric(7,2) not null,
  protein    numeric(6,2) not null,
  fat        numeric(6,2) not null,
  carb       numeric(6,2) not null,
  vendor     text,
  -- soft delete（2026-07-31）：封存的食物不再出現在記一筆的搜尋清單，但 intake 仍 join 得到
  -- 它的品名與店家，歷史紀錄不會爛掉。這是 food_id 用 on delete restrict 的配套解法——
  -- 真刪不可行（會擋住或毀掉歷史），所以改成不刪。
  -- 既有資料庫補這欄：alter table foods add column archived boolean not null default false;
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

-- ponytail: food_id 用 restrict 擋掉「刪掉還有紀錄的食物」。代價是刪 auth 帳號時
-- cascade 可能卡住；第一版沒有刪帳號流程，真要刪就先手動清 intake。
--
-- kcal/protein/fat/carb 是「當時那份」的營養快照（從 foods 複製過來的單份值，
-- 非乘 qty 後的值；乘 qty 是顯示時算），用來讓熱量對帳不隨食物庫日後修改而改寫歷史。
create table intake (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_on   date not null,
  meal       text not null check (meal in ('breakfast','lunch','dinner','snack')),
  food_id    bigint not null references foods(id) on delete restrict,
  qty        numeric(6,2) not null check (qty > 0),
  kcal       numeric(7,2) not null,
  protein    numeric(6,2) not null,
  fat        numeric(6,2) not null,
  carb       numeric(6,2) not null,
  created_at timestamptz not null default now()
);
create index intake_user_date_idx on intake (user_id, eaten_on);

-- 體重／體脂直接存體脂計讀數，不做校正。固定偏移不改變趨勢斜率，
-- 對目標熱量的影響約 20 kcal（<1%），小於食品標示本身容許的誤差。
create table weight (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on  date not null,
  weight_kg    numeric(5,2) not null check (weight_kg > 0),
  body_fat_pct numeric(4,1),
  muscle_pct   numeric(4,1),
  waist_cm     numeric(5,1),
  hip_cm       numeric(5,1),
  created_at   timestamptz not null default now(),
  unique (user_id, measured_on)
);

-- protein_pct/fat_pct/carb_pct 原本寫死在 app.js，改成使用者可在設定頁調整
-- （例如減脂期想調高蛋白），check 確保三者相加等於 100。
create table profile (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  sex             text not null check (sex in ('male','female')),
  birth_date      date not null,
  height_cm       numeric(5,1) not null,
  activity_factor numeric(4,3) not null default 1.375,
  goal            text not null check (goal in ('cut','maintain','bulk')),
  protein_pct     numeric(4,1) not null default 27,
  fat_pct         numeric(4,1) not null default 27,
  carb_pct        numeric(4,1) not null default 46,
  check (protein_pct + fat_pct + carb_pct = 100)
);

alter table foods   enable row level security;
alter table intake  enable row level security;
alter table weight  enable row level security;
alter table profile enable row level security;

create policy owner_all on foods   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on intake  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on weight  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
