-- Execute uma vez no SQL Editor do mesmo projeto Supabase do Diário Pro.
-- Bucket privado: só o dono do trade pode enviar, ver ou remover imagens.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'trade-attachments',
    'trade-attachments',
    false,
    20971520,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "trade_attachments_select_own" on storage.objects;
create policy "trade_attachments_select_own"
on storage.objects for select to authenticated
using (
    bucket_id = 'trade-attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "trade_attachments_insert_own" on storage.objects;
create policy "trade_attachments_insert_own"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'trade-attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "trade_attachments_update_own" on storage.objects;
create policy "trade_attachments_update_own"
on storage.objects for update to authenticated
using (
    bucket_id = 'trade-attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
    bucket_id = 'trade-attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "trade_attachments_delete_own" on storage.objects;
create policy "trade_attachments_delete_own"
on storage.objects for delete to authenticated
using (
    bucket_id = 'trade-attachments'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);
