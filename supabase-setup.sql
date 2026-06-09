-- Rodar este SQL no painel do Supabase (SQL Editor) antes de iniciar o sistema

create table sessions (
  id text primary key,
  patient_name text not null,
  created_at timestamptz default now(),
  completed_at timestamptz,
  notified boolean default false,
  expires_at timestamptz default now() + interval '24 hours'
);

create table answers (
  id bigint generated always as identity primary key,
  session_id text references sessions(id) on delete cascade,
  question_key text not null,
  answer_value text not null,
  created_at timestamptz default now()
);

create table anatomy_events (
  id bigint generated always as identity primary key,
  session_id text references sessions(id) on delete cascade,
  region text not null,
  problem text not null,
  ai_explanation text,
  created_at timestamptz default now()
);

-- Índices para performance nas queries mais frequentes
create index idx_sessions_expires on sessions(expires_at);
create index idx_sessions_notified on sessions(notified, completed_at);
create index idx_answers_session on answers(session_id);
create index idx_anatomy_session on anatomy_events(session_id, created_at desc);
