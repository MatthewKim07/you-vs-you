# Auth Setup (Supabase)

This project supports:

- **Guest mode**: play immediately, progress is not saved after leaving.
- **Account mode**: sign up/sign in with email+password, progress persists.

## 1) Create Supabase project

1. Go to [Supabase](https://supabase.com/), create a new project.
2. In project settings, copy:
   - `Project URL`
   - `anon public key`

## 2) Create env file

Copy `.env.example` to `.env` and fill values:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_PUBLIC_KEY
```

Restart dev server after changing env values.

## 3) Create progress table

In Supabase SQL editor, run:

```sql
create table if not exists public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  highest_level_unlocked integer not null default 1,
  runs_json jsonb not null default '[]'::jsonb,
  shop_state_json jsonb not null default '{}'::jsonb,
  infinite_best_score integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_progress enable row level security;

create policy "Users can read own progress"
  on public.player_progress
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own progress"
  on public.player_progress
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own progress"
  on public.player_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

If your table already exists, run this patch:

```sql
alter table public.player_progress
  add column if not exists shop_state_json jsonb not null default '{}'::jsonb,
  add column if not exists infinite_best_score integer not null default 0;
```

## 4) Auth provider settings

Enable **Email** provider in `Authentication -> Providers`.

If email confirmation is enabled, users must confirm before first sign-in.

## 5) Run app

```bash
npm run dev
```

On the start menu:

- click **Play as Guest** for non-persistent play.
- use **Sign Up / Sign In** to persist progress across sessions.

