// Grok (xAI) API - OpenAI 호환 형식
// baseURL: https://api.x.ai/v1
const OpenAI = require('openai');

function getGrokClient() {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    throw new Error('GROK_API_KEY is not set');
  }
  return new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' });
}

async function generateGrok({ model, messages, maxTokens, temperature, timeoutMs }) {
  const client = getGrokClient();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages,
        max_tokens: maxTokens,
        temperature
      },
      { signal: controller.signal }
    );
    return completion.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(t);
  }
}

module.exports = { generateGrok };
