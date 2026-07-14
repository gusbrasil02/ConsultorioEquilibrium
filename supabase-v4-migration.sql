-- ============================================================================
-- Migração v4 — rodar no SQL Editor do Supabase.
-- Idempotente: seguro rodar mais de uma vez.
--
-- Habilita o Pix dinâmico via Mercado Pago:
--   • guarda o id do pagamento no provedor (para casar o webhook com o caixa)
--   • guarda o QR/copia-e-cola gerado, para reaproveitar sem recriar cobrança
--   • guarda o vencimento da cobrança
-- ============================================================================

alter table payments
  add column if not exists provider            text,        -- 'mercadopago' | 'pix_estatico'
  add column if not exists provider_payment_id text,        -- id do pagamento no provedor
  add column if not exists qr_code             text,        -- copia e cola
  add column if not exists qr_code_base64      text,        -- imagem do QR (data URI)
  add column if not exists expires_at          timestamptz; -- vencimento da cobrança

-- O webhook chega com o id do provedor: precisa ser rápido achar o lançamento
create index if not exists idx_payments_provider_payment_id
  on payments(provider_payment_id);

comment on column payments.provider_payment_id is 'ID do pagamento no provedor (Mercado Pago). É por ele que o webhook encontra o lançamento.';
