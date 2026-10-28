// Profundidade de agulhamento de referência (livros-texto clássicos de
// acupuntura) para cada ponto do atlas. É uma referência para adulto de
// constituição média — a profissional ajusta ao paciente.
//
// [mínimo, máximo em cun, ângulo, observação]
//   ângulo: 'p' perpendicular · 'o' oblíqua (~45°) · 't' transversal / subcutânea (~15°)
//           'x' sangria / punção superficial · 'm' não agulhar (só moxa)
//
// Na visão com agulha, a agulha entra pela normal da pele (perpendicular) ou
// inclinada no sentido do trajeto do meridiano (oblíqua/transversal).

const PNEUMO = 'Nunca profundo — risco de pneumotórax'
const BACK = 'Oblíqua em direção à coluna; nunca profundo — risco de pneumotórax'
const GEST = 'Contraindicado na gestação'

export const ACU_DEPTH = {
  // Pulmão
  LU1: [0.5, 0.8, 'o', 'Oblíqua para fora; nunca medial ou profundo — risco de pneumotórax'],
  LU2: [0.5, 0.8, 'o', 'Oblíqua para fora; nunca medial ou profundo — risco de pneumotórax'],
  LU3: [0.5, 1, 'p'], LU5: [0.5, 1, 'p'], LU6: [0.5, 1, 'p'],
  LU7: [0.3, 0.5, 'o', 'Oblíqua no sentido do cotovelo'],
  LU9: [0.2, 0.3, 'p', 'Evitar a artéria radial'],
  LU10: [0.5, 1, 'p'], LU11: [0.1, 0.1, 'x', 'Superficial ou sangria'],
  // Intestino Grosso
  LI1: [0.1, 0.1, 'x', 'Superficial ou sangria'],
  LI4: [0.5, 1, 'p', GEST], LI5: [0.3, 0.5, 'p'], LI10: [0.5, 1, 'p'], LI11: [1, 1.5, 'p'],
  LI14: [0.5, 1, 'o'], LI15: [0.5, 1.5, 'o', 'Com o braço abduzido'],
  LI18: [0.5, 0.8, 'p', 'Evitar a artéria carótida'], LI20: [0.3, 0.5, 'o', 'Oblíqua para cima e para dentro'],
  // Estômago
  ST1: [0.3, 0.7, 'p', 'Devagar, sem manipular; comprimir ao retirar (hematoma)'],
  ST2: [0.2, 0.3, 'p'], ST4: [0.3, 0.5, 't', 'Transversal em direção a ST6'], ST6: [0.3, 0.5, 'p'],
  ST7: [0.5, 1, 'p', 'Com a boca fechada'], ST8: [0.5, 1, 't'],
  ST9: [0.3, 0.8, 'p', 'Afastar a artéria carótida'], ST12: [0.3, 0.5, 'p', PNEUMO], ST18: [0.3, 0.5, 'o', PNEUMO],
  ST21: [0.8, 1.2, 'p'], ST25: [1, 1.5, 'p', GEST], ST28: [1, 1.5, 'p', 'Bexiga vazia'], ST29: [1, 1.5, 'p', 'Bexiga vazia'],
  ST30: [0.5, 1, 'p', 'Evitar a artéria femoral'], ST31: [1, 2, 'p'], ST32: [1, 2, 'p'], ST34: [1, 1.2, 'p'],
  ST35: [0.5, 1, 'o', 'Joelho fletido; oblíqua para o centro do joelho'], ST36: [1, 1.5, 'p'], ST37: [1, 1.5, 'p'],
  ST38: [1, 1.5, 'p'], ST39: [1, 1.5, 'p'], ST40: [1, 1.5, 'p'], ST41: [0.5, 1, 'p'],
  ST42: [0.3, 0.5, 'p', 'Evitar a artéria dorsal do pé'], ST43: [0.5, 1, 'p'], ST44: [0.5, 0.8, 'o'],
  ST45: [0.1, 0.1, 'x', 'Superficial ou sangria'],
  // Baço-Pâncreas
  SP1: [0.1, 0.1, 'x', 'Superficial ou sangria'], SP2: [0.3, 0.5, 'p'], SP3: [0.5, 1, 'p'], SP4: [0.5, 1, 'p'],
  SP5: [0.3, 0.5, 'p'], SP6: [1, 1.5, 'p', GEST], SP8: [1, 1.5, 'p'], SP9: [1, 1.5, 'p'], SP10: [1, 1.5, 'p'],
  SP15: [1, 1.5, 'p'], SP21: [0.3, 0.5, 'o', PNEUMO],
  // Coração
  HT1: [0.3, 0.5, 'p', 'Evitar a artéria axilar'], HT3: [0.5, 1, 'p'], HT5: [0.3, 0.5, 'p'], HT6: [0.3, 0.5, 'p'],
  HT7: [0.3, 0.5, 'p', 'Evitar a artéria ulnar'], HT8: [0.3, 0.5, 'p'], HT9: [0.1, 0.1, 'x', 'Superficial ou sangria'],
  // Intestino Delgado
  SI1: [0.1, 0.1, 'x', 'Superficial ou sangria'], SI3: [0.5, 1, 'p'], SI4: [0.3, 0.5, 'p'], SI6: [0.5, 0.8, 'o'],
  SI8: [0.3, 0.5, 'p', 'Cuidado com o nervo ulnar'], SI9: [1, 1.5, 'p'], SI10: [1, 1.5, 'p'], SI11: [0.5, 1, 'o'],
  SI12: [0.5, 1, 'o'], SI18: [0.3, 0.5, 'p'], SI19: [0.5, 1, 'p', 'Com a boca aberta'],
  // Bexiga
  BL1: [0.3, 0.5, 'p', 'Devagar, sem manipular; comprimir ao retirar (olho)'], BL2: [0.3, 0.5, 't'],
  BL10: [0.5, 0.8, 'p', 'Nunca para cima ou para dentro — risco ao bulbo'],
  BL11: [0.5, 0.8, 'o', BACK], BL12: [0.5, 0.8, 'o', BACK], BL13: [0.5, 0.8, 'o', BACK], BL14: [0.5, 0.8, 'o', BACK],
  BL15: [0.5, 0.8, 'o', BACK], BL17: [0.5, 0.8, 'o', BACK], BL18: [0.5, 0.8, 'o', BACK], BL19: [0.5, 0.8, 'o', BACK],
  BL20: [0.5, 1, 'o', BACK], BL21: [0.5, 1, 'o', BACK], BL22: [0.8, 1.2, 'p', 'Não aprofundar — rim'],
  BL23: [1, 1.5, 'p', 'Não aprofundar — rim'], BL25: [1, 1.5, 'p'], BL27: [0.8, 1.2, 'p'], BL28: [0.8, 1.2, 'p'],
  BL32: [1, 1.5, 'p', 'No 2º forame sacral'], BL36: [1, 2, 'p'], BL37: [1, 2, 'p'],
  BL40: [1, 1.5, 'p', 'Evitar a artéria poplítea (ou sangria nas veias)'], BL43: [0.5, 0.8, 'o', PNEUMO],
  BL52: [0.5, 1, 'o', 'Não aprofundar — rim'], BL54: [1.5, 2, 'p'], BL57: [1, 2, 'p'], BL58: [1, 1.5, 'p'],
  BL60: [0.5, 1, 'p', GEST], BL62: [0.3, 0.5, 'p'], BL67: [0.1, 0.1, 'x', 'Superficial; moxa na apresentação pélvica'],
  // Rim
  KI1: [0.5, 1, 'p'], KI2: [0.5, 1, 'p'], KI3: [0.5, 1, 'p'], KI6: [0.3, 0.5, 'p'], KI7: [0.5, 1, 'p'],
  KI10: [1, 1.5, 'p'], KI16: [1, 1.5, 'p'], KI27: [0.3, 0.5, 'o', PNEUMO],
  // Pericárdio
  PC1: [0.2, 0.4, 'o', PNEUMO], PC3: [0.5, 1, 'p'], PC4: [0.5, 1, 'p'], PC5: [0.5, 1, 'p'], PC6: [0.5, 1, 'p'],
  PC7: [0.3, 0.5, 'p'], PC8: [0.3, 0.5, 'p'], PC9: [0.1, 0.1, 'x', 'Superficial ou sangria'],
  // Triplo Aquecedor
  TE1: [0.1, 0.1, 'x', 'Superficial ou sangria'], TE3: [0.5, 1, 'p'], TE4: [0.3, 0.5, 'p'], TE5: [0.5, 1, 'p'],
  TE6: [0.5, 1, 'p'], TE10: [0.5, 1, 'p'], TE14: [1, 1.5, 'p', 'Com o braço abduzido'], TE17: [0.5, 1, 'p'],
  TE21: [0.5, 1, 'p', 'Com a boca aberta'], TE23: [0.3, 0.5, 't'],
  // Vesícula Biliar
  GB1: [0.3, 0.5, 't'], GB2: [0.5, 1, 'p', 'Com a boca aberta'], GB8: [0.5, 0.8, 't'], GB12: [0.5, 0.8, 'o'],
  GB14: [0.3, 0.5, 't'], GB20: [0.8, 1.2, 'o', 'Em direção à ponta do nariz; nunca para cima — risco ao bulbo'],
  GB21: [0.5, 0.8, 'p', 'Nunca profundo — risco de pneumotórax. ' + GEST],
  GB24: [0.5, 0.8, 'o', PNEUMO], GB25: [0.5, 1, 'p', 'Não aprofundar — rim'], GB26: [0.5, 1, 'p'],
  GB29: [1, 1.5, 'p'], GB30: [2, 3, 'p'], GB31: [1, 2, 'p'], GB34: [1, 1.5, 'p'], GB37: [1, 1.5, 'p'],
  GB39: [1, 1.5, 'p'], GB40: [0.5, 0.8, 'p'], GB41: [0.5, 0.8, 'p'], GB43: [0.3, 0.5, 'p'],
  GB44: [0.1, 0.1, 'x', 'Superficial ou sangria'],
  // Fígado
  LR1: [0.1, 0.2, 'x', 'Superficial ou sangria'], LR2: [0.5, 0.8, 'o'], LR3: [0.5, 1, 'p'], LR4: [0.5, 0.8, 'p'],
  LR5: [0.5, 0.8, 't', 'Transversal ao longo da tíbia'], LR8: [1, 1.5, 'p'],
  LR13: [0.5, 0.8, 'o', 'Não aprofundar — fígado e baço'], LR14: [0.5, 0.8, 'o', PNEUMO],
  // Vaso Concepção
  CV2: [1, 1.5, 'p', 'Bexiga vazia. ' + GEST], CV3: [1, 1.5, 'p', 'Bexiga vazia. ' + GEST], CV4: [1, 1.5, 'p', 'Bexiga vazia. ' + GEST],
  CV6: [1, 1.5, 'p', GEST], CV8: [0, 0, 'm', 'Não agulhar — só moxa (sobre sal)'], CV9: [1, 1.5, 'p'], CV10: [1, 1.5, 'p'],
  CV12: [1, 1.5, 'p'], CV14: [0.5, 1, 'o', 'Oblíqua para baixo; não aprofundar'], CV17: [0.3, 0.5, 't'],
  CV22: [0.2, 1, 'p', '0,2 cun perpendicular e depois para baixo, rente à face de trás do esterno'],
  CV23: [0.5, 0.8, 'o', 'Em direção à raiz da língua'], CV24: [0.3, 0.5, 'o'],
  // Vaso Governador
  GV1: [0.5, 1, 'o', 'Paralela ao cóccix'], GV3: [0.5, 1, 'o', 'Oblíqua para cima'], GV4: [0.5, 1, 'o', 'Oblíqua para cima'],
  GV9: [0.5, 1, 'o', 'Oblíqua para cima'], GV11: [0.5, 1, 'o', 'Oblíqua para cima'], GV12: [0.5, 1, 'o', 'Oblíqua para cima'],
  GV14: [0.5, 1, 'o', 'Oblíqua para cima'], GV15: [0.5, 0.8, 'p', 'Em direção ao queixo; nunca para cima — risco ao bulbo'],
  GV16: [0.5, 0.8, 'p', 'Em direção ao queixo; nunca para cima — risco ao bulbo'], GV20: [0.5, 0.8, 't'],
  GV23: [0.5, 1, 't'], GV24: [0.5, 0.8, 't'], GV26: [0.3, 0.5, 'o', 'Oblíqua para cima'],
  // Pontos extras
  Yintang: [0.3, 0.5, 't', 'Pinçar a pele; transversal para baixo'], Taiyang: [0.3, 0.5, 'p', 'Ou sangria'],
  Anmian: [0.5, 1, 'p'], Dingchuan: [0.5, 1, 'o', 'Oblíqua em direção à coluna'], Jianqian: [1, 1.5, 'p'],
  Luozhen: [0.5, 0.8, 'p'], Zigong: [0.8, 1.2, 'p', GEST], Xiyan: [0.5, 1, 'o', 'Oblíqua para o centro do joelho'],
  Dannang: [1, 1.5, 'p'], Lanwei: [1, 1.5, 'p'], Shiqizhui: [0.5, 1, 'p'], Yaoyan: [1, 1.5, 'p']
}

const ANG = { p: 'perpendicular', o: 'oblíqua', t: 'transversal', x: 'superficial / sangria', m: 'só moxa' }
const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',')

// Informação pronta para exibir. cunM = comprimento de 1 cun deste corpo (m)
export function depthInfo(id, cunM = 0.022) {
  const d = ACU_DEPTH[String(id).replace(/-E$/, '')]
  if (!d) return null
  const [a, b, ang, note] = d
  const cm = v => fmt(v * cunM * 100)
  const cun = a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}`
  const text = ang === 'm' ? 'Não agulhar' : ang === 'x' ? `${cun} cun (superficial)` : `${cun} cun · ≈ ${a === b ? cm(a) : `${cm(a)}–${cm(b)}`} cm`
  // warn: a observação é um alerta de segurança (e não só uma dica de técnica)
  const warn = /risco|evitar|nunca|contraind|não agulhar|não aprofundar|cuidado|afastar|gestação/i.test(note || '')
  return { min: a, max: b, angle: ang, angleLabel: ANG[ang], note: note || '', warn, text }
}
