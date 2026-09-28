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
   5. `supabase-v3-migration.sql`     — livro-caixa único e agenda recorrente
   6. `supabase-v4-migration.sql`     — Pix via Mercado Pago (id do pagamento, QR, vencimento)
   7. `supabase-v5-migration.sql`     — sexo do paciente (escolhe o corpo 3D feminino/masculino)
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
→ se já houver alguém em atendimento, quem chega entra na barra "Na recepção"
  (a sessão aberta não é substituída); ao fechar a consulta, o próximo abre sozinho
→ dashboard: métricas, alertas, histórico
→ ao finalizar: prontuário estruturado (queixa, conduta, evolução, plano)

[SALA DE ATENDIMENTO — TV do paciente]
→ Anatomia 3D: escolhe a região no corpo 3D → condição (ex.: lesão de menisco)
  → visão interna mostra a lesão → IA gera explicação (rascunho privado, opcional)
→ revisa/edita → "Exibir na TV" publica para o paciente
→ ou Atlas de Acupuntura 3D com os pontos selecionados
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

## Anatomia 3D (fisioterapia)

Aberta pelo botão **◎** no topo do painel (consulta livre), por **◎ Anatomia 3D →** no dashboard ou por **◎ Anatomia 3D** durante a sessão. Usa os mesmos corpos realistas do atlas (feminino/masculino, escolhido pelo sexo do paciente).

1. **Região** — clique no corpo (ou escolha na lista). A pele da região acende em vermelho, com ondas saindo do ponto de dor, um retículo de mira e um anel de varredura. As regiões que o paciente marcou no formulário aparecem como atalhos.
2. **O que pode estar acontecendo** — cada região tem as condições mais comuns (joelho: menisco, LCA, condromalácia, tendinite patelar, artrose, colateral medial, cisto de Baker; lombar: hérnia de disco, lombalgia, ciática, artrose, discopatia, espondilolistese; e assim por diante), com um texto curto "o que é" e "como a fisioterapia ajuda".
3. **Visão interna** — a pele vira um holograma translúcido e as estruturas da região se materializam: ossos, cartilagens, meniscos, ligamentos, tendões, músculos, nervos e discos. A estrutura afetada aparece **em vermelho pulsante**, **rompida** (fissura), **desgastada** (cartilagem "corroída"), **inchada** (bursite) ou **deslocada** (espondilolistese); hérnias, esporões, cistos e osteófitos aparecem quando a condição pede. A câmera gira sozinha para o lado da lesão. Clicar numa estrutura (no 3D ou na lista) marca/desmarca em vermelho à mão.
4. **Exibir na TV** — a TV repete a cena numa sequência automática: corpo inteiro → aproxima na região → abre a visão interna, com o texto ao lado (o da IA, se gerado; senão, a explicação padrão da condição e "como o tratamento ajuda"). **Limpar a TV** volta à tela de repouso.

**Visão de músculos** — o botão **Pele / Músculos** troca a pele pelo corpo "écorché" (como nos atlas de anatomia): cada músculo com fibras, sulcos, tendões e fáscias brancas. São 43 músculos e estruturas por lado (deltoide, peitoral, trapézio, grande dorsal, reto abdominal, oblíquos, bíceps, tríceps, flexores e extensores do antebraço, glúteos, quadríceps, sartório, adutores, isquiotibiais, gastrocnêmios, sóleo, tibial anterior, trato iliotibial, tendão de Aquiles…):
- clique num músculo no corpo (Ctrl soma outro) ou escolha na lista com busca — os da região escolhida aparecem primeiro; ele acende e aparece a **ficha** (função, onde fica, problemas comuns);
- **◐ Isolar** deixa só os músculos em destaque; o resto vira holograma transparente;
- as condições acendem em vermelho os músculos envolvidos (ex.: estiramento dos isquiotibiais, contratura do trapézio, síndrome do trato iliotibial);
- **Exibir na TV** leva a visão de músculos, a seleção e o isolamento; sem condição, a TV mostra a ficha do músculo em linguagem simples.

A textura dos músculos é gerada por `tools/muscles/build_muscles.py` a partir do próprio corpo 3D (cor, mapa de normais com o volume e as estrias de cada músculo e um mapa com o id de cada músculo por lado, em `public/models/muscles-*`). O catálogo com os textos fica em `public/js/muscle-data.js`. Para mudar o desenho de um músculo, edite os traços dele no gerador e rode `python tools/muscles/build_muscles.py` (requer numpy e pillow).

Regiões com visão interna: joelho, ombro, cotovelo, punho e mão, quadril, tornozelo e pé, coluna cervical, torácica (costas superiores) e lombar, além de braço, antebraço, coxa e panturrilha (músculos e ossos). Cabeça, tórax e abdome acendem a região e têm condições, sem visão interna.

