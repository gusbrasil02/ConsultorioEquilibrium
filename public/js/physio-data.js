// Catálogo da Anatomia 3D (fisioterapia): regiões do corpo, condições comuns e
// o que cada condição faz aparecer na visão interna.
//
// Regiões
//   cap     cápsula que delimita a região no corpo (juntas do esqueleto de
//           public/models/body-*.joints.json). Referência de junta: 'r-knee' ou
//           ['junta-a', 'junta-b', t] (ponto entre as duas). 'S-' vira 'r-'/'l-'.
//   facing  só a pele voltada para esse lado acende (tórax × costas)
//   view    de onde a câmera olha: [lateral, cima, frente] — "lateral" aponta
//           para fora do corpo (espelhado entre direito e esquerdo)
//   model   modelo interno (public/js/physio-anatomy.js); sem ele, só a pele acende
//
// Condições (fx = efeitos na visão interna): [estrutura, tipo, intensidade]
//   inflame  vermelho pulsante (inflamação, dor, irritação)
//   tear     fissura / ruptura visível na estrutura
//   wear     desgaste (cartilagem "corroída")
//   swell    inchaço (bursite, tendinopatia)
//   thin     achatamento (disco desidratado)
//   shrink   retração (cápsula do ombro congelado)
//   shift    deslocamento (espondilolistese)
//   show     aparece algo que normalmente não existe (hérnia, esporão, cisto…)
//   custom   efeito próprio do modelo (ex.: curvatura da escoliose)

const SIDES = [
  { key: 'direito', fem: 'direita', side: 'D', pre: 'r-', sx: -1, M: 'Direito', F: 'Direita' },
  { key: 'esquerdo', fem: 'esquerda', side: 'E', pre: 'l-', sx: 1, M: 'Esquerdo', F: 'Esquerda' }
]

// ─── Condições por grupo de região ───────────────────────────────────────────

