-- ============================================================================
-- Migração v3 — rodar no SQL Editor do Supabase.
-- Idempotente: seguro rodar mais de uma vez.
--
-- Corrige a desconexão do financeiro e habilita agenda recorrente:
--   • payments passa a ser o LIVRO-CAIXA ÚNICO (o valor da sessão/agendamento
--     vira lançamento automaticamente)
--   • um agendamento tem no máximo um lançamento vinculado
--   • agendamentos recorrentes agrupados por series_id
-- ============================================================================

-- ── Agenda recorrente: agrupa a série criada de uma vez ─────────────────────
alter table appointments
  add column if not exists series_id text;

create index if not exists idx_appointments_series on appointments(series_id);

-- ── Método de pagamento direto no agendamento (pix, dinheiro, cartão...) ────
alter table appointments
  add column if not exists payment_method text;

-- ── Um agendamento = no máximo um lançamento no caixa ───────────────────────
-- (pagamentos avulsos, sem appointment_id, não são afetados)
create unique index if not exists idx_payments_appointment_unique
  on payments(appointment_id)
  where appointment_id is not null;

-- ── Nota sobre payments.paid_at ─────────────────────────────────────────────
-- paid_at é a DATA DE REFERÊNCIA do lançamento (competência):
--   • status 'pago'     → data em que foi pago
--   • status 'pendente' → data da sessão que gerou a cobrança (a receber)
-- É por ela que o relatório mensal agrupa.
comment on column payments.paid_at is 'Data de referência do lançamento (competência): pagamento efetuado ou data da sessão a receber.';
