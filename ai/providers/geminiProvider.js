const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  return apiKey;
}

function convertMessagesToGemini(messages) {
  // Gemini uses { contents: [{ role, parts }] } format
  // system message -> systemInstruction
  let systemInstruction = '';
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemInstruction += (systemInstruction ? '\n' : '') + msg.content;
      continue;
    }
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }

  return { systemInstruction, contents };
}

async function generateGemini({ model, messages, maxTokens, temperature, timeoutMs }) {
  const apiKey = getGeminiApiKey();
  const url = `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const { systemInstruction, contents } = convertMessagesToGemini(messages);

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.8
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof content === 'string' ? content.trim() : '';
  } finally {
    clearTimeout(t);
  }
}

module.exports = { generateGemini };
