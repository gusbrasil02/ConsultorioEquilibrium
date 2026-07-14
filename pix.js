// ─── Pix estático — geração do BR Code (padrão EMV / BR Code do Banco Central) ─
//
// Monta o "copia e cola" do Pix a partir da chave, nome, cidade e valor.
// Não depende de banco nem gateway: é o mesmo código que o app do banco lê.
//
// Estrutura EMV: cada campo é ID(2) + TAMANHO(2) + VALOR, e o último campo (63)
// é o CRC16-CCITT calculado sobre tudo que veio antes (incluindo "6304").

// CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF) — exigido pela especificação
function crc16(payload) {
  let crc = 0xFFFF
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// Campo EMV: id + tamanho (2 dígitos) + valor
function tlv(id, value) {
  const v = String(value)
  return `${id}${String(v.length).padStart(2, '0')}${v}`
}

// O BR Code só aceita ASCII: remove acentos, corta no limite e sobe pra maiúscula
function sanitize(str, max) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "")  // tira acentos
    .replace(/[^\x20-\x7E]/g, '')     // só ASCII imprimível
    .trim()
    .slice(0, max)
    .toUpperCase()
}

/**
 * Gera o payload "copia e cola" do Pix.
 * @param {string} key    Chave Pix (CPF/CNPJ, e-mail, telefone ou aleatória)
 * @param {string} name   Nome do recebedor (máx. 25 caracteres)
 * @param {string} city   Cidade do recebedor (máx. 15 caracteres)
 * @param {number} amount Valor em reais (opcional — sem ele o paciente digita)
 * @param {string} txid   Identificador da cobrança (opcional, máx. 25 alfanumérico)
 */
function buildPixPayload({ key, name, city, amount, txid }) {
  if (!key) throw new Error('Chave Pix não configurada')

  const merchantAccount = tlv('26',
    tlv('00', 'br.gov.bcb.pix') +
    tlv('01', String(key).trim())
  )

  const parts = [
    tlv('00', '01'),   // versão do payload
    tlv('01', '11'),   // 11 = QR estático (reutilizável)
    merchantAccount,
    tlv('52', '0000'), // categoria do estabelecimento (não usada)
    tlv('53', '986')   // moeda: BRL
  ]

  const valor = Number(amount)
  if (valor > 0) parts.push(tlv('54', valor.toFixed(2)))

  parts.push(tlv('58', 'BR'))
  parts.push(tlv('59', sanitize(name, 25) || 'RECEBEDOR'))
  parts.push(tlv('60', sanitize(city, 15) || 'BRASIL'))

  // Identificador da transação — "***" quando não há um
  const ref = (txid ? String(txid).replace(/[^A-Za-z0-9]/g, '').slice(0, 25) : '') || '***'
  parts.push(tlv('62', tlv('05', ref)))

  const semCrc = parts.join('') + '6304'
  return semCrc + crc16(semCrc)
}

export { buildPixPayload }
