-- Bert Platform — Supabase schema
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query)

-- ─────────────────────────────────────────────
-- BUSINESSES
-- Each row = one client company using the platform
-- ─────────────────────────────────────────────
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  primary_color text default '#0F6E56',
  secondary_color text default '#BA7517',
  assistant_name text default 'Bert',
  industry text,
  message_limit int default 100,        -- messages allowed per period
  messages_used int default 0,          -- resets each period
  period_start date default current_date,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- BUSINESS_USERS
-- Links an auth.users row to a business, with a role
-- ─────────────────────────────────────────────
create table business_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('owner', 'developer', 'user')),
  privacy_acknowledged boolean default false,
  created_at timestamptz default now(),
  unique(business_id, user_id)
);

-- Enables vector similarity search, so chat only pulls in relevant knowledge
-- instead of the entire knowledge base on every question.
create extension if not exists vector;

-- ─────────────────────────────────────────────
-- KNOWLEDGE_CHUNKS
-- The actual knowledge base content, from interviews or uploaded files
-- ─────────────────────────────────────────────
create table knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  content text not null,
  source text not null check (source in ('interview', 'file')),
  source_detail text,                    -- e.g. filename, or interviewee's role
  embedding vector(1536),                -- from OpenAI's text-embedding-3-small
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Speeds up similarity search once there are more than a few hundred chunks.
-- Harmless to have from the start.
create index on knowledge_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Given a business and a question's embedding, returns the closest-matching
-- chunks for that business only — this is what replaces "select every chunk".
create or replace function match_knowledge_chunks(
  target_business_id uuid,
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, content text)
language sql stable
as $$
  select id, content
  from knowledge_chunks
  where business_id = target_business_id
  and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ─────────────────────────────────────────────
-- INTERVIEW_SESSIONS
-- Tracks each Bert-style interview conversation
-- ─────────────────────────────────────────────
create table interview_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  messages jsonb default '[]'::jsonb,    -- [{role, content}, ...]
  status text default 'in_progress' check (status in ('in_progress', 'completed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- KNOWLEDGE_GAPS
-- Things the assistant is missing — from upfront checks or real usage
-- ─────────────────────────────────────────────
create table knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  topic text not null,
  source text not null check (source in ('upfront', 'usage')),
  status text default 'open' check (status in ('open', 'resolved')),
  occurrence_count int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- CHAT_MESSAGES
-- Every chat exchange — powers usage tracking and gap detection
-- ─────────────────────────────────────────────
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  question text not null,
  answer text not null,
  confidence text check (confidence in ('high', 'low')),
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Every table is scoped to the businesses a user belongs to
-- ─────────────────────────────────────────────
alter table businesses enable row level security;
alter table business_users enable row level security;
alter table knowledge_chunks enable row level security;
alter table interview_sessions enable row level security;
alter table knowledge_gaps enable row level security;
alter table chat_messages enable row level security;

-- Helper: is the current user a member of this business?
create or replace function is_member_of(target_business_id uuid)
returns boolean as $$
  select exists (
    select 1 from business_users
    where business_id = target_business_id
    and user_id = auth.uid()
  );
$$ language sql security definer;

-- Helper: is the current user an owner/developer of this business?
create or replace function is_developer_of(target_business_id uuid)
returns boolean as $$
  select exists (
    select 1 from business_users
    where business_id = target_business_id
    and user_id = auth.uid()
    and role in ('owner', 'developer')
  );
$$ language sql security definer;

create policy "members can view their business" on businesses
  for select using (is_member_of(id));

create policy "owners can update their business" on businesses
  for update using (is_developer_of(id));

create policy "members can view their business_users rows" on business_users
  for select using (is_member_of(business_id));

create policy "developers can manage business_users" on business_users
  for all using (is_developer_of(business_id));

create policy "developers can view knowledge_chunks" on knowledge_chunks
  for select using (is_developer_of(business_id));

create policy "developers can insert knowledge_chunks" on knowledge_chunks
  for insert with check (is_developer_of(business_id));

create policy "members can view own interview_sessions" on interview_sessions
  for select using (user_id = auth.uid());

create policy "members can manage own interview_sessions" on interview_sessions
  for all using (user_id = auth.uid());

create policy "developers can view knowledge_gaps" on knowledge_gaps
  for select using (is_developer_of(business_id));

create policy "developers can update knowledge_gaps" on knowledge_gaps
  for update using (is_developer_of(business_id));

create policy "members can view own chat_messages" on chat_messages
  for select using (user_id = auth.uid());

-- Note: inserts to knowledge_gaps, chat_messages, and messages_used updates
-- happen via the Netlify functions using the service role key, which bypasses
-- RLS by design — that's where usage caps and gap-logging are enforced server-side.
