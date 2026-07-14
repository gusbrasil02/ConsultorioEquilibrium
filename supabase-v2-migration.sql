-- ============================================================================
-- Migração v2 — rodar no SQL Editor do Supabase ANTES de subir o novo código.
-- É idempotente (usa IF NOT EXISTS): seguro rodar mais de uma vez.
--
-- Cobre:
--   • Autenticação de profissionais (contas individuais)
--   • Configurações da aplicação (calibração de acupuntura no banco)
--   • Prontuário estruturado por sessão
--   • Financeiro (pagamentos, pacotes pré-pagos, relatório mensal)
-- ============================================================================

-- ── Contas do painel (item 4) ───────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  name          text not null,
  role          text default 'professional',
  created_at    timestamptz default now()
);

-- ── Configurações da aplicação (item 3 — calibração; branding no futuro) ─────
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- ── Prontuário estruturado por sessão (item 7) ──────────────────────────────
alter table sessions
  add column if not exists session_complaint text,  -- queixa / subjetivo
  add column if not exists session_conduct   text,  -- conduta realizada
  add column if not exists session_evolution text,  -- evolução observada
  add column if not exists session_plan      text;  -- plano p/ próxima sessão

-- ── Financeiro (item 6) ─────────────────────────────────────────────────────

-- Pacotes pré-pagos de sessões (ex.: comprou 10, restam 3)
create table if not exists patient_packages (
  id            bigint generated always as identity primary key,
  patient_id    bigint references patients(id) on delete cascade,
  total_sessions int not null,
  used_sessions int default 0,
  amount_paid   numeric(10,2),
  notes         text,
  active        boolean default true,
  purchased_at  date default current_date,
  created_at    timestamptz default now()
);

-- Pagamentos (avulsos, de pacote, por sessão)
create table if not exists payments (
  id             bigint generated always as identity primary key,
  patient_id     bigint references patients(id)          on delete set null,
  appointment_id bigint references appointments(id)      on delete set null,
  session_id     text   references sessions(id)          on delete set null,
  package_id     bigint references patient_packages(id)  on delete set null,
  amount         numeric(10,2) not null,
  method         text,                       -- pix | dinheiro | cartao | transferencia
  status         text default 'pago',        -- pago | pendente
  paid_at        date default current_date,
  notes          text,
  created_at     timestamptz default now()
);

-- Preço/consumo direto no agendamento (fluxo rápido pago/pendente na agenda)
alter table appointments
  add column if not exists price          numeric(10,2),
  add column if not exists payment_status text   default 'pendente',  -- pendente | pago | isento | pacote
  add column if not exists package_id     bigint references patient_packages(id) on delete set null;

-- ── Índices ─────────────────────────────────────────────────────────────────
create index if not exists idx_payments_patient  on payments(patient_id);
create index if not exists idx_payments_paid_at  on payments(paid_at);
create index if not exists idx_packages_patient  on patient_packages(patient_id, active);
create index if not exists idx_users_email       on users(email);
