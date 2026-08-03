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
  -- 2026-08-03 起體脂率會餵進 Katch-McArdle 算 BMR（見 profile 表），不再只是紀錄用途，
  -- 範圍收在生理合理值——0 或 >100 會讓去脂體重算出負數或超過體重本身。
  -- 既有資料庫補這條：alter table weight add constraint weight_body_fat_pct_check
  --   check (body_fat_pct is null or (body_fat_pct >= 3 and body_fat_pct <= 70));
  body_fat_pct numeric(4,1) check (body_fat_pct is null or (body_fat_pct >= 3 and body_fat_pct <= 70)),
  muscle_pct   numeric(4,1),
  waist_cm     numeric(5,1),
  hip_cm       numeric(5,1),
  created_at   timestamptz not null default now(),
  unique (user_id, measured_on)
);

-- 2026-08-03「每日目標」重新設計：年齡只問出生年（少滾一輪 date picker，±1 歲對 BMR 影響可忽略）；
-- 蛋白質改用 g/kg 體重（比固定百分比精準，不會因體重輕重算出不合理的量）；脂肪／碳水的「剩餘熱量」
-- 比例改成寫死在 formulas.ts 的目標對照表，不進 DB——沒有使用者輸入的欄位沒有存在 DB 的理由。
-- rate_kg_per_week 控制減重/增肌每天的熱量差額，goal=maintain 或自訂模式時不使用（留 null）。
-- use_custom_targets 開著時完全繞過公式，直接用 custom_* 四個數字。
-- 既有資料庫遷移：
--   alter table profile add column birth_year smallint;
--   update profile set birth_year = extract(year from birth_date)::smallint;
--   alter table profile alter column birth_year set not null;
--   alter table profile add constraint profile_birth_year_check check (birth_year between 1900 and 2100);
--   alter table profile drop column birth_date;
--   alter table profile add column protein_g_per_kg numeric(3,1) not null default 1.8
--     check (protein_g_per_kg > 0 and protein_g_per_kg <= 5);
--   alter table profile add column rate_kg_per_week numeric(3,2)
--     check (rate_kg_per_week is null or (rate_kg_per_week > 0 and rate_kg_per_week <= 3));
--   -- 補回 goal<>'maintain' 既有使用者的變化速度，不留 null——留 null 會被 formulas.ts
--   -- 的 Number.isFinite 檢查判定成「沒有速度」而悄悄變成維持態的熱量（precommit-review 抓到）。
--   update profile set rate_kg_per_week = 0.5 where goal <> 'maintain';
--   alter table profile drop column protein_pct;
--   alter table profile drop column fat_pct;
--   alter table profile drop column carb_pct;
--   alter table profile add column use_custom_targets boolean not null default false;
--   alter table profile add column custom_kcal numeric(6,1) check (custom_kcal is null or custom_kcal between 0 and 20000);
--   alter table profile add column custom_protein_g numeric(5,1) check (custom_protein_g is null or custom_protein_g between 0 and 2000);
--   alter table profile add column custom_fat_g numeric(5,1) check (custom_fat_g is null or custom_fat_g between 0 and 2000);
--   alter table profile add column custom_carb_g numeric(5,1) check (custom_carb_g is null or custom_carb_g between 0 and 2000);
create table profile (
  user_id            uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  sex                text not null check (sex in ('male','female')),
  birth_year         smallint not null check (birth_year between 1900 and 2100),
  height_cm          numeric(5,1) not null,
  activity_factor    numeric(4,3) not null default 1.375,
  goal               text not null check (goal in ('cut','maintain','bulk')),
  rate_kg_per_week   numeric(3,2) check (rate_kg_per_week is null or (rate_kg_per_week > 0 and rate_kg_per_week <= 3)),
  protein_g_per_kg   numeric(3,1) not null default 1.8 check (protein_g_per_kg > 0 and protein_g_per_kg <= 5),
  use_custom_targets boolean not null default false,
  custom_kcal        numeric(6,1) check (custom_kcal is null or custom_kcal between 0 and 20000),
  custom_protein_g   numeric(5,1) check (custom_protein_g is null or custom_protein_g between 0 and 2000),
  custom_fat_g       numeric(5,1) check (custom_fat_g is null or custom_fat_g between 0 and 2000),
  custom_carb_g      numeric(5,1) check (custom_carb_g is null or custom_carb_g between 0 and 2000)
);

alter table foods   enable row level security;
alter table intake  enable row level security;
alter table weight  enable row level security;
alter table profile enable row level security;

create policy owner_all on foods   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on intake  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on weight  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
