const OpenAI = require('openai');

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  return new OpenAI({ apiKey });
}

async function generateOpenAI({ model, messages, maxTokens, temperature, timeoutMs }) {
  const openai = getOpenAIClient();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const completion = await openai.chat.completions.create(
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

module.exports = { generateOpenAI };