const C = {
  cabeca: [
    { id: 'cefaleia', name: 'Cefaleia tensional',
      about: 'Dor de cabeça em "pressão" ou "faixa", causada principalmente por tensão nos músculos do pescoço, dos ombros e do couro cabeludo.',
      treatment: 'Liberação miofascial, alongamentos, correção postural e técnicas de relaxamento reduzem a tensão e a frequência das crises.' },
    { id: 'atm', name: 'Disfunção da ATM',
      about: 'A articulação da mandíbula (ATM) e os músculos da mastigação ficam sobrecarregados — por apertar os dentes, estresse ou postura — causando dor, estalos e cansaço ao mastigar.',
      treatment: 'Terapia manual nos músculos da face, exercícios de controle da mandíbula e orientações para aliviar a sobrecarga no dia a dia.' }
  ],
  pescoco: [
    { id: 'cervicalgia', name: 'Cervicalgia (tensão muscular)',
      about: 'Os músculos ao redor da coluna do pescoço ficam contraídos e sobrecarregados, geralmente por postura, estresse ou longos períodos no celular e no computador.',
      treatment: 'Terapia manual, liberação dos músculos, alongamentos e fortalecimento dos músculos profundos do pescoço.',
      fx: [['musculoD', 'inflame'], ['musculoE', 'inflame'], ['trapezio', 'inflame', 0.7]] },
    { id: 'hernia', name: 'Hérnia de disco cervical (C5-C6)',
      about: 'O disco entre duas vértebras do pescoço se desloca e pressiona uma raiz nervosa. Isso pode causar dor que irradia para o ombro e o braço, formigamento ou fraqueza.',
      treatment: 'Técnicas para descomprimir a região, exercícios de estabilização e controle postural para aliviar a pressão sobre o nervo.',
      fx: [['hernia', 'show'], ['raiz', 'inflame'], ['disco56', 'inflame', 0.6]] },
    { id: 'artrose', name: 'Artrose cervical',
      about: 'Desgaste natural das articulações e dos discos do pescoço, com pequenas saliências ósseas (osteófitos) que causam rigidez e dor ao movimentar.',
      treatment: 'Mobilização articular suave, exercícios de amplitude e fortalecimento mantêm o pescoço móvel e reduzem a dor.',
      fx: [['osteofitos', 'show'], ['facetas', 'inflame', 0.7], ['disco56', 'thin'], ['disco67', 'thin', 0.6]] },
    { id: 'torcicolo', name: 'Torcicolo',
      about: 'Contração súbita e dolorosa dos músculos de um lado do pescoço, que limita o movimento de girar ou inclinar a cabeça.',
      treatment: 'Calor, liberação muscular e mobilização gradual devolvem o movimento em poucos dias.',
      fx: [['musculoE', 'inflame'], ['trapezio', 'inflame', 0.5]] }
  ],
  torax: [
    { id: 'peitoral', name: 'Tensão do músculo peitoral',
      about: 'O músculo do peito fica encurtado e tenso, puxando os ombros para frente — comum em quem passa muito tempo sentado ou treina muito o peitoral.',
      treatment: 'Alongamento, liberação miofascial e fortalecimento dos músculos das costas equilibram a postura.' },
    { id: 'costocondrite', name: 'Costocondrite',
      about: 'Inflamação da cartilagem que une as costelas ao osso do peito (esterno). Causa dor ao pressionar o peito, respirar fundo ou se mexer.',
      treatment: 'Controle da inflamação, exercícios respiratórios e mobilidade torácica aliviam a dor.' }
  ],
  costas: [
    { id: 'contratura', name: 'Contratura muscular (trapézio e romboides)',
      about: 'Os músculos entre as escápulas e a coluna ficam contraídos e doloridos, com "nós" de tensão — geralmente por postura, estresse ou esforço repetitivo.',
      treatment: 'Liberação miofascial, alongamentos e fortalecimento dos músculos que sustentam a postura.',
      fx: [['romboides', 'inflame'], ['trapezio', 'inflame', 0.7]] },
    { id: 'dorsalgia', name: 'Dorsalgia postural',
      about: 'Dor no meio das costas causada pela sobrecarga contínua dos músculos e das articulações da coluna torácica quando a postura fica curvada por muito tempo.',
      treatment: 'Mobilização da coluna, exercícios de extensão e fortalecimento para sustentar melhor a postura.',
      fx: [['musculoD', 'inflame', 0.8], ['musculoE', 'inflame', 0.8], ['facetas', 'inflame', 0.5]] },
    { id: 'escoliose', name: 'Escoliose',
      about: 'Curvatura lateral da coluna. Pode gerar desequilíbrio entre os músculos dos dois lados das costas, cansaço e dor.',
      treatment: 'Exercícios específicos de correção e alongamento, fortalecimento assimétrico e reeducação postural.',
      fx: [['escoliose', 'custom'], ['musculoD', 'inflame', 0.6]] }
  ],
  abdome: [
    { id: 'diastase', name: 'Diástase abdominal',
      about: 'Afastamento dos dois lados do músculo reto do abdome, comum após a gestação. Deixa o abdome mais saliente e a coluna menos protegida.',
      treatment: 'Exercícios de ativação do core profundo e controle respiratório aproximam e fortalecem a musculatura.' },
    { id: 'tensao', name: 'Tensão da musculatura abdominal',
      about: 'Sobrecarga ou estiramento dos músculos do abdome, que causa dor ao se mexer, tossir ou levantar.',
      treatment: 'Repouso relativo, liberação e retorno progressivo aos exercícios.' }
  ],
  lombar: [
    { id: 'hernia', name: 'Hérnia de disco (L4-L5)',
      about: 'O disco entre as vértebras funciona como um amortecedor. Quando ele se desloca para trás, pode pressionar a raiz de um nervo, causando dor nas costas que às vezes desce para a perna.',
      treatment: 'Exercícios de estabilização, técnicas de descompressão e fortalecimento do core diminuem a pressão sobre o nervo e aliviam a dor.',
      fx: [['hernia', 'show'], ['raiz', 'inflame'], ['disco45', 'inflame', 0.6]] },
    { id: 'lombalgia', name: 'Lombalgia muscular (contratura)',
      about: 'Os músculos que sustentam a coluna lombar ficam contraídos e inflamados por esforço, má postura ou longos períodos sentado.',
      treatment: 'Liberação muscular, alongamentos e fortalecimento do core e dos glúteos para proteger a coluna.',
      fx: [['musculoD', 'inflame'], ['musculoE', 'inflame']] },
    { id: 'ciatica', name: 'Dor ciática',
      about: 'Irritação do nervo ciático, que sai da coluna lombar e desce pela parte de trás da perna. Causa dor, queimação ou formigamento que irradia para a perna.',
      treatment: 'Mobilização neural, alongamentos e estabilização da coluna para desinflamar e liberar o nervo.',
      fx: [['ciatico', 'inflame'], ['raiz', 'inflame']] },
    { id: 'artrose', name: 'Artrose da coluna lombar',
      about: 'Desgaste natural das pequenas articulações e dos discos da coluna, com formação de osteófitos ("bicos de papagaio"), causando rigidez e dor.',
      treatment: 'Mobilização, exercícios de flexibilidade e fortalecimento mantêm a coluna estável e reduzem a dor.',
      fx: [['osteofitos', 'show'], ['facetas', 'inflame', 0.7], ['disco45', 'thin'], ['disco5S', 'thin', 0.7]] },
    { id: 'discopatia', name: 'Desgaste do disco (discopatia)',
      about: 'O disco perde água e altura com o tempo, amortecendo menos o impacto entre as vértebras. Isso pode causar dor e rigidez.',
      treatment: 'Exercícios de estabilização e fortalecimento distribuem melhor a carga sobre a coluna.',
      fx: [['disco45', 'thin'], ['disco45', 'wear', 0.6], ['disco34', 'thin', 0.5]] },
    { id: 'listese', name: 'Espondilolistese (L5)',
      about: 'Uma vértebra escorrega levemente para frente em relação à de baixo, deixando a região instável e sobrecarregando músculos e nervos.',
      treatment: 'Fortalecimento do core profundo e exercícios de estabilização protegem a coluna e controlam a dor.',
      fx: [['L5', 'shift'], ['disco5S', 'inflame', 0.6]] }
  ],
  ombro: [
    { id: 'impacto', name: 'Síndrome do impacto',
      about: 'Ao elevar o braço, o tendão do supraespinal e a bursa ficam "espremidos" sob o acrômio (a ponta do ombro). O atrito repetido inflama essas estruturas e causa dor.',
      treatment: 'Fortalecimento do manguito rotador e dos músculos da escápula devolve espaço à articulação e reduz o atrito.',
      fx: [['supraespinal', 'inflame'], ['bursa', 'inflame', 0.8]] },
    { id: 'manguito', name: 'Lesão do manguito rotador',
      about: 'Os tendões do manguito rotador mantêm o ombro estável. Por desgaste ou esforço, o tendão do supraespinal pode sofrer uma fissura, causando dor e fraqueza para levantar o braço.',
      treatment: 'Exercícios progressivos de fortalecimento e controle do ombro protegem o tendão e recuperam a força e o movimento.',
      fx: [['supraespinal', 'tear']] },
    { id: 'bursite', name: 'Bursite subacromial',
      about: 'A bursa é uma pequena bolsa de líquido que reduz o atrito no ombro. Quando inflama, ela incha e dói ao levantar o braço ou deitar sobre o ombro.',
      treatment: 'Controle da inflamação, correção do movimento do ombro e fortalecimento progressivo.',
      fx: [['bursa', 'swell']] },
    { id: 'capsulite', name: 'Capsulite adesiva (ombro congelado)',
      about: 'A cápsula que envolve a articulação do ombro inflama e se retrai, deixando o ombro rígido e dolorido em todos os movimentos.',
      treatment: 'Mobilização articular e alongamentos graduais soltam a cápsula e recuperam o movimento aos poucos.',
      fx: [['capsula', 'shrink']] },
    { id: 'biceps', name: 'Tendinite do bíceps',
      about: 'Inflamação do tendão da cabeça longa do bíceps, que passa na frente do ombro. Causa dor na frente do ombro, principalmente ao levantar peso.',
      treatment: 'Controle da carga, liberação e fortalecimento progressivo do ombro e do braço.',
      fx: [['biceps', 'inflame']] },
    { id: 'calcaria', name: 'Tendinite calcária',
      about: 'Depósitos de cálcio se formam dentro do tendão do supraespinal, causando crises de dor intensa no ombro.',
      treatment: 'Recursos para aliviar a dor, mobilidade e fortalecimento do manguito rotador.',
      fx: [['calcificacao', 'show'], ['supraespinal', 'inflame', 0.5]] }
  ],
  braco: [
    { id: 'distensao', name: 'Distensão do bíceps',
      about: 'Algumas fibras do músculo bíceps se rompem por esforço excessivo, causando dor, sensibilidade e às vezes um hematoma.',
      treatment: 'Controle da dor e da inflamação no início e, depois, fortalecimento progressivo para cicatrizar bem.',
      fx: [['biceps', 'tear']] },
    { id: 'contratura', name: 'Contratura do tríceps',
      about: 'O músculo de trás do braço fica tenso e dolorido por sobrecarga ou esforço repetitivo.',
      treatment: 'Liberação muscular, alongamento e ajuste da carga de treino ou trabalho.',
      fx: [['triceps', 'inflame']] }
  ],
  cotovelo: [
    { id: 'epicondiliteLat', name: 'Epicondilite lateral (cotovelo de tenista)',
      about: 'O tendão dos músculos que estendem o punho se prende na parte de fora do cotovelo. Com o uso repetitivo (mouse, ferramentas, esporte), ele inflama e sofre microlesões.',
      treatment: 'Exercícios específicos de carga para o tendão, liberação dos músculos do antebraço e ajuste das atividades.',
      fx: [['tendaoExtensor', 'tear', 0.6], ['tendaoExtensor', 'inflame']] },
    { id: 'epicondiliteMed', name: 'Epicondilite medial (cotovelo de golfista)',
      about: 'Inflamação do tendão dos músculos que flexionam o punho, na parte de dentro do cotovelo, por esforço repetitivo.',
      treatment: 'Fortalecimento progressivo do tendão, alongamentos e liberação dos músculos do antebraço.',
      fx: [['tendaoFlexor', 'inflame']] },
    { id: 'bursite', name: 'Bursite do olécrano',
      about: 'A bursa na ponta do cotovelo inflama e incha, geralmente por apoiar muito o cotovelo ou por pancada.',
      treatment: 'Proteção da região, controle do inchaço e orientação para evitar a pressão sobre o cotovelo.',
      fx: [['bursa', 'swell']] },
    { id: 'ulnar', name: 'Compressão do nervo ulnar',
      about: 'O nervo ulnar passa por um túnel estreito atrás do cotovelo. Quando comprimido, causa formigamento no dedo mínimo e no anelar.',
      treatment: 'Mobilização neural, ajustes de posição (evitar dobrar o cotovelo por muito tempo) e fortalecimento.',
      fx: [['nervoUlnar', 'inflame']] }
  ],
  antebraco: [
    { id: 'ler', name: 'Tendinite dos flexores (LER/DORT)',
      about: 'Os músculos e tendões que dobram o punho e os dedos ficam inflamados pelo uso repetitivo — digitar, usar o mouse, ferramentas.',
      treatment: 'Liberação, alongamentos, fortalecimento e pausas/ajustes ergonômicos no trabalho.',
      fx: [['flexores', 'inflame']] },
    { id: 'extensores', name: 'Sobrecarga dos extensores',
      about: 'Os músculos da parte de trás do antebraço ficam sobrecarregados e doloridos pelo esforço repetitivo de estender o punho.',
      treatment: 'Liberação muscular, fortalecimento gradual e ajuste das atividades.',
      fx: [['extensores', 'inflame']] }
  ],
  punho: [
    { id: 'tunelCarpo', name: 'Síndrome do túnel do carpo',
      about: 'O nervo mediano passa por um túnel estreito no punho, junto com os tendões. Quando esse espaço fica apertado, o nervo é comprimido e surgem formigamento, dormência e dor na mão, principalmente à noite.',
      treatment: 'Mobilização do nervo e dos tendões, órtese noturna, exercícios e ajustes ergonômicos aliviam a compressão.',
      fx: [['nervoMediano', 'inflame'], ['retinaculo', 'inflame', 0.6], ['tendoesFlexores', 'inflame', 0.3]] },
    { id: 'dequervain', name: 'Tendinite de De Quervain',
      about: 'Inflamação dos tendões que movimentam o polegar, na lateral do punho. Dói ao segurar objetos, torcer panos ou usar o celular.',
      treatment: 'Repouso relativo, órtese, liberação e fortalecimento progressivo dos tendões do polegar.',
      fx: [['tendoesPolegar', 'inflame']] },
    { id: 'tendinite', name: 'Tendinite dos flexores do punho',
      about: 'Os tendões que dobram o punho e os dedos inflamam pelo uso repetitivo.',
      treatment: 'Controle da carga, alongamentos e fortalecimento progressivo.',
      fx: [['tendoesFlexores', 'inflame']] },
    { id: 'cisto', name: 'Cisto sinovial',
      about: 'Uma pequena bolsa de líquido se forma a partir da articulação ou de um tendão do punho, criando um "caroço" que pode doer ao movimentar.',
      treatment: 'Proteção da articulação, mobilidade e fortalecimento; em alguns casos, avaliação médica.',
      fx: [['cistoSinovial', 'show']] }
  ],
  mao: [
    { id: 'rizartrose', name: 'Rizartrose (artrose na base do polegar)',
      about: 'Desgaste da articulação na base do polegar, que dói ao fazer pinça, abrir potes ou girar chaves.',
      treatment: 'Órtese, exercícios de estabilização do polegar e adaptação das atividades diminuem a dor.',
      fx: [['articulacaoPolegar', 'inflame'], ['osteofitos', 'show']] },
    { id: 'gatilho', name: 'Dedo em gatilho',
      about: 'O tendão que dobra o dedo engrossa e forma um nódulo que "enrosca" na polia da base do dedo, fazendo o dedo travar e estalar.',
      treatment: 'Liberação, exercícios de deslizamento do tendão e órtese reduzem o travamento.',
      fx: [['noduloGatilho', 'show'], ['tendoesFlexores', 'inflame', 0.4]] },
    { id: 'artrose', name: 'Artrose dos dedos',
      about: 'Desgaste das articulações das pontas dos dedos, com dor, inchaço e rigidez.',
      treatment: 'Exercícios de mobilidade, fortalecimento e proteção articular.',
      fx: [['articulacoesIFD', 'inflame']] }
  ],
  quadril: [
    { id: 'artrose', name: 'Artrose do quadril (coxartrose)',
      about: 'A cartilagem que reveste a cabeça do fêmur e o acetábulo se desgasta, fazendo o movimento do quadril doer e ficar rígido.',
      treatment: 'Fortalecimento dos glúteos e da coxa, mobilidade e controle de carga preservam a articulação e aliviam a dor.',
      fx: [['cartilagem', 'wear'], ['osteofitos', 'show']] },
    { id: 'bursite', name: 'Bursite trocantérica',
      about: 'A bursa na lateral do quadril inflama e incha, causando dor ao deitar de lado, subir escadas ou caminhar.',
      treatment: 'Fortalecimento do glúteo médio, liberação e ajuste da postura e da marcha.',
      fx: [['bursa', 'swell']] },
    { id: 'labio', name: 'Lesão do lábio acetabular',
      about: 'O lábio é um anel de cartilagem ao redor do encaixe do quadril. Uma fissura nele causa dor na virilha, estalos e sensação de travamento.',
      treatment: 'Exercícios de estabilização e fortalecimento do quadril e ajuste dos movimentos que provocam dor.',
      fx: [['labio', 'tear']] },
    { id: 'piriforme', name: 'Síndrome do piriforme',
      about: 'O músculo piriforme, no fundo do glúteo, fica tenso e comprime o nervo ciático que passa logo abaixo dele, causando dor no glúteo que pode descer pela perna.',
      treatment: 'Liberação e alongamento do piriforme, mobilização neural e fortalecimento do quadril.',
      fx: [['piriforme', 'inflame'], ['ciatico', 'inflame', 0.8]] },
    { id: 'gluteo', name: 'Tendinopatia do glúteo médio',
      about: 'O tendão do glúteo médio, que se prende na lateral do quadril, fica irritado pela sobrecarga, causando dor lateral ao caminhar ou deitar de lado.',
      treatment: 'Exercícios de carga progressiva para o tendão e fortalecimento do quadril.',
      fx: [['gluteoMedio', 'inflame']] }
  ],
  coxa: [
    { id: 'isquiotibiais', name: 'Estiramento dos isquiotibiais',
      about: 'Parte das fibras do músculo de trás da coxa se rompe — comum em corridas e arranques — causando dor aguda e dificuldade para esticar a perna.',
      treatment: 'Controle da dor no início e fortalecimento progressivo, principalmente excêntrico, para cicatrizar bem e evitar novas lesões.',
      fx: [['bicepsFemoral', 'tear']] },
    { id: 'quadriceps', name: 'Contratura do quadríceps',
      about: 'O músculo da frente da coxa fica tenso e dolorido, geralmente depois de esforço ou treino intenso.',
      treatment: 'Liberação, alongamentos e retorno gradual aos exercícios.',
      fx: [['retoFemoral', 'inflame'], ['vastoLateral', 'inflame', 0.5]] },
    { id: 'adutores', name: 'Lesão dos adutores (virilha)',
      about: 'Estiramento dos músculos da parte interna da coxa, que dói ao abrir as pernas, chutar ou mudar de direção.',
      treatment: 'Fortalecimento progressivo dos adutores e do core e retorno gradual ao esporte.',
      fx: [['adutores', 'tear']] }
  ],
  joelho: [
    { id: 'menisco', name: 'Lesão de menisco',
      about: 'O menisco é um "amortecedor" de cartilagem entre o fêmur e a tíbia. Uma torção ou o desgaste podem causar uma fissura, gerando dor na linha do joelho, estalos e sensação de travamento.',
      treatment: 'Fortalecer quadríceps e glúteos reduz a carga sobre o menisco; a fisioterapia também recupera o movimento e diminui a inflamação.',
      fx: [['meniscoMedial', 'tear']] },
    { id: 'lca', name: 'Lesão do ligamento cruzado anterior (LCA)',
      about: 'O LCA fica no centro do joelho e impede que a tíbia "escorregue" para frente. Ele costuma romper em torções, deixando o joelho instável.',
      treatment: 'Fortalecimento, treino de equilíbrio e controle do movimento — antes e depois da cirurgia, quando ela é indicada.',
      fx: [['lca', 'tear']] },
    { id: 'condromalacia', name: 'Condromalácia patelar',
      about: 'A cartilagem atrás da patela (rótula) amolece e se desgasta, causando dor na frente do joelho ao subir escadas, agachar ou ficar muito tempo sentado.',
      treatment: 'Fortalecimento do quadríceps e do quadril melhora o alinhamento da patela e reduz o atrito.',
      fx: [['cartPatelar', 'wear'], ['patela', 'inflame', 0.35]] },
    { id: 'tendinite', name: 'Tendinite patelar (joelho do saltador)',
      about: 'O tendão que liga a patela à tíbia inflama pela sobrecarga de saltos, corridas ou agachamentos.',
      treatment: 'Exercícios de carga progressiva para o tendão, alongamento e ajuste do treino.',
      fx: [['tendaoPatelar', 'inflame']] },
    { id: 'artrose', name: 'Artrose do joelho (gonartrose)',
      about: 'A cartilagem que reveste o fêmur e a tíbia se desgasta com o tempo. O osso reage formando osteófitos, e o joelho fica dolorido e rígido.',
      treatment: 'Fortalecimento muscular, mobilidade e controle de peso e carga preservam a articulação e aliviam a dor.',
      fx: [['cartFemoral', 'wear'], ['cartTibial', 'wear'], ['osteofitos', 'show'], ['meniscoMedial', 'inflame', 0.4]] },
    { id: 'lcm', name: 'Entorse do ligamento colateral medial',
      about: 'O ligamento da parte de dentro do joelho é estirado ou parcialmente rompido quando o joelho é forçado para dentro.',
      treatment: 'Proteção no início, depois mobilidade e fortalecimento progressivo para devolver a estabilidade.',
      fx: [['lcm', 'tear', 0.7], ['lcm', 'inflame']] },
    { id: 'baker', name: 'Cisto de Baker',
      about: 'Acúmulo de líquido na parte de trás do joelho, geralmente ligado a outra alteração dentro da articulação. Causa volume e sensação de pressão.',
      treatment: 'Tratar a causa, controlar o inchaço e recuperar o movimento e a força.',
      fx: [['cistoBaker', 'show']] }
  ],
  panturrilha: [
    { id: 'estiramento', name: 'Estiramento da panturrilha',
      about: 'Parte das fibras do músculo gastrocnêmio se rompe num arranque ou salto — a famosa "pedrada" na panturrilha.',
      treatment: 'Controle da dor no início e fortalecimento progressivo para o músculo cicatrizar forte.',
      fx: [['gastroMedial', 'tear']] },
    { id: 'contratura', name: 'Contratura / cãibras',
      about: 'Os músculos da panturrilha ficam contraídos e doloridos por cansaço, desidratação ou sobrecarga.',
      treatment: 'Liberação, alongamentos e ajuste da carga de treino.',
      fx: [['soleo', 'inflame'], ['gastroMedial', 'inflame', 0.6], ['gastroLateral', 'inflame', 0.6]] },
    { id: 'canelite', name: 'Canelite (estresse tibial)',
      about: 'Irritação na borda interna da tíbia e dos músculos que se prendem nela, pelo impacto repetitivo da corrida.',
      treatment: 'Ajuste do treino, fortalecimento da perna e do pé e retorno gradual à corrida.',
      fx: [['tibia', 'inflame'], ['soleo', 'inflame', 0.4]] }
  ],
  tornozelo: [
    { id: 'entorse', name: 'Entorse do tornozelo',
      about: 'Ao "virar" o pé, o ligamento talofibular anterior — na parte de fora do tornozelo — é estirado ou rompido, causando dor, inchaço e instabilidade.',
      treatment: 'Controle do inchaço no início e depois fortalecimento e treino de equilíbrio para evitar novas entorses.',
      fx: [['ltfa', 'tear'], ['lcf', 'inflame', 0.6]] },
    { id: 'aquiles', name: 'Tendinite do tendão de Aquiles',
      about: 'O tendão que liga a panturrilha ao calcanhar inflama e engrossa pela sobrecarga, causando dor atrás do tornozelo, principalmente ao começar a andar.',
      treatment: 'Exercícios de carga progressiva para o tendão, alongamento e ajuste do treino e do calçado.',
      fx: [['aquiles', 'swell']] },
    { id: 'rupturaAquiles', name: 'Ruptura do tendão de Aquiles',
      about: 'O tendão de Aquiles se rompe, geralmente num arranque ou salto, e fica difícil ficar na ponta do pé.',
      treatment: 'Reabilitação progressiva — com ou sem cirurgia — para recuperar força, marcha e o retorno às atividades.',
      fx: [['aquiles', 'tear']] },
    { id: 'artrose', name: 'Artrose do tornozelo',
      about: 'Desgaste da cartilagem entre a tíbia e o tálus, geralmente após entorses ou fraturas antigas, com dor e rigidez.',
      treatment: 'Mobilidade, fortalecimento e adaptação das atividades para aliviar a carga.',
      fx: [['cartTalar', 'wear'], ['osteofitos', 'show']] }
  ],
  pe: [
    { id: 'fascite', name: 'Fascite plantar',
      about: 'A fáscia plantar é uma faixa resistente sob a sola do pé. Quando inflama, causa dor forte no calcanhar, principalmente nos primeiros passos da manhã.',
      treatment: 'Alongamento da fáscia e da panturrilha, liberação, fortalecimento do pé e orientação sobre calçados.',
      fx: [['fasciaPlantar', 'inflame']] },
    { id: 'esporao', name: 'Esporão do calcâneo',
      about: 'Uma pequena saliência óssea se forma no calcanhar, onde a fáscia plantar se prende, geralmente junto com a fascite.',
      treatment: 'O tratamento é o da fascite: alongamentos, fortalecimento, liberação e ajuste do calçado.',
      fx: [['esporao', 'show'], ['fasciaPlantar', 'inflame', 0.6]] },
    { id: 'metatarsalgia', name: 'Metatarsalgia',
      about: 'Dor na parte da frente da sola do pé, embaixo dos dedos, pela sobrecarga das cabeças dos metatarsos.',
      treatment: 'Fortalecimento dos músculos do pé, palmilhas e ajuste do calçado.',
      fx: [['cabecasMetatarso', 'inflame']] },
    { id: 'joanete', name: 'Joanete (hálux valgo)',
      about: 'O dedão se desvia em direção aos outros dedos e forma uma saliência óssea na lateral do pé, que inflama com o atrito do calçado.',
      treatment: 'Exercícios para o pé, órteses e calçados adequados aliviam a dor e freiam a progressão.',
      fx: [['mtp1', 'inflame'], ['joanete', 'show']] }
  ]
}

