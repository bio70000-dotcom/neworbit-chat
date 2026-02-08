const DEFAULT_BASE_URL = 'https://clovastudio.stream.ntruss.com';

function getClovaApiKey() {
  const apiKey = process.env.CLOVA_API_KEY;
  if (!apiKey) {
    throw new Error('CLOVA_API_KEY is not set');
  }
  return apiKey;
}

async function generateClova({ model, messages, maxTokens, temperature, timeoutMs }) {
  const apiKey = getClovaApiKey();
  const url = `${DEFAULT_BASE_URL}/v1/chat-completions/${encodeURIComponent(model)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages,
        temperature,
        maxTokens,
        topP: 0.8,
        topK: 0,
        repeatPenalty: 5.0,
        stopBefore: [],
        includeAiFilters: false
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CLOVA HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    const content = data?.result?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  } finally {
    clearTimeout(t);
  }
}

module.exports = { generateClova };

