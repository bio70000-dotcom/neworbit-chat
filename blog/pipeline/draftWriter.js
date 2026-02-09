/**
 * 초안 생성 모듈
 * Gemini 2.5 Flash를 사용하여 SEO 최적화된 블로그 초안 생성
 * 글 길이, 구조, CTA, temperature를 랜덤화하여 봇 패턴 회피
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

// ── 랜덤 설정 풀 ──────────────────────────────────────

const LENGTH_RANGES = [
  { min: 900, max: 1200, label: '간결하게' },
  { min: 1200, max: 1600, label: '적당한 길이로' },
  { min: 1600, max: 2000, label: '깊이있게' },
];

const HEADING_COUNTS = [2, 3, 3, 4, 4, 5]; // 가중치 포함 (3~4개가 많이 나오게)

const CTA_VARIANTS = [
  { text: '지금 채팅 시작하기', link: 'https://chat.neworbit.co.kr' },
  { text: '누군가와 대화해보기', link: 'https://chat.neworbit.co.kr' },
  { text: '지금 전파 보내기', link: 'https://wave.neworbit.co.kr' },
  { text: '랜덤 메시지 보내보기', link: 'https://wave.neworbit.co.kr' },
  { text: '심심할 때 여기 들어와보세요', link: 'https://wave.neworbit.co.kr' },
  { text: '새로운 사람과 이야기하기', link: 'https://chat.neworbit.co.kr' },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTemp() {
  return +(0.7 + Math.random() * 0.25).toFixed(2); // 0.70 ~ 0.95
}

// ── Gemini API ──────────────────────────────────────

async function callGemini(prompt, maxTokens = 2048, temperature = 0.8) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');

  const url = `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 응답이 비어있습니다');

    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

// ── 초안 생성 ──────────────────────────────────────

/**
 * 블로그 초안 생성 (랜덤 설정 적용)
 * @param {Object} topic - { keyword, category, source, cta? }
 * @param {string} researchData - 리서치 결과 텍스트
 * @returns {Promise<Object>} { title, metaDescription, body, tags }
 */
