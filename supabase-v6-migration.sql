-- ============================================================================
-- Migração v6 — rodar no SQL Editor do Supabase.
-- Idempotente: seguro rodar mais de uma vez.
--
-- Ficha de avaliação (fisioterapia + bloco MTC opcional):
--   • uma linha por avaliação/reavaliação, datada, ligada ao paciente
--   • opcionalmente ligada à sessão em que foi feita
--   • os campos da ficha ficam em "data" (jsonb) — dá para acrescentar
--     perguntas novas no formulário sem mexer no banco
-- Sem esta tabela o resto do sistema continua funcionando — só a ficha avisa.
-- ============================================================================

create table if not exists evaluations (
  id          bigint generated always as identity primary key,
  patient_id  bigint references patients(id) on delete cascade,
  session_id  text   references sessions(id) on delete set null,
  kind        text default 'avaliacao',        -- avaliacao | reavaliacao
  eval_date   date default current_date,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_evaluations_patient on evaluations(patient_id, eval_date desc);
