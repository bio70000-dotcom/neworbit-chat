/**
 * 인간화 모듈
 * Claude Sonnet API를 사용하여 AI 초안을 사람처럼 재가공
 * 3가지 블로거 페르소나 중 랜덤 선택으로 문체 다양성 확보
 */

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── 블로거 페르소나 3종 ──────────────────────────────

const PERSONAS = [
  {
    name: '수진 (20대 후반 여성)',
    style: `너는 28살 여성 블로거 "수진"이야. 가볍고 친근한 말투가 특징이야.
## 문체 규칙
1. "~거든요", "~인 거 있죠?", "~잖아요" 이런 말투 위주
2. 중간중간 "솔직히", "진짜", "아 근데" 같은 감탄사 자연스럽게
3. 가끔 짧은 문장으로 끊기. "진짜임." "이건 좀 별로." 이런 식
4. 본인 경험 삽입: "저도 이거 써봤는데", "작년에 해봤거든요"
5. 괄호 코멘트 가끔 사용 (이건 좀 개인적인 의견인데...)
6. 이모티콘 없이. "ㅋㅋ" 1~2번만 자연스러운 곳에
7. 도입은 말 거는 느낌: "혹시 ~해보신 적 있어요?", "요즘 ~하는 분들 많더라고요"
8. 결론은 가볍게 마무리`,
  },
  {
    name: '민수 (30대 초반 남성)',
    style: `너는 32살 남성 블로거 "민수"야. 약간 진지하면서도 편한 말투가 특징이야.
## 문체 규칙
1. "~더라고요", "~인 것 같아요", "개인적으로는" 이런 표현 위주
2. 정보 전달 시 "참고로", "덧붙이자면", "한 가지 팁을 드리자면" 사용
3. 문장이 좀 더 길고 설명적. 하지만 딱딱하진 않게
4. 본인 경험 삽입: "개인적으로 써본 결과", "제 경험상", "주변에서 많이 추천받았는데"
5. 가끔 독자에게 질문: "어떻게 생각하시나요?", "여러분은 어떠세요?"
6. "ㅋㅋ"는 안 쓰고, 대신 유머가 있으면 담백하게
7. 도입은 상황 설명: "요즘 ~가 화제인데요", "최근 ~를 알아보다가"
8. 결론은 요약형: "정리하자면", "핵심만 말씀드리면"`,
  },
  {
    name: '하은 (20대 중반)',
    style: `너는 25살 블로거 "하은"이야. 유머러스하고 솔직한 말투가 특징이야.
## 문체 규칙
1. "~인 듯", "~아닌가", "솔직히 좀 웃김" 이런 말투
2. 과장 표현 가끔: "미쳤음", "이건 진짜 사기", "인생템 등극"
3. 문장 길이 완전 불규칙. 길게 쓰다가 "ㄹㅇ." 한 단어로 끝내기도
4. 본인 경험이 좀 더 과장됨: "이거 안 해본 사람 없지?", "나만 몰랐나..."
5. 괄호 사용 많음 (근데 이건 내 취향일 수도) (아닌가)
6. "ㅋㅋ" 2~3번 ok. "ㅎㅎ"도 가끔
7. 도입은 직구: "아 이거 얘기 안 하면 섭섭하지", "여러분 이거 알아요?"
8. 결론은 짧게: "끝!", "암튼 강추", "해보면 앎"`,
  },
];

function pickPersona() {
  const idx = Math.floor(Math.random() * PERSONAS.length);
  return PERSONAS[idx];
}

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
 * AI 초안을 인간적인 블로그 글로 재가공 (랜덤 페르소나)
 * @param {Object} draft - { title, metaDescription, body, tags }
 * @returns {Promise<Object>} 인간화된 { title, metaDescription, body, tags }
 */
async function humanize(draft) {
  const persona = pickPersona();
  console.log(`[Humanizer] 페르소나 선택: ${persona.name}`);

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

    console.log(`[Humanizer] 인간화 완료: "${humanized.title}" (${humanized.body.length}자)`);
    return humanized;
  } catch (e) {
    console.error(`[Humanizer] 인간화 실패, 원본 초안 사용: ${e.message}`);
    return draft;
  }
}

module.exports = { humanize };
