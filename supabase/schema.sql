-- =====================================================================
--  Le Guide Chèvre-Miel — schéma Supabase
--  À coller tel quel dans : Supabase > SQL Editor > New query > Run
--  ⚠️ Change le code secret à la ligne marquée « CHANGE-MOI » avant de lancer.
-- =====================================================================

-- ---------- Tables --------------------------------------------------

create table if not exists public.restos (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 200),
  address     text,
  lat         double precision not null,
  lon         double precision not null,
  osm_id      text,                       -- identifiant OpenStreetMap si trouvé via la recherche
  created_at  timestamptz not null default now()
);

create table if not exists public.pizzas (
  id          uuid primary key default gen_random_uuid(),
  resto_id    uuid not null references public.restos(id) on delete cascade,
  name        text not null default 'Chèvre-miel',
  note        numeric(3,1) not null check (note >= 0 and note <= 10),
  chevre      smallint check (chevre between 1 and 5),
  miel        smallint check (miel between 1 and 5),
  pate        smallint check (pate between 1 and 5),
  prix        numeric(6,2) check (prix >= 0),
  eaten_on    date not null default current_date,
  comment     text check (char_length(comment) <= 4000),
  thumb       text,                       -- miniature JPEG en data URL (~15 Ko)
  created_at  timestamptz not null default now()
);
create index if not exists pizzas_resto_idx on public.pizzas(resto_id);

-- Photo pleine taille séparée, chargée seulement quand on ouvre la fiche
create table if not exists public.photos (
  pizza_id    uuid primary key references public.pizzas(id) on delete cascade,
  data        text not null               -- JPEG en data URL (~150 Ko)
);

-- ---------- Code secret --------------------------------------------
-- Schéma « private » : non exposé par l'API, donc illisible depuis le web.

create schema if not exists private;

create table if not exists private.secret (
  id   boolean primary key default true check (id),   -- une seule ligne
  pin  text not null
);

insert into private.secret (id, pin)
values (true, 'CHANGE-MOI')                -- 👈 mets ici le code secret (une phrase, pas 4 chiffres)
on conflict (id) do update set pin = excluded.pin;

-- Vrai si la requête porte le bon code dans l'en-tête HTTP « x-pin ».
-- security definer : la fonction lit private.secret, l'appelant ne le peut pas.
create or replace function public.is_chef()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (current_setting('request.headers', true)::json ->> 'x-pin')
      = (select pin from private.secret where id),
    false
  );
$$;

revoke all on function public.is_chef() from public;
grant execute on function public.is_chef() to anon, authenticated;

-- ---------- Droits & sécurité (RLS) -------------------------------
-- Lecture : tout le monde. Écriture : seulement avec le bon code.

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.restos, public.pizzas, public.photos to anon, authenticated;

alter table public.restos enable row level security;
alter table public.pizzas enable row level security;
alter table public.photos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['restos','pizzas','photos'] loop
    execute format('drop policy if exists "lecture publique" on public.%I', t);
    execute format('drop policy if exists "ajout chef" on public.%I', t);
    execute format('drop policy if exists "modif chef" on public.%I', t);
    execute format('drop policy if exists "suppression chef" on public.%I', t);

    execute format('create policy "lecture publique" on public.%I for select using (true)', t);
    execute format('create policy "ajout chef" on public.%I for insert with check ((select public.is_chef()))', t);
    execute format('create policy "modif chef" on public.%I for update using ((select public.is_chef())) with check ((select public.is_chef()))', t);
    execute format('create policy "suppression chef" on public.%I for delete using ((select public.is_chef()))', t);
  end loop;
end $$;

-- ---------- Ping anti-mise-en-veille -------------------------------
-- Appelée par le workflow GitHub Actions tous les 3 jours.
create or replace function public.ping()
returns text language sql stable as $$ select 'miam' $$;
grant execute on function public.ping() to anon;

-- Pour changer le code secret plus tard :
--   update private.secret set pin = 'nouvelle phrase secrète' where id;
