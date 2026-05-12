create table if not exists public.trades (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    payload jsonb not null,
    trade_timestamp timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.trades enable row level security;

drop policy if exists "Users can view own trades" on public.trades;
create policy "Users can view own trades"
on public.trades
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own trades" on public.trades;
create policy "Users can insert own trades"
on public.trades
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own trades" on public.trades;
create policy "Users can update own trades"
on public.trades
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own trades" on public.trades;
create policy "Users can delete own trades"
on public.trades
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- =====================================================
-- Diário Pro (tabela separada, mesmo login)
-- =====================================================
create table if not exists public.trades_pro (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    payload jsonb not null,
    trade_timestamp timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.trades_pro enable row level security;

drop policy if exists "Users can view own trades_pro" on public.trades_pro;
create policy "Users can view own trades_pro"
on public.trades_pro
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own trades_pro" on public.trades_pro;
create policy "Users can insert own trades_pro"
on public.trades_pro
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own trades_pro" on public.trades_pro;
create policy "Users can update own trades_pro"
on public.trades_pro
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own trades_pro" on public.trades_pro;
create policy "Users can delete own trades_pro"
on public.trades_pro
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- =====================================================
-- Settings por usuario (taxas e preferencias)
-- =====================================================
create table if not exists public.user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    payload jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users can view own settings" on public.user_settings;
create policy "Users can view own settings"
on public.user_settings
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own settings" on public.user_settings;
create policy "Users can insert own settings"
on public.user_settings
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own settings" on public.user_settings;
create policy "Users can update own settings"
on public.user_settings
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
