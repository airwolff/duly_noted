-- Scaffold migration. Establishes connectivity check and Stage 5 pass-1
-- minimum-viable schema. RLS is enabled on every table; real business
-- policies arrive in Stage 5 pass 2 after Slice 2.

-- ---------------------------------------------------------------------------
-- Connectivity check (anon-readable)
-- ---------------------------------------------------------------------------

create table public._scaffold_health (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_at timestamptz not null default now()
);

alter table public._scaffold_health enable row level security;

create policy "anon can read scaffold health"
  on public._scaffold_health
  for select
  to anon, authenticated
  using (true);

insert into public._scaffold_health (message) values ('scaffold ok');

-- ---------------------------------------------------------------------------
-- Stage 5 pass-1: tenant + meeting skeleton. RLS enabled, no business
-- policies yet (default deny).
-- ---------------------------------------------------------------------------

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.publications enable row level security;

create table public.towns (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.publications(id) on delete restrict,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (publication_id, slug)
);
alter table public.towns enable row level security;

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  town_id uuid not null references public.towns(id) on delete restrict,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (town_id, slug)
);
alter table public.boards enable row level security;

create type public.meeting_status as enum (
  'discovered',
  'pending',
  'extracting',
  'transcribing',
  'segmenting',
  'summarizing',
  'review',
  'published',
  'failed'
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete restrict,
  status public.meeting_status not null default 'discovered',
  youtube_id text,
  meeting_date date,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meetings enable row level security;

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null references public.publications(id) on delete cascade,
  role text not null check (role in ('reader', 'editor', 'admin')),
  created_at timestamptz not null default now(),
  unique (user_id, publication_id)
);
alter table public.memberships enable row level security;
