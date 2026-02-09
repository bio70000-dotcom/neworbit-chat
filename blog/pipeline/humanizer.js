/**
 * 인간화 모듈
 * Claude Sonnet API를 사용하여 AI 초안을 사람처럼 재가공
 * writers.js에서 지정된 작가 페르소나 적용
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── Claude API ──────────────────────────────────────

async function callClaude(systemPrompt, userContent) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY가 설정되지 않았습니다');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('Claude 응답이 비어있습니다');

    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ── 인간화 ──────────────────────────────────────

/**
 * AI 초안을 인간적인 블로그 글로 재가공 (지정된 작가 페르소나 적용)
 * @param {Object} draft - { title, metaDescription, body, tags }
 * @param {Object} writer - writers.js에서 선택된 작가 객체
 * @returns {Promise<Object>} 인간화된 { title, metaDescription, body, tags, writerNickname }
 */
async function humanize(draft, writer) {
  const persona = writer.persona;
  console.log(`[Humanizer] 작가: ${persona.name}`);

  const systemPrompt = `${persona.style}

## HTML 규칙
- h2, h3, p, ul, li, strong, a 태그 유지
- CTA 링크(a 태그)는 반드시 그대로 유지. 절대 삭제하지 마
- 새로운 태그 추가하지 마

## 제목 규칙
- 원래 제목의 SEO 키워드는 유지하되 더 눈길 끄는 표현으로 바꿔도 됨
- 30자 이내

## 품질 규칙
- 원본의 정보량을 줄이지 마. 오히려 더 풍부하게
- 본문 길이가 원본보다 짧아지면 안 됨
- "~입니다", "~습니다" 절대 금지
- "첫째, 둘째, 셋째" 나열 패턴 금지

## 응답 형식
반드시 JSON만 응답. 다른 텍스트 없이:
{
  "title": "수정된 제목",
  "metaDescription": "수정된 메타설명 (150자 이내)",
  "body": "<h2>...</h2><p>...</p>...",
  "tags": ["태그1", "태그2"]
}`;

  const userContent = `아래 블로그 초안을 네 스타일로 완전히 다시 써줘. 정보는 유지하되 말투와 흐름을 인간적으로 바꿔.

## 원본 초안
- 제목: ${draft.title}
- 메타설명: ${draft.metaDescription}
- 태그: ${draft.tags.join(', ')}

## 원본 본문
${draft.body}`;

  try {
    const raw = await callClaude(systemPrompt, userContent);

    const jsonStr = raw
      .replace(/^```json?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const humanized = JSON.parse(jsonStr);

    if (!humanized.title || !humanized.body) {
      throw new Error('인간화된 제목 또는 본문이 없습니다');
    }

    humanized.metaDescription = humanized.metaDescription || draft.metaDescription;
    humanized.tags = humanized.tags || draft.tags;
    humanized.writerNickname = persona.name;

    console.log(`[Humanizer] 인간화 완료: "${humanized.title}" (${humanized.body.length}자) by ${persona.name}`);
    return humanized;
  } catch (e) {
    console.error(`[Humanizer] 인간화 실패, 원본 초안 사용: ${e.message}`);
    draft.writerNickname = persona.name;
    return draft;
  }
}

module.exports = { humanize };
