# Sistema de Recepção Autônoma — Fisioterapia & Acupuntura

Sistema de recepção sem secretária para consultório. Funciona com quatro telas simultâneas (totem, celular do paciente, painel da profissional e TV da sala de atendimento), sincronizadas em tempo real via SSE.

---

## Pré-requisitos

- Node.js 18+ (produção usa Node 22)
- Conta no Supabase (gratuita em [supabase.com](https://supabase.com))
- Chave da API da Anthropic em [console.anthropic.com](https://console.anthropic.com)

---

## Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e execute, **nesta ordem**, o conteúdo de cada arquivo:
   1. `supabase-setup.sql`            — tabelas base (sessions, answers, anatomy_events)
   2. `supabase-additions.sql`        — pacientes e agendamentos
   3. `supabase-session-migration.sql`— controle de fluxo e anotações de sessão
   4. `supabase-v2-migration.sql`     — login, financeiro, prontuário estruturado e calibração
   5. `supabase-v3-migration.sql`     — **livro-caixa único e agenda recorrente** (novo)
3. Vá em **Project Settings → API**
4. Copie a **Project URL** → `SUPABASE_URL`
5. Copie a chave **service_role** → `SUPABASE_SERVICE_KEY`

> ⚠️ Use sempre a chave `service_role`, nunca a `anon`. Ela fica apenas no servidor.

> Já tem o sistema rodando? Basta executar o **`supabase-v2-migration.sql`** — ele é idempotente e não mexe nos dados existentes.

---

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão: 3000) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave `service_role` do Supabase |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic |
| `BASE_URL` | URL pública (ou IP local) usada para gerar os QR Codes |
| `JWT_SECRET` | **Segredo do login do painel.** Valor aleatório longo e fixo — se mudar, os logins caem |
| `NODE_ENV` | `production` em HTTPS (deixa o cookie de login como `Secure`) |

Copie `.env.example` para `.env` e preencha.

---

## Autenticação (painel da profissional)

O painel `/doctor` e as APIs de pacientes/agenda/financeiro exigem login (contas individuais por e-mail e senha). As telas do paciente (totem, formulário e TV) continuam públicas.

**Primeiro acesso:** abra `/login`. Como ainda não há nenhuma conta, a tela oferece **criar a primeira conta** — é a conta da profissional. Depois disso, `/login` passa a pedir e-mail e senha normalmente.

> Se quiser adicionar outra profissional depois, dá para inserir direto na tabela `users` (com a senha já em hash) — ou me peça uma tela de gerenciamento de usuários.

---

## Deploy (produção — Coolify)

O deploy é **automático**: todo `push` na branch `main` do GitHub dispara o build e o restart do container no Coolify. Não há mais SSH/rebuild manual.

```bash
git add -A
git commit -m "minha mudança"
git push origin main      # o Coolify publica em seguida
```

No Windows há o atalho `deploy.ps1`, que só faz `commit` + `push`.

**Ao subir esta versão pela primeira vez**, garanta no Coolify:
1. Rodar o `supabase-v2-migration.sql` no Supabase (antes ou logo após o deploy).
2. Definir as variáveis `JWT_SECRET` e `NODE_ENV=production` nas envs do serviço.
3. Acessar `/login` e criar a conta da profissional.

Enquanto o SQL/env não estiverem prontos, as telas do paciente seguem funcionando normalmente; só o painel fica aguardando o login.

---

## Instalação e execução local

```bash
npm install
node server.js          # ou: npm run dev  (reinício automático)
```

O console exibirá as URLs de cada tela e confirmará a conexão com o Supabase.

Para descobrir o IP local (uso em rede Wi-Fi):

```bash
ipconfig            # Windows
ifconfig | grep "inet "   # Mac/Linux
```

Use o IP `192.168.*` ou `10.*` como `BASE_URL`.

---

## URLs de cada dispositivo

| Dispositivo | URL |
|---|---|
| TV sala de espera (Totem) | `/totem` |
| Celular do paciente | Gerado via QR Code |
| Painel da profissional | `/doctor` (exige login) |
| TV sala de atendimento | `/shared` |
| Login | `/login` |

---

## Modo kiosk — fullscreen sem barra do browser

```bash
# Linux / Raspberry Pi
chromium-browser --kiosk https://SEU_DOMINIO/totem
# Windows
start chrome --kiosk https://SEU_DOMINIO/totem
```

---

## Fluxo completo

```
[SALA DE ESPERA — Totem]
Paciente chega → identifica o agendamento → QR Code (ou formulário na TV)
→ paciente responde: sono, dor, ONDE dói (mapa do corpo), estresse, motivo
→ totem confirma chegada

[PAINEL DA PROFISSIONAL]
→ notificação de chegada aparece automaticamente (com resumo e local da dor)
→ "Aguardar" ou "Pode entrar"
→ dashboard: métricas, alertas, histórico
→ ao finalizar: prontuário estruturado (queixa, conduta, evolução, plano)

[SALA DE ATENDIMENTO — TV do paciente]
→ Modo Consulta: seleciona região no corpo → IA gera explicação (rascunho privado)
→ revisa/edita → "Exibir na TV" publica para o paciente
→ ou Corpo Acupuntura 3D com os pontos selecionados
```

---

## Como o financeiro funciona (importante)

A tabela **`payments` é o livro-caixa único** — é dela que o relatório mensal lê. Você **não lança nada à mão**: o valor que você coloca no agendamento ou no fechamento da consulta vira lançamento automaticamente.

| O que você faz | O que acontece no caixa |
|---|---|
| Agendamento com valor | Cria lançamento **pendente** (a receber) |
| Fechar consulta como **Pago** | Lançamento vira **pago**, com a forma de pagamento |
| Fechar consulta como **Pendente** | Fica como **a receber** |
| Fechar consulta **no pacote** | **Não gera cobrança** — debita 1 sessão do pacote ativo |
| Fechar consulta como **Isento** | Remove qualquer cobrança daquele atendimento |

`payments.paid_at` é a **data de referência (competência)** do lançamento — é por ela que o relatório agrupa o mês.

**Preços padrão:** cadastre uma vez em **Financeiro → Tabela de preços padrão**. O valor passa a vir preenchido ao agendar e ao fechar a consulta (sempre editável caso a caso).

**Fechar a consulta** é o momento em que tudo se conecta: prontuário + cobrança + agendamento dos retornos (semanal / 2x por semana / quinzenal), pulando horários já ocupados.

---

## Pagamento no formulário do paciente

Configure em **Financeiro → Chave Pix**. Há dois modos:

### 1. Mercado Pago — Pix confirmado automaticamente (recomendado)

O sistema cria a cobrança na API do Mercado Pago e recebe um **webhook** quando o paciente paga → o lançamento vira **pago sozinho** no financeiro. Você não precisa conferir o banco.

**Passo a passo:**

1. **Cadastre uma chave Pix na sua conta do Mercado Pago** (sem isso a API de Pix não funciona).
2. Acesse [mercadopago.com.br/developers/panel](https://www.mercadopago.com.br/developers/panel) → **Criar aplicação**
   - Produto: *Pagamentos online / Checkout Transparente*
3. Na aplicação → **Credenciais de produção** → copie o **Access Token** (`APP_USR-...`)
4. Na aplicação → **Webhooks** → **Configurar notificações**:
   - URL: `https://SEU_DOMINIO/api/webhooks/mercadopago`
   - Evento: **Pagamentos**
   - Copie a **Assinatura secreta** gerada
5. No **Coolify**, adicione as variáveis e faça o deploy:
   ```
   MERCADOPAGO_ACCESS_TOKEN=APP_USR-...
   MERCADOPAGO_WEBHOOK_SECRET=...
   ```
6. Rode o `supabase-v4-migration.sql` no Supabase
7. No painel → **Financeiro → Chave Pix** → escolha **Mercado Pago** → Salvar
8. **Teste com R$ 0,01** antes de usar com paciente

> O Access Token **nunca** vai para o banco nem para o navegador — fica só nas variáveis de ambiente do servidor.
>
> O Mercado Pago cobra uma taxa por transação (consulte a vigente) e o dinheiro fica na conta MP até você transferir para o banco.

### 2. Pix estático — chave própria (sem taxa, confirmação manual)

O sistema gera o **BR Code** (padrão EMV do Banco Central) localmente, a partir da sua chave. **Sem gateway, sem taxa, sem intermediário** — cai direto na sua conta.

⚠️ Pix estático **não avisa o sistema** quando o dinheiro cai. O paciente toca em "já paguei" e você confirma com **1 clique** em *Financeiro → Lançamentos → "Marcar pago"*.

---

### O que o paciente vê (nos dois modos)

O formulário (celular **e** totem) ganha uma última pergunta — *"Como você prefere pagar a consulta?"* — que só aparece **se houver valor a cobrar** (não aparece se for pacote ou isento):

| Paciente escolhe | O que acontece |
|---|---|
| **Pix** | QR Code + **copia e cola** (+ a chave, no modo estático). Com Mercado Pago, a tela mostra **"✅ Pagamento confirmado!"** sozinha assim que o dinheiro cai |
| **Dinheiro / Cartão** | Combina pagar na recepção |
| **Estou com dificuldade** | Avisa a profissional para combinar pessoalmente |

Tudo isso aparece na **notificação de chegada** e já vem **pré-preenchido no fechamento da consulta**:
- Pix confirmado pelo Mercado Pago → *"✅ Pagamento já confirmado — não precisa fazer nada"*
- Declarou Pix pago (estático) → sugere **Pago** (confira no banco)
- Pediu ajuda → sugere **Pendente**

**Faça um teste de R$ 0,01** antes de usar de verdade, em qualquer um dos dois modos.

---

## Novidades desta versão

- **Login** por contas individuais protegendo o painel e os dados dos pacientes (LGPD).
- **Financeiro**: pagamentos, pacotes pré-pagos e relatório mensal de receita.
- **Prontuário estruturado** por sessão (queixa, conduta, evolução, plano), com ditado por voz.
- **Gerar × Exibir**: a explicação da IA vira rascunho privado e só vai para a TV quando a profissional publica.
- **Mapa de dor** no formulário do celular (o paciente indica onde dói).
- **Modo claro/escuro** no painel.
- **Histórico por paciente** vinculado ao cadastro (não confunde homônimos).
- **Tempo real via SSE** (menos carga no Supabase que o polling anterior).
- **Calibração de acupuntura** persistida no banco (não se perde no deploy).

---

## Estrutura de arquivos

```
├── server.js                    # Servidor Express + SSE
├── database.js                  # Acesso ao Supabase
├── ai.js                        # Integração Anthropic
├── auth.js                      # Login (hash de senha + cookie assinado)
├── supabase-setup.sql
├── supabase-additions.sql
├── supabase-session-migration.sql
├── supabase-v2-migration.sql    # login, financeiro, prontuário, calibração
├── Dockerfile / docker-compose.yml
├── deploy.ps1                   # atalho: commit + push (Coolify publica)
└── public/
    ├── login/index.html         # tela de acesso / criação da 1ª conta
    ├── totem/index.html
    ├── form/index.html
    ├── doctor/index.html
    ├── shared/index.html
    └── calibrate/index.html
```
