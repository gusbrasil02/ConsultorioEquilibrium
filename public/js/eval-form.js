// Ficha de avaliação — campos, montagem do formulário, leitura e impressão.
//
// Script clássico (sem módulo): expõe window.EVAL = { render, collect, printHTML, carryOver }.
// Os valores ficam num objeto plano { chave: valor } que vai inteiro para
// evaluations.data (jsonb) — acrescentar uma pergunta aqui não exige migração.
//
// Tipos de campo:
//   text | date | textarea            → string
//   chips (opts, multi?)              → string (único) ou array (multi)
//   yn  (Sim/Não + detalhe "det")     → k = 'Sim'|'Não', k_det = texto
//   scale (0 a 10)                    → string
//   rom (quadro articular)            → chaves `${k}.${art}.${mov}` (axial)
//                                       ou `${k}.${art}.${mov}.d|e` (membros)
// w = colunas ocupadas na grade de 4 (no celular tudo vira 1 coluna).
// show = 'notM' | 'notF' — some conforme o sexo marcado na identificação.
(function () {
  const YN = ['Sim', 'Não']

  const JOINTS = [
    { j: 'cervical', l: 'Cervical', axial: true, movs: [['fl', 'Flexão'], ['ext', 'Extensão'], ['latd', 'Inclinação lat. D'], ['late', 'Inclinação lat. E'], ['rotd', 'Rotação D'], ['rote', 'Rotação E']] },
    { j: 'ombro', l: 'Ombro', movs: [['abd', 'Abdução'], ['add', 'Adução'], ['fl', 'Flexão'], ['ext', 'Extensão']] },
    { j: 'cotovelo', l: 'Cotovelo', movs: [['fl', 'Flexão'], ['ext', 'Extensão']] },
    { j: 'punho', l: 'Punho', movs: [['fl', 'Flexão'], ['ext', 'Extensão']] },
    { j: 'tronco', l: 'Tronco', axial: true, movs: [['fl', 'Flexão'], ['ext', 'Extensão'], ['latd', 'Inclinação lat. D'], ['late', 'Inclinação lat. E']] },
    { j: 'quadril', l: 'Quadril', movs: [['fl', 'Flexão'], ['ext', 'Extensão'], ['abd', 'Abdução'], ['add', 'Adução']] },
    { j: 'joelho', l: 'Joelho', movs: [['fl', 'Flexão'], ['ext', 'Extensão']] },
    { j: 'tornozelo', l: 'Tornozelo', movs: [['plant', 'Plantiflexão'], ['dorsi', 'Dorsiflexão'], ['lat', 'Lateral (eversão)'], ['med', 'Medial (inversão)']] }
  ]
  const ABDOMEN = { j: 'abdomen', l: 'Abdômen', axial: true, movs: [['forca', 'Força']] }

  // Revisão de um sistema = lista marcável + observação
  const sys = (k, l, opts, obs, show) => [
    { k, t: 'chips', multi: true, l, opts, w: 4, show },
    { k: k + '_obs', t: 'text', l: '', ph: obs || 'Observações', w: 4, show }
  ]

  const SECTIONS = [
    { id: 'ident', t: 'Identificação', carry: true, fields: [
      { k: 'nome', t: 'text', l: 'Nome', w: 3 },
      { k: 'idade', t: 'text', l: 'Idade', w: 1 },
      { k: 'nascimento', t: 'date', l: 'Data de nascimento', w: 1 },
      { k: 'telefone', t: 'text', l: 'Telefone', w: 1 },
      { k: 'sexo', t: 'chips', l: 'Sexo', opts: ['Feminino', 'Masculino'], w: 2 },
      { k: 'ocupacao', t: 'text', l: 'Ocupação / profissão', w: 2 },
      { k: 'estado_civil', t: 'text', l: 'Estado civil', w: 2 },
      { k: 'endereco', t: 'text', l: 'Endereço (rua, bairro, cidade, CEP)', w: 4 },
      { k: 'medicamentos', t: 'yn', l: 'Toma algum medicamento?', det: 'Se sim, qual(is)?', w: 4 }
    ] },
    { id: 'vitais', t: 'Sinais vitais e medidas', fields: [
      { k: 'altura', t: 'text', l: 'Altura (m)', ph: 'Ex.: 1,65', w: 1 },
      { k: 'peso', t: 'text', l: 'Peso (kg)', w: 1 },
      { k: 'imc', t: 'text', l: 'IMC', ph: 'calculado', w: 1 },
      { k: 'cintura', t: 'text', l: 'Cintura abdominal (cm)', w: 1 },
      { k: 'pa', t: 'text', l: 'PA (mmHg)', ph: 'Ex.: 120/80', w: 1 },
      { k: 'fc', t: 'text', l: 'FC (bpm)', w: 1 },
      { k: 'fr', t: 'text', l: 'FR (irpm)', w: 1 },
      { k: 'spo2', t: 'text', l: 'SpO₂ (%)', w: 1 },
      { k: 'temperatura', t: 'text', l: 'Temperatura (°C)', w: 1 }
    ] },
    { id: 'queixa', t: 'Queixa principal', fields: [
      { k: 'queixa', t: 'textarea', l: 'Queixa principal', hint: 'Por que o(a) senhor(a) procurou a fisio? Conte para mim o que está sentindo.' },
      { k: 'hda', t: 'textarea', l: 'História da doença atual (HDA)' }
    ] },
    { id: 'dor', t: 'Dor', fields: [
      { k: 'dor_intensidade', t: 'scale', l: 'Intensidade da dor (0 a 10)', w: 4 },
      { k: 'dor_horario', t: 'text', l: 'Horário da dor', w: 2 },
      { k: 'dor_desde', t: 'text', l: 'Desde quando?', w: 2 },
      { k: 'dor_acorda', t: 'chips', l: 'Acorda com dor?', opts: YN, w: 4 },
      { k: 'dor_tipo', t: 'chips', multi: true, l: 'Tipo da dor', opts: ['Irradiada', 'Pontual', 'Local', 'Pontada', 'Dor que corre', 'Outro'], w: 4 },
      { k: 'dor_tipo_obs', t: 'text', l: '', ph: 'Descreva (trajeto da irradiação, outro tipo…)', w: 4 },
      { k: 'dor_inicio', t: 'textarea', l: 'Como começou?' },
      { k: 'dor_piora', t: 'textarea', l: 'Fatores que pioram', w: 2 },
      { k: 'dor_alivia', t: 'textarea', l: 'Fatores que aliviam', w: 2 },
      { k: 'tratamentos_anteriores', t: 'textarea', l: 'Tratamentos anteriores' },
      { k: 'fratura', t: 'yn', l: 'Teve alguma fratura?', det: 'Quando e onde?', w: 4 },
      { k: 'cirurgia', t: 'yn', l: 'Fez cirurgia?', det: 'Qual e quando?', w: 4 }
    ] },
    { id: 'historico', t: 'Histórico e hábitos', carry: true, fields: [
      { k: 'atividades_diarias', t: 'textarea', l: 'Quais atividades diárias?' },
      { k: 'atividade_fisica', t: 'yn', l: 'Faz atividade física?', det: 'Qual? Com que frequência?', w: 4 },
      { k: 'levanta_peso', t: 'chips', l: 'Consegue levantar peso?', opts: ['Sim', 'Com dificuldade', 'Não'], w: 2 },
      { k: 'horas_trabalho', t: 'text', l: 'Trabalha quantas horas por dia?', w: 2 },
      { k: 'posicao', t: 'chips', l: 'Posição em que permanece a maior parte do tempo', opts: ['Sentado(a)', 'Em pé', 'Andando', 'Alterna'], w: 4 },
      { k: 'saude_geral', t: 'chips', l: 'Como avalia sua saúde em geral?', opts: ['Boa', 'Média', 'Ruim'], w: 2 },
      { k: 'estresse', t: 'chips', l: 'Nível de estresse', opts: ['Baixo', 'Moderado', 'Alto', 'Muito alto'], w: 2 },
      { k: 'fumante', t: 'chips', l: 'É fumante?', opts: ['Não', 'Sim', 'Ex-fumante'], w: 2 },
      { k: 'alcool', t: 'chips', l: 'Consome bebida alcoólica?', opts: ['Não', 'Socialmente', 'Frequentemente'], w: 2 },
      { k: 'sono', t: 'chips', l: 'Como avalia seu sono?', opts: ['Bom', 'Regular', 'Ruim'], w: 2 },
      { k: 'sono_horas', t: 'text', l: 'Média de horas de sono por dia', w: 2 },
      { k: 'gravida', t: 'chips', l: 'Está grávida?', opts: YN, w: 2, show: 'notM' },
      { k: 'gravida_meses', t: 'text', l: 'Quantos meses?', w: 2, show: 'notM' }
    ] },
    { id: 'problemas', t: 'Quadro de problemas de saúde', carry: true, fields: [
      { k: 'problemas', t: 'chips', multi: true, l: 'Marque o que o paciente tem ou já teve', w: 4, opts: [
        'Dor de cabeça', 'Tontura / vertigem', 'Hipertensão', 'Diabetes', 'Cardiopatia', 'Colesterol alto',
        'Asma / bronquite', 'Problemas de tireoide', 'Osteoporose', 'Artrite / artrose', 'Hérnia de disco',
        'Formigamentos', 'Varizes / má circulação', 'Ansiedade / depressão', 'Alteração de visão', 'Alteração de audição'] },
      { k: 'problemas_obs', t: 'text', l: '', ph: 'Outros / detalhes', w: 4 }
    ] },
    { id: 'sistemas', t: 'Revisão dos sistemas', carry: true, fields: [
      ...sys('rs_pele', 'Pele', ['Feridas', 'Prurido', 'Ressecamento', 'Alteração da coloração', 'Alteração nos cabelos', 'Alteração nas unhas']),
      ...sys('rs_olhos', 'Olhos', ['Usa óculos', 'Usa lentes de contato', 'Dor', 'Eritema', 'Lacrimejamento', 'Diplopia', 'Visão turva', 'Manchas', 'Glaucoma', 'Catarata']),
      ...sys('rs_ouvidos', 'Ouvidos', ['Zumbido', 'Vertigem', 'Otalgia', 'Infecção', 'Secreção', 'Hipoacusia', 'Aparelho auditivo']),
      ...sys('rs_nariz', 'Nariz', ['Congestão nasal', 'Secreção', 'Prurido', 'Rinite', 'Epistaxe', 'Problemas sinusais']),
      ...sys('rs_garganta', 'Garganta e boca', ['Problemas nos dentes / gengivas', 'Sangramento gengival', 'Prótese dentária', 'Boca seca', 'Irritação da língua', 'Dor de garganta', 'Rouquidão']),
      ...sys('rs_resp', 'Sistema respiratório', ['Dor torácica', 'Tosse', 'Escarro', 'Dispneia', 'Expectoração', 'Hemoptise', 'Sibilância', 'Asma', 'Enfisema', 'Tuberculose', 'Pneumonia'], 'Observações (coloração e quantidade do escarro…)'),
      ...sys('rs_cardio', 'Sistema cardiovascular', ['Cardiopatia', 'Hipertensão arterial', 'Febre reumática', 'Sopro cardíaco', 'Dor / desconforto torácico', 'Palpitações', 'Dispneia', 'Ortopneia', 'Dispneia paroxística noturna', 'Edema'], 'Observações / resultados dos últimos exames'),
      ...sys('rs_gi', 'Sistema gastrointestinal', ['Disfagia', 'Pirose', 'Alteração do apetite', 'Náuseas', 'Alteração dos hábitos intestinais', 'Sangramento retal / fezes negras', 'Hemorroidas', 'Constipação', 'Diarreia', 'Dor abdominal', 'Intolerância alimentar', 'Eructação', 'Flatulência excessiva', 'Icterícia', 'Distúrbio hepático / vesícula', 'Hepatite'], 'Observações (evacuações, coloração e volume das fezes…)'),
      ...sys('rs_gu', 'Sistema geniturinário', ['Polaciúria', 'Poliúria', 'Nictúria', 'Urgência', 'Queimação / disúria', 'Hematúria', 'Infecções urinárias', 'Cálculos renais', 'Incontinência']),
      ...sys('rs_homem', 'Homens', ['Redução do calibre / força do jato', 'Hesitação', 'Gotejamento', 'Hérnias', 'Corrimento / feridas no pênis', 'Dor ou massa nos testículos', 'História de DST', 'Exposição ao HIV'], 'Hábitos sexuais, função, satisfação, métodos contraceptivos, preservativo, tratamentos…', 'notF'),
      { k: 'rs_mulher', t: 'chips', multi: true, l: 'Mulheres', w: 4, show: 'notM', opts: ['Ciclo irregular', 'Sangramento intenso', 'Sangramento entre menstruações', 'Sangramento após relação', 'Sintomas da menopausa', 'Sangramento após a menopausa', 'Corrimento vaginal', 'Prurido', 'Feridas', 'Nódulos', 'DST', 'Complicações na gravidez', 'Dispareunia', 'Exposição ao HIV'] },
      { k: 'menarca', t: 'text', l: 'Menarca (idade)', w: 1, show: 'notM' },
      { k: 'menopausa', t: 'text', l: 'Menopausa (idade)', w: 1, show: 'notM' },
      { k: 'ciclo', t: 'text', l: 'Frequência / duração / volume', w: 2, show: 'notM' },
      { k: 'gestacoes', t: 'text', l: 'Nº de gestações', w: 1, show: 'notM' },
      { k: 'partos', t: 'text', l: 'Partos (nº e tipo)', w: 1, show: 'notM' },
      { k: 'abortos', t: 'text', l: 'Abortos (espont. / induzidos)', w: 1, show: 'notM' },
      { k: 'contraceptivo', t: 'text', l: 'Método contraceptivo', w: 1, show: 'notM' },
      { k: 'rs_mulher_obs', t: 'text', l: '', ph: 'Observações (complicações, tratamentos, vida sexual, problemas…)', w: 4, show: 'notM' },
      ...sys('rs_endo', 'Sistema endócrino', ['Intolerância ao frio', 'Intolerância ao calor', 'Alteração da espessura dos cabelos', 'Mixedema', 'Retardo psicomotor', 'Sudorese excessiva', 'Polifagia', 'Polidipsia', 'Poliúria', 'Retardo do crescimento', 'Hirsutismo', 'Virilização']),
      ...sys('rs_musc', 'Sistema musculoesquelético', ['Fraqueza', 'Artralgia', 'Mialgia', 'Rigidez', 'Dor à mobilização', 'Limitação do movimento', 'Tumefação', 'Eritema', 'Hipersensibilidade', 'Deformidades', 'Traumatismos', 'Cãibra', 'Febre / calafrios', 'Exantema', 'Anorexia', 'Perda de peso', 'Sintomas pela manhã', 'Sintomas à tarde'], 'Articulações / músculos afetados, quando ocorre…'),
      ...sys('rs_neuro', 'Sistema nervoso e psicológico', ['Paralisia', 'Parestesia', 'Síncope', 'Movimentos involuntários', 'Amnésia', 'Disfasia', 'Alterações da marcha', 'Nervosismo', 'Tensão', 'Alteração de humor', 'Depressão', 'Alteração de memória', 'Tentativa de suicídio'])
    ] },
    { id: 'exames', t: 'Exames complementares', fields: [
      { k: 'exames', t: 'chips', multi: true, l: 'Exames realizados', opts: ['RX', 'Ressonância', 'Tomografia', 'Densitometria', 'Outros'], w: 4 },
      { k: 'exames_obs', t: 'textarea', l: 'Resultados / laudos' }
    ] },
    { id: 'palpacao', t: 'Palpação', fields: [
      { k: 'palp_pele', t: 'text', l: 'Pele', w: 2 },
      { k: 'palp_simetria', t: 'text', l: 'Simetria', w: 2 },
      { k: 'palp_atrofia', t: 'text', l: 'Atrofia', w: 2 },
      { k: 'palp_dor', t: 'text', l: 'Dor', w: 2 },
      { k: 'palp_temperatura', t: 'text', l: 'Temperatura', w: 2 },
      { k: 'palp_sensibilidade', t: 'text', l: 'Sensibilidade', w: 2 },
      { k: 'palp_espasmos', t: 'text', l: 'Espasmos', w: 4 }
    ] },
    { id: 'gonio', t: 'Goniometria', fields: [
      { k: 'gonio', t: 'rom', unit: 'graus', hint: 'Amplitude de movimento em graus.' }
    ] },
    { id: 'forca', t: 'Avaliação muscular', fields: [
      { k: 'forca', t: 'rom', extra: [ABDOMEN], ph: '0–5', hint: 'Escala de força 0 a 5: 0 sem contração · 1 esboço · 2 move sem gravidade · 3 vence a gravidade · 4 vence alguma resistência · 5 normal.' }
    ] },
    { id: 'funcional', t: 'Marcha, testes e postura', fields: [
      { k: 'marcha', t: 'textarea', l: 'Marcha' },
      { k: 'testes', t: 'textarea', l: 'Testes específicos', hint: 'Ex.: Lasègue positivo à D · Neer negativo bilateral' },
      { k: 'postura_ant', t: 'textarea', l: 'Exame postural — anterior', w: 2 },
      { k: 'postura_post', t: 'textarea', l: 'Exame postural — posterior', w: 2 },
      { k: 'postura_latd', t: 'textarea', l: 'Exame postural — lateral D', w: 2 },
      { k: 'postura_late', t: 'textarea', l: 'Exame postural — lateral E', w: 2 }
    ] },
    { id: 'mtc', t: 'Avaliação MTC (acupuntura)', mtc: true, fields: [
      { k: 'mtc_sono', t: 'chips', multi: true, l: 'Sono', opts: ['Dorme bem', 'Insônia', 'Dorme pouco', 'Dorme muito', 'Sonhos'], w: 4 },
      { k: 'mtc_emocoes', t: 'chips', multi: true, l: 'Emoções', opts: ['Medo', 'Raiva / irritabilidade', 'Ansiedade', 'Preocupação', 'Tristeza', 'Alegria / euforia'], w: 4 },
      { k: 'mtc_alimentacao', t: 'chips', multi: true, l: 'Alimentação', w: 4, opts: ['Come muito (calor no E)', 'Come pouco (def. Qi do BP, calor/umidade em BP)', 'Sem apetite (vazio de Qi em BP e E)', 'Prefere alimentos quentes (síndrome de frio)', 'Prefere alimentos frios (síndrome de calor)'] },
      { k: 'mtc_sabores', t: 'chips', multi: true, l: 'Sabores', w: 4, opts: ['Salgado (def. Qi do R)', 'Picante (def. Qi do P)', 'Azedo / ácido (def. Qi do F)', 'Doce (def. Qi do BP)', 'Amargo (def. Qi do C)'] },
      { k: 'mtc_sentidos', t: 'textarea', l: 'Órgãos dos sentidos', hint: 'Cabeça e cabelos · olhos / visão · boca / paladar · nariz / olfato · ouvidos / audição · pele' },
      { k: 'mtc_lingua', t: 'chips', multi: true, l: 'Língua', w: 4, opts: ['Pálida e seca (def. Xue)', 'Pálida e úmida (def. Yang Qi)', 'Vermelha (calor, def. Yin Qi)', 'Vermelha com áreas avermelhadas (estagnação de Xue)', 'Ulcerada e vermelha (ascensão de fogo do C)', 'Com fissuras (calor excessivo, def. Yin Qi do R)', 'Saburra branca (frio interno)', 'Saburra amarela (calor interno)', 'Sem saburra (insuficiência de Qi do E)', 'Denteada (umidade, def. Qi do BP)', 'Edemaciada (umidade em BP)', 'Púrpura ou violácea (estase de Xue)'] },
      { k: 'mtc_lingua_obs', t: 'text', l: '', ph: 'Língua — observações (rigidez, desvio…)', w: 4 },
      { k: 'mtc_pulso', t: 'chips', multi: true, l: 'Pulso', w: 4, opts: ['Forte (cheio)', 'Fraco (vazio)', 'Rápido (calor)', 'Lento (frio)', 'Superficial (externo)', 'Profundo (interno)'] },
      { k: 'mtc_pulso_obs', t: 'text', l: '', ph: 'Pulso — observações', w: 4 },
      { k: 'mtc_8princ', t: 'textarea', l: 'Diagnóstico pelos 8 princípios' },
      { k: 'mtc_canais', t: 'textarea', l: 'Canais e colaterais', w: 2 },
      { k: 'mtc_subst', t: 'textarea', l: 'Substâncias vitais', w: 2 },
      { k: 'mtc_zangfu', t: 'textarea', l: 'Diagnóstico Zang Fu', w: 2 },
      { k: 'mtc_4niveis', t: 'textarea', l: 'Quatro níveis', w: 2 },
      { k: 'mtc_principio', t: 'textarea', l: 'Princípio de tratamento' },
      { k: 'mtc_pontos', t: 'textarea', l: 'Pontos indicados / método terapêutico' },
      { k: 'mtc_recomend', t: 'textarea', l: 'Recomendações' }
    ] },
    { id: 'plano', t: 'Objetivos e plano de tratamento', fields: [
      { k: 'objetivo', t: 'textarea', l: 'Objetivo de tratamento' },
      { k: 'recursos', t: 'chips', multi: true, l: 'Recursos utilizados', w: 4, opts: ['Exercícios terapêuticos', 'Eletroterapia', 'Terapia manual', 'Acupuntura', 'Ventosa', 'Moxa', 'Auriculoterapia'] },
      { k: 'recursos_outros', t: 'text', l: 'Outros recursos', w: 2 },
      { k: 'frequencia', t: 'text', l: 'Frequência das sessões', ph: 'Ex.: 2x por semana', w: 2 },
      { k: 'orientacoes', t: 'textarea', l: 'Orientações ao paciente' },
      { k: 'programa', t: 'textarea', l: 'Programa de tratamento', hint: 'A evolução de cada sessão fica registrada no histórico de sessões (ao fechar a consulta).' }
    ] }
  ]

  const SHOW = {
    notM: sx => sx !== 'Masculino',
    notF: sx => sx !== 'Feminino'
  }

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const filled = v => Array.isArray(v) ? v.length > 0 : (v != null && String(v).trim() !== '')

  function romRows(f) {
    return [...JOINTS, ...(f.extra || [])]
  }

  // ── Montagem ──────────────────────────────────────────────────────────────

  // prev = ficha anterior (reavaliação): o valor antigo aparece como dica
  // nos campos de medida, para comparar sem copiar.
  function fieldHTML(f, data, prev, sec) {
    const v = data[f.k]
    const ph = (!sec.carry && filled(prev[f.k]) && typeof prev[f.k] === 'string') ? `ant.: ${prev[f.k]}` : (f.ph || '')
    const label = f.l ? `<label class="form-label">${esc(f.l)}</label>` : ''
    const hint = f.hint ? `<div class="ev-hint">${esc(f.hint)}</div>` : ''
    const show = f.show ? ` data-show="${f.show}"` : ''
    const span = f.t === 'rom' ? 4 : (f.w || (f.t === 'textarea' ? 4 : 2))
    const wrap = inner => `<div class="ev-f" style="grid-column:span ${span}"${show}>${label}${hint}${inner}</div>`

    const chips = (k, opts, multi, cur, cls = '') => {
      const on = multi ? new Set(Array.isArray(cur) ? cur : []) : null
      return `<div class="ev-chips ${cls}" data-k="${k}" data-multi="${multi ? 1 : 0}">` +
        opts.map(o => {
          const sel = multi ? on.has(o) : cur === o
          return `<button type="button" class="ev-chip${sel ? ' on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`
        }).join('') + '</div>'
    }

    switch (f.t) {
      case 'text':
        return wrap(`<input class="form-control" data-k="${f.k}" value="${esc(v)}" placeholder="${esc(ph)}">`)
      case 'date':
        return wrap(`<input type="date" class="form-control" data-k="${f.k}" value="${esc(v)}">`)
      case 'textarea':
        return wrap(`<div class="finish-field-wrap"><textarea class="form-control ev-ta" id="ev-${f.k}" data-k="${f.k}" placeholder="${esc(ph)}">${esc(v)}</textarea>` +
          `<button type="button" class="btn-mic" title="Ditar" onclick="window.toggleDictation && toggleDictation('ev-${f.k}', this)">🎤</button></div>`)
      case 'chips':
        return wrap(chips(f.k, f.opts, !!f.multi, v))
      case 'scale':
        return wrap(chips(f.k, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], false, v, 'ev-scale'))
      case 'yn':
        return wrap(`<div class="ev-yn">${chips(f.k, YN, false, v)}` +
          `<input class="form-control" data-k="${f.k}_det" value="${esc(data[f.k + '_det'])}" placeholder="${esc(f.det || '')}"></div>`)
      case 'rom': {
        const cell = key => {
          const p = filled(prev[key]) ? `ant.: ${prev[key]}` : (f.ph || f.unit || '')
          return `<input class="form-control" data-k="${key}" value="${esc(data[key])}" placeholder="${esc(p)}">`
        }
        // Coluna/abdômen: um valor por movimento · membros: D e E
        const table = (axial, cols) => {
          const rows = romRows(f).filter(J => !!J.axial === axial).map(J => J.movs.map(([m, ml], i) => {
            const base = `${f.k}.${J.j}.${m}`
            const head = i === 0 ? `<td class="ev-j" rowspan="${J.movs.length}">${esc(J.l)}</td>` : ''
            const cells = axial ? `<td>${cell(base)}</td>` : `<td>${cell(base + '.d')}</td><td>${cell(base + '.e')}</td>`
            return `<tr>${head}<td>${esc(ml)}</td>${cells}</tr>`
          }).join('')).join('')
          return `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
        }
        return wrap(`<div class="ev-rom">${table(true, ['Tronco / coluna', 'Movimento', 'Valor'])}${table(false, ['Membro', 'Movimento', 'Direito', 'Esquerdo'])}</div>`)
      }
    }
    return ''
  }

  function sectionHasData(sec, data) {
    return sec.fields.some(f => f.t === 'rom'
      ? Object.keys(data).some(k => k.startsWith(f.k + '.') && filled(data[k]))
      : filled(data[f.k]) || filled(data[f.k + '_det']))
  }

  // Monta a ficha em `root` e a navegação por seções em `nav`.
  // opts: { data, prev, mtcOpen, onChange }
  function render(root, nav, opts = {}) {
    const data = opts.data || {}
    const prev = opts.prev || {}
    root.innerHTML = SECTIONS.map(sec => {
      const open = sec.mtc ? (opts.mtcOpen || sectionHasData(sec, data)) : true
      const tag = sec.mtc ? ' <small>opcional</small>' : ''
      return `<details class="ev-sec" id="ev-sec-${sec.id}"${open ? ' open' : ''}>` +
        `<summary>${esc(sec.t)}${tag}</summary>` +
        `<div class="ev-grid">${sec.fields.map(f => fieldHTML(f, data, prev, sec)).join('')}</div></details>`
    }).join('')

    if (nav) {
      nav.innerHTML = SECTIONS.map(s => `<button type="button" data-sec="${s.id}">${esc(s.t)}</button>`).join('')
      nav.onclick = e => {
        const id = e.target.closest('button')?.dataset.sec
        if (!id) return
        const el = document.getElementById('ev-sec-' + id)
        el.open = true
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }

    const changed = () => opts.onChange && opts.onChange()

    root.onclick = e => {
      const chip = e.target.closest('.ev-chip')
      if (!chip) return
      const group = chip.parentElement
      if (group.dataset.multi === '1') {
        chip.classList.toggle('on')
      } else {
        const was = chip.classList.contains('on')
        group.querySelectorAll('.ev-chip').forEach(c => c.classList.remove('on'))
        if (!was) chip.classList.add('on')   // clicar de novo desmarca
      }
      if (group.dataset.k === 'sexo') applyShow(root)
      changed()
    }

    root.oninput = e => {
      const k = e.target.dataset?.k
      if (k === 'altura' || k === 'peso') calcIMC(root)
      if (k === 'nascimento') calcAge(root)
      changed()
    }

    applyShow(root)
  }

  function input(root, k) { return root.querySelector(`[data-k="${k}"]`) }
  const num = s => parseFloat(String(s || '').replace(',', '.'))

  function calcIMC(root) {
    let h = num(input(root, 'altura').value)
    const w = num(input(root, 'peso').value)
    if (h > 3) h = h / 100          // digitou em cm
    if (!(h > 0) || !(w > 0)) return
    input(root, 'imc').value = (w / (h * h)).toFixed(1).replace('.', ',')
  }

  // 'YYYY-MM-DD' → idade em anos ('' se inválida)
  function ageFrom(s) {
    if (!s) return ''
    const b = new Date(String(s).slice(0, 10) + 'T12:00:00'), t = new Date()
    let age = t.getFullYear() - b.getFullYear()
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--
    return age >= 0 && age < 130 ? String(age) : ''
  }

  function calcAge(root) {
    const age = ageFrom(input(root, 'nascimento').value)
    if (age) input(root, 'idade').value = age
  }

  function sexOf(root) {
    return root.querySelector('[data-k="sexo"] .ev-chip.on')?.dataset.v || ''
  }

  function applyShow(root) {
    const sx = sexOf(root)
    root.querySelectorAll('[data-show]').forEach(el => {
      el.style.display = SHOW[el.dataset.show](sx) ? '' : 'none'
    })
  }

  // ── Leitura ───────────────────────────────────────────────────────────────

  // Só guarda o que foi preenchido
  function collect(root) {
    const out = {}
    root.querySelectorAll('input[data-k], textarea[data-k]').forEach(el => {
      const v = el.value.trim()
      if (v) out[el.dataset.k] = v
    })
    root.querySelectorAll('.ev-chips[data-k]').forEach(g => {
      const on = [...g.querySelectorAll('.ev-chip.on')].map(c => c.dataset.v)
      if (!on.length) return
      out[g.dataset.k] = g.dataset.multi === '1' ? on : on[0]
    })
    return out
  }

  // Reavaliação: traz a anamnese da ficha anterior (identificação, hábitos,
  // problemas e revisão dos sistemas); o exame físico começa em branco.
  function carryOver(data) {
    const out = {}
    SECTIONS.filter(s => s.carry).forEach(s => s.fields.forEach(f => {
      if (filled(data[f.k])) out[f.k] = data[f.k]
      if (filled(data[f.k + '_det'])) out[f.k + '_det'] = data[f.k + '_det']
    }))
    return out
  }

  // ── Impressão ─────────────────────────────────────────────────────────────

  function valueText(f, data) {
    const v = data[f.k]
    if (f.t === 'yn') {
      const det = data[f.k + '_det']
      return [v, det].filter(filled).join(' — ')
    }
    if (f.t === 'scale') return filled(v) ? `${v}/10` : ''
    return Array.isArray(v) ? v.join(', ') : (v || '')
  }

  function printHTML({ data = {}, kind, eval_date, patientName, clinic }) {
    const sx = data.sexo || ''
    const body = SECTIONS.filter(sec => sectionHasData(sec, data)).map(sec => {
      const parts = sec.fields.filter(f => !f.show || SHOW[f.show](sx)).map(f => {
        if (f.t === 'rom') {
          const table = (axial, cols) => {
            const rows = romRows(f).filter(J => !!J.axial === axial).map(J => J.movs.map(([m, ml]) => {
              const base = `${f.k}.${J.j}.${m}`
              const d = axial ? data[base] : data[base + '.d']
              const e = axial ? '' : data[base + '.e']
              if (!filled(d) && !filled(e)) return ''
              return axial
                ? `<tr><td>${esc(J.l)}</td><td>${esc(ml)}</td><td>${esc(d)}</td></tr>`
                : `<tr><td>${esc(J.l)}</td><td>${esc(ml)}</td><td>${esc(d || '—')}</td><td>${esc(e || '—')}</td></tr>`
            }).join('')).join('')
            return rows ? `<table><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>` : ''
          }
          return table(true, ['Tronco / coluna', 'Movimento', 'Valor']) + table(false, ['Membro', 'Movimento', 'Direito', 'Esquerdo'])
        }
        const txt = valueText(f, data)
        if (!filled(txt)) return ''
        return f.l
          ? `<div class="row"><b>${esc(f.l)}${f.l.endsWith('?') ? '' : ':'}</b> ${esc(txt)}</div>`
          : `<div class="row">${esc(txt)}</div>`
      }).join('')
      return `<h2>${esc(sec.t)}</h2>${parts}`
    }).join('')

    const date = eval_date ? new Date(String(eval_date).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : ''
    const title = kind === 'reavaliacao' ? 'Ficha de reavaliação' : 'Ficha de avaliação'
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(title)} — ${esc(patientName)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 0; padding: 24px 32px; font-size: 12.5px; line-height: 1.45; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  header .clinic { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: #555; }
  h1 { font-size: 20px; margin: 4px 0 2px; font-weight: normal; }
  header .meta { color: #333; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .1em; border-bottom: 1px solid #bbb; padding-bottom: 2px; margin: 16px 0 6px; break-after: avoid; }
  .row { margin: 2px 0; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0; break-inside: avoid; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; }
  th { background: #f1f1f1; }
  footer { margin-top: 40px; display: flex; justify-content: flex-end; }
  footer div { border-top: 1px solid #111; width: 260px; text-align: center; padding-top: 4px; }
  @page { size: A4; margin: 14mm; }
</style></head><body>
<header><div class="clinic">${esc(clinic || '')}</div><h1>${esc(title)}</h1>
<div class="meta"><b>Paciente:</b> ${esc(patientName)}${date ? ` · <b>Data:</b> ${esc(date)}` : ''}</div></header>
${body || '<p>Ficha sem dados preenchidos.</p>'}
<footer><div>Assinatura / carimbo do profissional</div></footer>
</body></html>`
  }

  window.EVAL = { render, collect, carryOver, printHTML, ageFrom }
})()
