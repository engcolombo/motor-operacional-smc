-- Execute uma vez no SQL Editor do MESMO projeto Supabase do diário.
-- Registros compactos: estratégia, resultado em R e marcadores de exclusão.
create table if not exists public.backtest_entries (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    payload jsonb not null,
    created_at timestamptz not null default now()
);
create index if not exists backtest_entries_user_idx on public.backtest_entries(user_id);
alter table public.backtest_entries enable row level security;
grant select, insert, update on public.backtest_entries to authenticated;
drop policy if exists "backtests_select_own" on public.backtest_entries;
create policy "backtests_select_own" on public.backtest_entries for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "backtests_insert_own" on public.backtest_entries;
create policy "backtests_insert_own" on public.backtest_entries for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "backtests_update_own" on public.backtest_entries;
create policy "backtests_update_own" on public.backtest_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Exclusões são marcadas no payload para não reaparecerem em dispositivos offline.
-- Uma exclusão já sincronizada nunca deve ser revertida por um cliente antigo.
create or replace function public.preserve_backtest_deletion() returns trigger
language plpgsql set search_path = public as $$
begin
    if old.payload->>'deleted' = 'true' then
        new.payload = jsonb_set(new.payload, '{deleted}', 'true'::jsonb);
    end if;
    return new;
end;
$$;
drop trigger if exists preserve_backtest_deletion on public.backtest_entries;
create trigger preserve_backtest_deletion before update on public.backtest_entries
for each row execute function public.preserve_backtest_deletion();
