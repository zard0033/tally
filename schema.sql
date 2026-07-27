-- Tally schema v1
-- Supabase Dashboard → SQL Editor → 貼上 → Run

create table foods (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  serving    text,
  kcal       numeric(7,2) not null,
  protein    numeric(6,2) not null,
  fat        numeric(6,2) not null,
  carb       numeric(6,2) not null,
  vendor     text,
  category   text,
  created_at timestamptz not null default now()
);

-- ponytail: food_id 用 restrict 擋掉「刪掉還有紀錄的食物」。代價是刪 auth 帳號時
-- cascade 可能卡住；第一版沒有刪帳號流程，真要刪就先手動清 intake。
create table intake (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_on   date not null,
  meal       text not null check (meal in ('breakfast','lunch','dinner','snack')),
  food_id    bigint not null references foods(id) on delete restrict,
  qty        numeric(6,2) not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index intake_user_date_idx on intake (user_id, eaten_on);

create table weight (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null,
  weight_kg   numeric(5,2) not null check (weight_kg > 0),
  body_fat    numeric(4,1),
  created_at  timestamptz not null default now(),
  unique (user_id, measured_on)
);

create table profile (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  sex             text not null check (sex in ('male','female')),
  birth_date      date not null,
  height_cm       numeric(5,1) not null,
  activity_factor numeric(3,2) not null default 1.375,
  goal            text not null check (goal in ('cut','maintain','bulk'))
);

alter table foods   enable row level security;
alter table intake  enable row level security;
alter table weight  enable row level security;
alter table profile enable row level security;

create policy owner_all on foods   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on intake  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on weight  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_all on profile for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
