# Sistema de Recepção Autônoma — Fisioterapia & Acupuntura

Sistema de recepção sem secretária para consultório. Funciona com quatro telas simultâneas em rede local ou remota.

---

## Pré-requisitos

- Node.js 18+
- Conta no Supabase (gratuita em [supabase.com](https://supabase.com))
- Chave da API da Anthropic em [console.anthropic.com](https://console.anthropic.com)

---

## Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com)
2. Vá em **SQL Editor** e cole e execute o conteúdo de `supabase-setup.sql`
3. Vá em **Project Settings → API**
4. Copie a **Project URL** → use como `SUPABASE_URL`
5. Copie a chave **service_role** (em "Project API keys") → use como `SUPABASE_SERVICE_KEY`

> ⚠️ Use sempre a chave `service_role`, nunca a `anon`. Ela fica apenas no servidor.

---

## Configuração do .env

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```
PORT=3000
SUPABASE_URL=https://xxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=sua_service_role_key_aqui
ANTHROPIC_API_KEY=sua_chave_aqui
BASE_URL=http://192.168.1.100:3000
```

**Descobrir o IP local da máquina:**

```bash
# Mac / Linux
ifconfig | grep "inet "

# Windows
ipconfig
```

Use o IP que começa com `192.168.` ou `10.` como `BASE_URL`. Esse IP precisa ser acessível pelos outros dispositivos na mesma rede Wi-Fi.

---

## Instalação e execução

```bash
npm install
node server.js
```

O servidor exibirá no console as URLs para cada tela e confirmará a conexão com o Supabase.

Para desenvolvimento com reinicialização automática:

```bash
npm run dev
```

---

## URLs de cada dispositivo

| Dispositivo | URL |
|---|---|
| TV sala de espera (Totem) | `http://[IP]:3000/totem` |
| Celular do paciente | Gerado automaticamente via QR Code |
| Notebook da Dra. | `http://[IP]:3000/doctor` |
| TV sala de atendimento | `http://[IP]:3000/shared` |

Substitua `[IP]` pelo endereço configurado em `BASE_URL`.

---

## Modo kiosk — fullscreen sem barra do browser

```bash
# Linux / Raspberry Pi
chromium-browser --kiosk http://localhost:3000/totem

# Mac
open -a "Google Chrome" --args --kiosk http://localhost:3000/totem

# Windows
start chrome --kiosk http://localhost:3000/totem
```

---

## Usando dois monitores na mesma máquina

A Dra. pode ter o notebook com `http://localhost:3000/doctor` e uma TV como segundo monitor com `http://localhost:3000/shared` — ambos acessando o mesmo servidor local.

---

## Fluxo completo

```
[SALA DE ESPERA]
Paciente chega → digita o nome no Totem
→ QR Code gerado → paciente escaneia no celular
→ Responde 4 perguntas temáticas
→ Totem exibe confirmação de chegada

[NOTEBOOK DA DRA.]
→ Modal aparece automaticamente com resumo das respostas
→ Dra. lê e clica "OK, pode entrar"
→ Dashboard carrega: métricas, alertas, histórico

[SALA DE ATENDIMENTO]
→ Dra. clica "Modo Consulta"
→ Seleciona região no corpo anatômico interativo
→ Descreve o problema → IA gera explicação
→ Clica "Exibir na TV do paciente"
→ TV mostra corpo com região destacada + texto com typewriter
```

---

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (padrão: 3000) |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Chave service_role do Supabase |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic |
| `BASE_URL` | URL base com IP local para gerar QR Codes |

---

## Estrutura de arquivos

```
clinic-reception/
├── server.js              # Servidor Express
├── database.js            # Cliente Supabase e funções de acesso
├── ai.js                  # Integração com Anthropic API
├── supabase-setup.sql     # SQL para criar as tabelas no Supabase
├── package.json
├── .env                   # Suas credenciais (não commitar)
├── .env.example
└── public/
    ├── totem/index.html   # TV sala de espera
    ├── form/index.html    # Formulário do paciente (celular)
    ├── doctor/index.html  # Painel da Dra.
    └── shared/index.html  # TV sala de atendimento
```