async function writeDraft(topic, researchData) {
  const year = new Date().getFullYear();

  // 랜덤 설정
  const lengthRange = pick(LENGTH_RANGES);
  const headingCount = pick(HEADING_COUNTS);
  const cta = topic.cta === 'wave'
    ? pick(CTA_VARIANTS.filter((c) => c.link.includes('wave')))
    : topic.cta === 'chat'
      ? pick(CTA_VARIANTS.filter((c) => c.link.includes('chat')))
      : pick(CTA_VARIANTS);
  const temp = randomTemp();

  console.log(`[DraftWriter] 설정: ${lengthRange.min}~${lengthRange.max}자, h2 ${headingCount}개, temp ${temp}`);

  const prompt = `너는 한국의 SEO 전문 블로그 작가야. 아래 정보를 바탕으로 블로그 글을 작성해.

## 요청 사항
- 키워드: "${topic.keyword}"
- 카테고리: ${topic.category}
- 연도: ${year}년

## 리서치 자료
${researchData}

## 작성 규칙
1. JSON 형식으로만 응답해. 다른 텍스트 없이 순수 JSON만.
2. 제목: 검색 키워드를 자연스럽게 포함. 30자 이내. 숫자나 리스트형 제목 선호.
3. 메타설명: 150자 이내. 검색 결과에 노출되는 설명문.
4. 본문: ${lengthRange.min}~${lengthRange.max}자 분량. ${lengthRange.label} 써줘. HTML 형식(h2, h3, p, ul, li 태그 사용).
   - 도입: 독자의 공감을 이끄는 훅 (1~2문장)
   - 본문: ${headingCount}개 소제목(h2)으로 구분
   - 마무리: 자연스러운 마무리 + CTA
5. 본문 마지막에 아래 CTA를 자연스럽게 넣어:
   <p><strong><a href="${cta.link}">${cta.text} →</a></strong></p>
6. 태그: 3~5개 관련 태그 배열
7. "${year}년" 현재 기준으로 최신 정보 반영

## 핵심 품질 규칙 (최우선!)
- **팩트 체크 필수**: 통계, 수치, 제품명, 가격, 날짜 등은 반드시 정확해야 함. 확실하지 않으면 "~로 알려져 있다", "~라는 의견이 있다" 등으로 표현
- **영양가 있는 글만**: 독자가 읽고 나서 "이건 도움이 됐다"고 느낄 수 있는 실질적 정보를 담아
- **뻔한 서론 금지**: "오늘은 ~에 대해 알아보겠습니다" 같은 허수 도입부 절대 금지. 바로 핵심으로 들어가
- **주변 소리 금지**: "이런저런 방법이 있는데요~" 같이 둘러대지 마. 구체적인 이름, 수치, 방법을 직접 말해
- **리스트형이면 각 항목에 왜 좋은지, 주의점은 뭔지, 실제 경험/비교가 포함되어야 함**
- 구체적인 예시, 수치, 비교를 최소 3개 이상 포함해
- 본문 최소 ${lengthRange.min}자 이상 반드시 지켜
- 완전히 독창적인 시각으로 써. 절대 다른 글을 복사하지 마
- 리서치 자료의 핵심 사실을 반영하되 그대로 베끼지 마

## 응답 형식 (JSON)
{
  "title": "제목",
  "metaDescription": "메타 설명",
  "body": "<h2>소제목</h2><p>본문...</p>...",
  "tags": ["태그1", "태그2", "태그3"]
}`;

  const raw = await callGemini(prompt, 8192, temp);

  // JSON 파싱 (마크다운 코드블록 제거 + JSON 경계 감지)
  let jsonStr = raw
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // JSON 객체 경계 감지
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    const draft = JSON.parse(jsonStr);

    if (!draft.title || !draft.body) {
      throw new Error('제목 또는 본문이 없습니다');
    }

    draft.metaDescription = draft.metaDescription || '';
    draft.tags = draft.tags || [topic.keyword];

    console.log(`[DraftWriter] 초안 생성 완료: "${draft.title}" (${draft.body.length}자)`);
    return draft;
  } catch (e) {
    console.error(`[DraftWriter] JSON 파싱 실패: ${e.message}`);
    console.error(`[DraftWriter] Raw response: ${raw.slice(0, 300)}`);

    // Fallback: raw에서 body 필드만 정규식으로 추출 시도
    const bodyMatch = raw.match(/"body"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    if (bodyMatch) {
      const extractedBody = bodyMatch[1]
        .replace(/\\n/g, '')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      const titleMatch = raw.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      console.log('[DraftWriter] body 필드 정규식 추출 성공');
      return {
        title: titleMatch ? titleMatch[1] : `${topic.keyword} - ${year}년 가이드`,
        metaDescription: `${year}년 ${topic.keyword}에 대한 모든 것을 알려드립니다.`,
        body: extractedBody,
        tags: [topic.keyword, topic.category],
      };
    }

    // 최종 Fallback: JSON 잔해물 제거 후 순수 텍스트만 사용
    const cleanText = raw
      .replace(/```json?\s*/gi, '')
      .replace(/```/g, '')
      .replace(/[{}"]/g, '')
      .replace(/^\s*(title|metaDescription|body|tags)\s*:/gm, '')
      .trim()
      .slice(0, 2000);

    return {
      title: `${topic.keyword} - ${year}년 완벽 가이드`,
      metaDescription: `${year}년 ${topic.keyword}에 대한 모든 것을 알려드립니다.`,
      body: `<h2>${topic.keyword}</h2><p>${cleanText}</p>`,
      tags: [topic.keyword, topic.category],
    };
  }
}

module.exports = { writeDraft };
