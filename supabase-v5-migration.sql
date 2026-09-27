-- ============================================================================
-- Migração v5 — rodar no SQL Editor do Supabase.
-- Idempotente: seguro rodar mais de uma vez.
--
-- Sexo do paciente: o Atlas de Acupuntura 3D abre automaticamente o corpo
-- feminino ou masculino conforme o cadastro (dá para trocar na hora).
-- Sem esta coluna o sistema continua funcionando — só não escolhe sozinho.
-- ============================================================================

alter table patients
  add column if not exists sex text;   -- 'F' | 'M' | null (não informado)

-- Calibração antiga dos pontos (feita sobre referências erradas do modelo
-- anterior) — não é mais usada pelo sistema.
delete from app_settings where key = 'acu_calibration';
