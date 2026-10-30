-- ─────────────────────────────────────────────────────────────────────────────
-- v7 — Robô do WhatsApp, lembretes e sugestão de sessão por IA
-- Rode uma vez no Supabase: SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem problema (tudo usa "if not exists").
-- ─────────────────────────────────────────────────────────────────────────────

-- Agendamentos: confirmação, lembrete e origem
alter table appointments
  add column if not exists confirmed_at     timestamptz,   -- paciente confirmou (WhatsApp)
  add column if not exists reminder_sent_at timestamptz,   -- lembrete de confirmação enviado
  add column if not exists notice_sent_at   timestamptz,   -- aviso "sua sessão foi agendada" enviado
  add column if not exists source           text default 'painel';  -- painel | robo

-- Sessões: sugestão da IA feita quando o paciente conclui o totem
alter table sessions
  add column if not exists ai_suggestion jsonb;

-- Conversas do WhatsApp (uma por telefone)
create table if not exists bot_conversations (
  phone           text primary key,               -- só dígitos, com 55
  name            text,                            -- nome do perfil do WhatsApp
  patient_id      bigint references patients(id) on delete set null,
  paused_until    timestamptz,                     -- robô calado nesta conversa até…
  last_message_at timestamptz default now(),
  created_at      timestamptz default now()
);

-- Mensagens (do paciente, do robô, automáticas e as digitadas pela Dra.)
create table if not exists bot_messages (
  id         bigint generated always as identity primary key,
  phone      text not null,
  role       text not null,                       -- user | assistant | staff
  content    text not null,
  wa_id      text,                                -- id da mensagem no WhatsApp
  created_at timestamptz default now()
);
create index if not exists idx_bot_messages_phone on bot_messages(phone, created_at desc);
create unique index if not exists idx_bot_messages_wa on bot_messages(wa_id) where wa_id is not null;

-- O que o robô e as automações fizeram (painel do Robô)
create table if not exists bot_actions (
  id             bigint generated always as identity primary key,
  kind           text not null,   -- agendou | remarcou | desmarcou | confirmou | lembrete | aviso |
                                  -- resposta | encaminhou | sugestao | erro
  phone          text,
  patient_id     bigint references patients(id) on delete set null,
  appointment_id bigint references appointments(id) on delete set null,
  detail         text,
  resolved_at    timestamptz,     -- encaminhamentos: quando a Dra. marcou como resolvido
  created_at     timestamptz default now()
);
create index if not exists idx_bot_actions_created on bot_actions(created_at desc);
create index if not exists idx_bot_actions_kind on bot_actions(kind, created_at desc);