// ─── Regiões ─────────────────────────────────────────────────────────────────

const CENTER = [
  { id: 'cabeca', label: 'Cabeça', group: 'cabeca',
    cap: { a: ['head', 'head-2', 0.12], b: ['head', 'head-2', 0.55], r: 0.12 }, view: [0, 0.1, 1] },
  { id: 'pescoco', label: 'Pescoço', group: 'pescoco', model: 'cervical',
    cap: { a: ['neck', 'head', -0.15], b: ['neck', 'head', 0.55], r: 0.085 }, view: [0.55, 0.12, -1] },
  { id: 'torax', label: 'Tórax', group: 'torax', facing: [0, 0, 1],
    cap: { a: ['spine-2', 'neck', 0.2], b: ['spine-2', 'neck', 0.75], r: 0.17 }, view: [0, 0.1, 1] },
  { id: 'costas', label: 'Costas superiores', group: 'costas', model: 'thoracic', facing: [0, 0, -1],
    cap: { a: ['spine-2', 'neck', 0.1], b: ['spine-2', 'neck', 0.8], r: 0.17 }, view: [0.35, 0.12, -1] },
  { id: 'abdome', label: 'Abdome', group: 'abdome', facing: [0, 0, 1],
    cap: { a: ['pelvis', 'spine-2', 0.3], b: ['pelvis', 'spine-2', 1.0], r: 0.16 }, view: [0, 0.05, 1] },
  { id: 'lombar', label: 'Lombar', group: 'lombar', model: 'lumbar', facing: [0, 0, -1],
    cap: { a: ['pelvis', 'spine-2', 0.15], b: ['pelvis', 'spine-2', 1.0], r: 0.15 }, view: [0.45, 0.08, -1] }
]

