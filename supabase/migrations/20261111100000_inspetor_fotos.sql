-- Inspetor e fotos de evidência da blitz.
-- Idempotente: pode rodar mais de uma vez.
--
-- inspetor: nome de quem fez a inspeção (texto livre, o app de campo não tem login).
-- fotos:    lista com os caminhos das fotos no bucket privado "evidencias".
--           Cada foto é enviada antes da blitz e só é vinculada a ela no registro.

alter table public.blitzes add column if not exists inspetor text;
alter table public.blitzes add column if not exists fotos jsonb not null default '[]'::jsonb;

-- Bucket privado: as fotos são vistas no painel por link assinado de curta duração.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidencias', 'evidencias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
