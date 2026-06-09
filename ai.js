import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `Você é um assistente de saúde que explica condições físicas para pacientes \
de forma simples, acolhedora e sem alarmar. Use linguagem acessível, sem \
jargão médico excessivo. Seja empático e encorajador. Responda sempre em \
português brasileiro. Estruture a resposta em exatamente 3 parágrafos curtos: \
1) O que é essa região e o que pode estar acontecendo \
2) Por que esse desconforto ocorre e como o tratamento ajuda \
3) Uma frase encorajadora sobre o processo de melhora`

async function generateAnatomyExplanation(region, problem, patientName) {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Paciente: ${patientName}. Região: ${region}. Problema relatado: ${problem}. Gere a explicação seguindo a estrutura solicitada.`
        }
      ]
    })

    return message.content[0].text
  } catch (error) {
    console.error('Erro na API Anthropic:', error.message)
    // Fallback genérico para não derrubar o sistema
    return `Esta região do seu corpo está sendo cuidadosamente avaliada pela profissional.\n\nO tratamento de fisioterapia e acupuntura trabalha de forma integrada para aliviar o desconforto e restaurar o equilíbrio natural do organismo.\n\nCom dedicação ao tratamento, o processo de melhora acontece de forma gradual e consistente. Você está no caminho certo!`
  }
}

export { generateAnatomyExplanation }
