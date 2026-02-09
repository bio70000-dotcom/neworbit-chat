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
  const timeout = setTimeout(() => controller.abort(), 30000);

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

## 품질 규칙 (중요!)
- 절대 다른 글을 복사하지 마. 완전히 독창적인 시각으로 써
- 구체적인 예시, 수치, 비교를 최소 2개 이상 포함해
- 본문 최소 ${lengthRange.min}자 이상 반드시 지켜. 이보다 짧으면 안 됨
- 단순 나열이 아닌, 각 항목에 대한 설명이나 경험이 포함되어야 해
- 독자에게 실질적으로 도움이 되는 정보를 담아

## 응답 형식 (JSON)
{
  "title": "제목",
  "metaDescription": "메타 설명",
  "body": "<h2>소제목</h2><p>본문...</p>...",
  "tags": ["태그1", "태그2", "태그3"]
}`;

  const raw = await callGemini(prompt, 8192, temp);

  // JSON 파싱 (마크다운 코드블록 제거)
  const jsonStr = raw
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

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

    return {
      title: `${topic.keyword} - ${year}년 완벽 가이드`,
      metaDescription: `${year}년 ${topic.keyword}에 대한 모든 것을 알려드립니다.`,
      body: `<h2>${topic.keyword}</h2><p>${raw.slice(0, 2000)}</p>`,
      tags: [topic.keyword, topic.category],
    };
  }
}

module.exports = { writeDraft };
