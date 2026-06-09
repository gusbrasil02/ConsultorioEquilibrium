-- Rodar este SQL no painel do Supabase (SQL Editor) para atualizar o sistema de sessões

-- Adiciona colunas de controle de fluxo à tabela sessions
alter table sessions
  add column if not exists status text default 'waiting',
  add column if not exists patient_id bigint references patients(id) on delete set null,
  add column if not exists appointment_id bigint references appointments(id) on delete set null,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

-- Índice para busca rápida por status (polling do totem e dashboard)
create index if not exists idx_sessions_status on sessions(status);
create index if not exists idx_sessions_appointment on sessions(appointment_id);

-- Atualiza sessões antigas para status compatível
update sessions set status = 'finished' where completed_at is not null and notified = true;
update sessions set status = 'waiting'  where completed_at is not null and notified = false;

-- Adiciona colunas de anotações pós-sessão
alter table sessions
  add column if not exists session_notes text,
  add column if not exists session_observations text;