As estruturas internas são modeladas em código (`public/js/physio-anatomy.js`) e encaixadas em cada corpo pelas juntas do esqueleto (`public/models/body-*.joints.json`) e pela espessura real do membro medida na hora. O catálogo de regiões e condições fica em `public/js/physio-data.js` — para incluir uma condição, adicione-a ao grupo da região com os efeitos (`fx`) que ela mostra.

---

## Atlas de Acupuntura 3D

Aberto pelo botão **⊕** no topo do painel (consulta livre) ou por **⊕ Atlas de Acupuntura** durante uma sessão.

**Dois corpos realistas**, escolhidos no topo do atlas: **♀ Feminino** e **♂ Masculino** (rosto com olhos, nariz e boca, pele texturizada, cabelo), com os mesmos 197 pontos e protocolos.

Ao abrir durante uma sessão, o atlas escolhe sozinho o corpo pelo **sexo do paciente** (campo novo no cadastro — rode a migração v5). Dá para trocar na hora; a **TV mostra sempre o mesmo corpo** escolhido pela profissional. O botão **Cabelo** oculta o cabelo para ver os pontos da cabeça e da nuca. **⊘ Limpar corpo** tira do corpo todos os meridianos, pontos e protocolos exibidos (só na tela da profissional); **↺ Restaurar** traz de volta o que estava antes.

- **197 pontos** nos 14 meridianos + pontos extras (Yintang, Taiyang, Anmian, Xiyan, Zigong…), cada um com localização clássica, indicações tradicionais e categoria (Yuan, Luo, He, Mu, Shu…).
- Pontos **exatamente sobre a pele** do modelo, dos dois lados do corpo (`ST36` = lado direito, `ST36-E` = esquerdo), e meridianos desenhados como trajetos colados à superfície.
- **Busca** por código, nome ou indicação (ex.: "insônia", "joelho") e **protocolos prontos** (dor lombar, cervical, ansiedade, insônia, TPM, Quatro Portões…).
- Selecionar clicando no corpo (a seleção é por proximidade na tela — não precisa acertar a bolinha) ou na lista; lados D/E independentes; **"Última sessão"** repete os pontos do atendimento anterior do paciente.
- **Exibir na TV**: a tela do paciente aproxima a câmera nos pontos, mostra o fluxo de energia nos meridianos e explica cada ponto em linguagem simples (sem avisos clínicos como contraindicações).
- Os pontos usados ficam registrados no **histórico de sessões** do paciente.

### Como os pontos são gerados

As posições não são digitadas à mão: `tools/acupoints/specs.mjs` descreve cada ponto anatomicamente (segmento do membro, distância em *cun*, lado) e `npm run build:acupoints` calcula a posição na pele de cada corpo:
- **modelo-base** (`tools/acupoints/human-body.glb`, o antigo corpo "clássico", usado só pelo gerador) → `public/js/acu-data.js` (também guarda nomes, indicações e protocolos);
- **masculino** → `public/js/acu-geo-male.js`: cada ponto é redirecionado segmento a segmento (braço, antebraço, mão, coxa, perna, pé, tronco/cabeça) usando as juntas do esqueleto (`tools/acupoints/retarget.mjs`);
- **feminino** → `public/js/acu-geo-female.js`: mesma topologia do masculino, então cada ponto é "amarrado" ao triângulo da malha e reaplicado — correspondência anatômica exata.

Para ajustar ou incluir um ponto, edite o `specs.mjs` e rode o build. Os corpos realistas são gerados por `tools/bodies/` (veja o README de lá).

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
- **Anatomia 3D** para a fisioterapia: região acesa no corpo e visão interna da lesão, também na TV.

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
├── tools/acupoints/             # gerador dos pontos de acupuntura (npm run build:acupoints)
│   ├── specs.mjs                #   meridianos, pontos, protocolos (edite aqui)
│   ├── rig.mjs                  #   referências anatômicas do modelo 3D
│   ├── mesh.mjs                 #   leitura do GLB + projeção na pele
│   ├── build.mjs                #   gera public/js/acu-data.js
│   └── human-body.glb           #   modelo-base dos pontos (não é exibido)
├── tools/muscles/build_muscles.py  # gera a visão de músculos (public/models/muscles-*)
└── public/
    ├── login/index.html         # tela de acesso / criação da 1ª conta
    ├── totem/index.html
    ├── form/index.html
    ├── doctor/index.html
    ├── shared/index.html        # TV da sala de atendimento
    └── js/
        ├── acupuncture-viewer.js  # atlas de acupuntura 3D (painel e TV)
        ├── acu-data.js            # GERADO — pontos e trajetos dos meridianos
        ├── physio-viewer.js       # Anatomia 3D da fisioterapia (painel e TV)
        ├── physio-anatomy.js      #   estruturas internas (ossos, ligamentos, nervos…)
        ├── physio-data.js         #   regiões, condições e efeitos de cada lesão
        └── muscle-data.js         #   músculos da visão de músculos (nomes, função, problemas)
```
