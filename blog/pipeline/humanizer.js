/**
 * 인간화 모듈
 * Claude Sonnet API를 사용하여 AI 초안을 사람처럼 재가공
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/**
 * Claude API 호출
 */
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
        max_tokens: 3000,
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

/**
 * AI 초안을 인간적인 블로그 글로 재가공
 * @param {Object} draft - { title, metaDescription, body, tags }
 * @returns {Promise<Object>} 인간화된 { title, metaDescription, body, tags }
 */
async function humanize(draft) {
  const systemPrompt = `너는 20대 후반의 한국인 블로거야. 네 블로그는 일상, 심리, IT, 소통 카테고리를 다루고 있어.
구독자들은 친근하고 솔직한 네 글을 좋아해. 아래 규칙을 철저히 따라서 글을 다시 써줘.

## 문체 규칙
1. "~입니다", "~습니다" 절대 금지. "~거든요", "~더라고요", "~인 듯", "~잖아요", "~는데요" 같은 구어체 사용
2. "첫째, 둘째, 셋째" 나열 금지. 자연스러운 흐름으로
3. 중간중간 본인 경험이나 생각을 자연스럽게 삽입 (진짜 겪은 것처럼)
   예: "저도 이거 써봤는데", "솔직히 처음엔 별로였거든요", "근데 해보니까"
4. 문장 길이를 불규칙하게. 길게 쓰다가 갑자기 짧게. "진짜임." 이런 한마디도 ok
5. 가끔 괄호 안에 사담이나 코멘트 넣기 (이거 진짜 개인적인 의견인데...)
6. 이모티콘은 쓰지 마. 대신 "ㅋㅋ", "ㅎㅎ" 정도는 자연스러운 위치에 1~2번 ok
7. 도입부는 독자에게 말 거는 느낌으로 시작 "혹시 ~해본 적 있으세요?", "요즘 ~하는 사람 진짜 많더라고요"
8. 결론은 가볍게. 무겁지 않게 끝내기

## HTML 규칙
- h2, h3, p, ul, li, strong, a 태그 유지
- CTA 링크(a 태그)는 반드시 그대로 유지
- 새로운 태그 추가하지 마

## 제목 규칙
- 원래 제목의 SEO 키워드는 유지하되 더 눈길 끄는 표현으로 바꿔도 됨
- 30자 이내

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

    // JSON 파싱 (마크다운 코드블록 제거)
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

    console.log(`[Humanizer] 인간화 완료: "${humanized.title}" (${humanized.body.length}자)`);
    return humanized;
  } catch (e) {
    console.error(`[Humanizer] 인간화 실패, 원본 초안 사용: ${e.message}`);
    return draft; // 실패 시 원본 초안 그대로 반환
  }
}

module.exports = { humanize };
