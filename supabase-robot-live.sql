-- Execute uma vez no SQL Editor do Supabase (mesmo projeto do Diário Pro+).
-- Cria a tabela para telemetria ao vivo do robô Python/MetaTrader 5 e comandos de emergência.

create table if not exists public.robot_live_status (
    user_id uuid primary key references auth.users (id) on delete cascade,
    telemetry jsonb not null default '{}'::jsonb,
    telemetry_updated_at timestamptz,
    control jsonb not null default '{"paused": false, "flatten_seq": 0, "reason": "", "updated_at": null}'::jsonb,
    control_updated_at timestamptz,
    control_ack jsonb not null default '{"paused": false, "last_flatten_seq": 0, "ack_at": null, "note": ""}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.robot_live_status enable row level security;
alter table public.robot_live_status force row level security;

revoke all on public.robot_live_status from anon;
grant select, insert, update, delete on public.robot_live_status to authenticated;

drop policy if exists robot_live_select_own on public.robot_live_status;
create policy robot_live_select_own
    on public.robot_live_status
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists robot_live_insert_own on public.robot_live_status;
create policy robot_live_insert_own
    on public.robot_live_status
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists robot_live_update_own on public.robot_live_status;
create policy robot_live_update_own
    on public.robot_live_status
    for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

drop policy if exists robot_live_delete_own on public.robot_live_status;
create policy robot_live_delete_own
    on public.robot_live_status
    for delete
    to authenticated
    using ((select auth.uid()) = user_id);
