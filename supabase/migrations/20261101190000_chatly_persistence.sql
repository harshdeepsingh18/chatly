create table if not exists public.chatly_profiles (
  user_id text primary key,
  username text not null,
  username_normalized text not null unique,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.chatly_conversations (
  id text primary key,
  kind text not null check (kind in ('room', 'direct', 'group')),
  member_ids text[] not null default '{}',
  record jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.chatly_messages (
  id text primary key,
  conversation_id text not null references public.chatly_conversations(id) on delete cascade,
  sender_id text,
  created_at bigint not null,
  record jsonb not null
);

create index if not exists chatly_messages_conversation_time_idx
  on public.chatly_messages (conversation_id, created_at, id);

create table if not exists public.chatly_app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.chatly_profiles enable row level security;
alter table public.chatly_conversations enable row level security;
alter table public.chatly_messages enable row level security;
alter table public.chatly_app_state enable row level security;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chatly-uploads', 'chatly-uploads', false, 12582912)
on conflict (id) do nothing;
