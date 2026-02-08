const DEFAULT_BASE_URL = 'https://clovastudio.stream.ntruss.com';

// v3 API 전용 모델 (HCX-005, HCX-DASH-002)
const V3_MODELS = ['HCX-005', 'HCX-DASH-002'];

function getClovaApiKey() {
  const apiKey = process.env.CLOVA_API_KEY;
  if (!apiKey) {
    throw new Error('CLOVA_API_KEY is not set');
  }
  return apiKey;
}

async function generateClova({ model, messages, maxTokens, temperature, timeoutMs }) {
  const apiKey = getClovaApiKey();
  const isV3 = V3_MODELS.includes(model);
  const apiVersion = isV3 ? 'v3' : 'v1';
  const url = `${DEFAULT_BASE_URL}/${apiVersion}/chat-completions/${encodeURIComponent(model)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  // v1과 v3의 파라미터 이름이 다름
  const body = isV3
    ? {
        messages,
        temperature,
        maxTokens,
        topP: 0.8,
        topK: 0,
        repetitionPenalty: 1.1,
        stop: [],
        includeAiFilters: false
      }
    : {
        messages,
        temperature,
        maxTokens,
        topP: 0.8,
        topK: 0,
        repeatPenalty: 5.0,
        stopBefore: [],
        includeAiFilters: false
      };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CLOVA HTTP ${res.status} (${apiVersion}): ${text}`);
    }
    const data = await res.json();

    // v3에서 finishReason 로깅
    if (isV3) {
      const finishReason = data?.result?.finishReason;
      if (finishReason && finishReason !== 'stop') {
        console.warn(`[CLOVA v3] finishReason=${finishReason} model=${model}`);
      }
    }

    const content = data?.result?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  } finally {
    clearTimeout(t);
  }
}

module.exports = { generateClova };

