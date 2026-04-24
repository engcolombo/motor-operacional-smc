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
