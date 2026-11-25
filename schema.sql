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
  -- 類型（2026-11-10，spec.md C 節「第三版」）：由 read-label 的分類模式在背景補上，值只會是
  -- src/lib/categories.ts 那張固定清單裡的字。null＝還沒分類（失敗或離線就留著，下次開 app 再補）。
  -- 不加 check 約束：清單之後可能增減，前端讀到清單外的值一律當「其他正餐」。
  -- category_manual＝使用者在食品庫手動改過；AI 補判只寫 category is null and category_manual = false 的列，不覆蓋。
  -- 既有資料庫補這兩欄：
  --   alter table foods add column category text;
  --   alter table foods add column category_manual boolean not null default false;
  -- 回滾：alter table foods drop column category_manual; alter table foods drop column category;
  category        text,
  category_manual boolean not null default false,
  -- 來源、別名（2026-11-22 起，spec.md「食品庫改版」）。verified＝來源只分兩種（2026-11-23 使用者定）：
  -- true＝官方標示（照產品標示或官方資料打的）、false＝粗估（估一筆存的、舊資料沒標的）；aliases 給記一筆搜尋與估一筆比對用。
  -- 2026-11-22 原本是 source（標示／官方／AI 粗估／自己填／未標五值）＋ serving_g（一份幾克），11-23 換掉：
  -- 四種分太細、一份幾克沒有任何讀取端。換法（線上舊版還在讀舊欄，所以刪舊欄排在新前端部署之後）：
  --   alter table foods add column verified boolean not null default false;
  --   update foods set verified = source in ('label','official','manual');
  --   -- 新前端部署、而且每台裝置（含 iOS 主畫面 PWA）都換到新版後——舊版會 select 這兩欄，先刪它就載不出食品庫：
  --   update foods set verified = source in ('label','official','manual')
  --     where not verified and created_at > '2026-11-23T02:00:00Z';  -- 只補加欄位後舊版新建的；新版不寫 source，不限時間會蓋掉部署後手動改成粗估的舊食物
  --   alter table foods drop column serving_g; alter table foods drop column source;
  -- 2026-11-23 晚上已全部執行完：使用者手機換到 v2.159 後，補對應那句改到 0 筆（加欄位後新建的 18 筆都是直接寫入、verified 已設好），兩欄已刪、回讀確認。
  -- 換之前、刪之前每筆的 source／serving_g 都備份在本機 D:\Temp\tally-backup（repo 是 public，不放這裡）。
  -- 別名：alter table foods add column aliases text[] not null default '{}' check (cardinality(aliases) <= 10);
  verified  boolean not null default false,
  aliases   text[] not null default '{}' check (cardinality(aliases) <= 10),
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
  -- 這一筆自己的品名快照（2026-08-11）。null＝沿用 foods.name，是絕大多數紀錄的常態；
  -- 有值代表使用者為這一筆改過名（「雞排便當（去皮）」），食品庫日後改品名不回頭改寫它。
  -- 與上面四個營養快照同一套語意：紀錄的是「當天實際吃的那份」，不是食品庫的現況。
  -- **刻意不回填**——null 的 fallback 就是正確行為，回填只會讓每一筆都無謂地脫鉤。
  -- 既有資料庫補這欄：alter table intake add column name text;
  name       text,
  -- 份量微調（2026-11-23，spec「份量微調＋類型壓縮…」）：這一餐按了哪些（cup:m、sweet:half、top:pearl、rice:half、noodle:less、skin:off）。
  -- kcal 等四個快照存的是調整後的值；前端以固定清單驗證、清單外的忽略。記一筆「照上次」從最近一筆讀。
  -- 既有資料庫補這欄：alter table intake add column mods text[] not null default '{}' check (cardinality(mods) <= 12);
  -- 回滾：alter table intake drop column mods;
  mods       text[] not null default '{}' check (cardinality(mods) <= 12),
  -- 這一餐在哪買（2026-11-23，spec「每一餐記店家」）：當初只有食物本身沒店家（通用食物）時才寫；v2.167（spec「記一筆重做」）起
  -- 記一筆框裡打的店名照記，就算食物本身有店家（同一顆茶葉蛋在全家、7-11 都買）。顯示與餐建議用 intake.vendor ?? foods.vendor（rowVendor）。
  -- 刻意不回填：沒打店名的紀錄不寫這欄，食品庫改店家名照舊連動到那些紀錄。
  -- 既有資料庫補這欄（2026-11-23 已執行）：alter table intake add column vendor text check (vendor is null or char_length(vendor) between 1 and 40);
  -- 回滾：alter table intake drop column vendor;
  vendor     text check (vendor is null or char_length(vendor) between 1 and 40),
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
-- 2026-11-04 起 measured_tdee＝使用者確認過的回推維持熱量（null＝用公式），measured_tdee_on＝確認日；
-- 範圍同 baseline.ts 的 PLAUSIBLE_MAINTENANCE。既有資料庫補這兩欄：
--   alter table profile add column measured_tdee numeric(6,1) check (measured_tdee is null or measured_tdee between 800 and 5000);
--   alter table profile add column measured_tdee_on date;
-- 2026-11-15 起 measured_tdee_prev＝上一次變動前的值（「還原」用；每週自動調整，spec「每日目標省心」）。既有資料庫補：
--   alter table profile add column measured_tdee_prev numeric(6,1) check (measured_tdee_prev is null or measured_tdee_prev between 800 and 5000);
-- 2026-11-24 起 goal_weight_kg＝目標體重（spec「每日目標改版」）：null＝還沒設，方向照舊看 goal；設了之後存檔時由它推方向寫回 goal
-- （差不到 0.5 kg＝maintain），computeTargets 照舊只讀 goal。既有資料庫補（2026-11-24 已執行）：
--   alter table profile add column goal_weight_kg numeric(4,1) check (goal_weight_kg is null or goal_weight_kg between 30 and 250);
--   回滾：alter table profile drop column goal_weight_kg;
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
  custom_carb_g      numeric(5,1) check (custom_carb_g is null or custom_carb_g between 0 and 2000),
  measured_tdee      numeric(6,1) check (measured_tdee is null or measured_tdee between 800 and 5000),
  measured_tdee_on   date,
  measured_tdee_prev numeric(6,1) check (measured_tdee_prev is null or measured_tdee_prev between 800 and 5000),
  goal_weight_kg     numeric(4,1) check (goal_weight_kg is null or goal_weight_kg between 30 and 250)
);

alter table foods   enable row level security;
alter table intake  enable row level security;
alter table weight  enable row level security;
alter table profile enable row level security;

create policy owner_all on foods   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on intake  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on weight  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 這一餐沒吃（2026-11-24，spec「熱量看這一週」）：早、午、晚餐空著時使用者按「沒吃」才寫；這週卡把那餐算 0、不再問「沒記完」。
-- 那餐之後有了紀錄就不算（前端判斷，不刪這筆）。點心不問、不寫。2026-11-24 已建（anon 讀回空、寫入被 RLS 擋，已驗）。
-- 回滾：drop table meal_skip;
create table meal_skip (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_on   date not null,
  meal       text not null check (meal in ('breakfast','lunch','dinner')),
  created_at timestamptz not null default now(),
  primary key (user_id, eaten_on, meal)
);
alter table meal_skip enable row level security;
create policy owner_all on meal_skip for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
