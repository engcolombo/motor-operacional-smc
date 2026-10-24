-- Run once in the SQL Editor of the same Supabase project used by the Diary.
-- Never paste a real API key into this migration or commit it to Git.
begin;
create table if not exists public.mentor_credentials (
    user_id uuid primary key references auth.users(id) on delete cascade,
    api_key text not null check (length(api_key) between 20 and 300),
    model text not null check (model ~ '^gemini-[a-z0-9.-]{2,70}$'),
    updated_at timestamptz not null default now()
);
alter table public.mentor_credentials enable row level security;
alter table public.mentor_credentials force row level security;
revoke all on public.mentor_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.mentor_credentials to authenticated;
drop policy if exists "Own mentor credentials" on public.mentor_credentials;
create policy "Own mentor credentials" on public.mentor_credentials
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
commit;