// Regiões de um lado ('S-' vira 'r-' / 'l-')
const SIDED = [
  { id: 'ombro', label: 'Ombro', g: 'M', model: 'shoulder',
    cap: { a: 'S-shoulder', b: 'S-shoulder', r: 0.09 }, axis: ['S-shoulder', 'S-elbow'], view: [0.75, 0.25, 1] },
  { id: 'braco', label: 'Braço', g: 'M', model: 'arm',
    cap: { a: ['S-shoulder', 'S-elbow', 0.25], b: ['S-shoulder', 'S-elbow', 0.82], r: 0.065 }, axis: ['S-shoulder', 'S-elbow'], view: [0.6, 0.1, 1] },
  { id: 'cotovelo', label: 'Cotovelo', g: 'M', model: 'elbow',
    cap: { a: 'S-elbow', b: 'S-elbow', r: 0.065 }, axis: ['S-shoulder', 'S-elbow'], view: [0.8, 0.15, 0.7] },
  { id: 'antebraco', label: 'Antebraço', g: 'M', model: 'forearm',
    cap: { a: ['S-elbow', 'S-hand', 0.2], b: ['S-elbow', 'S-hand', 0.82], r: 0.055 }, axis: ['S-elbow', 'S-hand'], view: [0.5, 0.15, 1] },
  { id: 'punho', label: 'Punho', g: 'M', model: 'hand',
    cap: { a: 'S-hand', b: ['S-hand', 'S-finger-3-1', 0.25], r: 0.05 }, axis: ['S-elbow', 'S-hand'], view: [0.3, 0.2, 1] },
  { id: 'mao', label: 'Mão', g: 'F', model: 'hand',
    cap: { a: ['S-hand', 'S-finger-3-1', 0.45], b: ['S-finger-3-1', 'S-finger-3-3', 0.6], r: 0.055 }, axis: ['S-hand', 'S-finger-3-2'], view: [0.3, 0.2, 1] },
  { id: 'quadril', label: 'Quadril', g: 'M', model: 'hip',
    cap: { a: ['S-upper-leg', 'pelvis', -0.25], b: ['S-upper-leg', 'pelvis', -0.25], r: 0.11 }, view: [1, 0.12, 0.45] },
  { id: 'coxa', label: 'Coxa', g: 'F', model: 'thigh',
    cap: { a: ['S-upper-leg', 'S-knee', 0.22], b: ['S-upper-leg', 'S-knee', 0.8], r: 0.1 }, axis: ['S-upper-leg', 'S-knee'], view: [0.45, 0.1, 1] },
  { id: 'joelho', label: 'Joelho', g: 'M', model: 'knee',
    cap: { a: 'S-knee', b: 'S-knee', r: 0.08 }, axis: ['S-upper-leg', 'S-ankle'], view: [0.35, 0.12, 1] },
  { id: 'panturrilha', label: 'Panturrilha', g: 'F', model: 'leg',
    cap: { a: ['S-knee', 'S-ankle', 0.2], b: ['S-knee', 'S-ankle', 0.78], r: 0.07 }, axis: ['S-knee', 'S-ankle'], view: [0.4, 0.1, -1] },
  { id: 'tornozelo', label: 'Tornozelo', g: 'M', model: 'ankle',
    cap: { a: 'S-ankle', b: 'S-ankle', r: 0.065 }, axis: ['S-knee', 'S-ankle'], view: [0.9, 0.25, 0.55] },
  { id: 'pe', label: 'Pé', g: 'M', model: 'foot',
    cap: { a: ['S-ankle', 'S-foot-2', 0.35], b: ['S-ankle', 'S-foot-2', 0.9], r: 0.065 }, view: [0.75, 0.55, 0.65] }
]

const sub = (ref, pre) => {
  if (typeof ref === 'string') return ref.replace(/^S-/, pre)
  return ref.map(x => (typeof x === 'string' ? x.replace(/^S-/, pre) : x))
}

export const PHYSIO_REGIONS = [
  ...CENTER.map(r => ({ ...r, side: null, sx: 0, pre: '', conditions: C[r.group] || [] })),
  ...SIDED.flatMap(r => SIDES.map(s => ({
    id: `${r.id === 'mao' ? 'mao' : r.id}-${r.g === 'F' ? s.fem : s.key}`,
    label: `${r.label} ${r.g === 'F' ? s.F : s.M}`,
    group: r.id, model: r.model, side: s.side, sx: s.sx, pre: s.pre,
    cap: { a: sub(r.cap.a, s.pre), b: sub(r.cap.b, s.pre), r: r.cap.r },
    axis: r.axis ? r.axis.map(a => sub(a, s.pre)) : null,
    view: r.view,
    conditions: C[r.id] || []
  })))
]

// Ordem da lista do painel (de cima para baixo no corpo)
export const REGION_GROUPS = [
  { name: 'Cabeça e tronco', ids: ['cabeca', 'pescoco', 'torax', 'costas', 'abdome', 'lombar'] },
  { name: 'Membros superiores', ids: ['ombro', 'braco', 'cotovelo', 'antebraco', 'punho', 'mao'] },
  { name: 'Membros inferiores', ids: ['quadril', 'coxa', 'joelho', 'panturrilha', 'tornozelo', 'pe'] }
]

const BY_ID = new Map(PHYSIO_REGIONS.map(r => [r.id, r]))
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const BY_LABEL = new Map(PHYSIO_REGIONS.map(r => [norm(r.label), r]))

export function findRegion(id) { return BY_ID.get(id) || null }
// Eventos antigos guardam só o nome da região ("Joelho Direito")
export function regionByLabel(label) { return BY_LABEL.get(norm(label)) || null }
export function findCondition(region, condId) {
  const r = typeof region === 'string' ? findRegion(region) : region
  return r?.conditions.find(c => c.id === condId) || null
}
