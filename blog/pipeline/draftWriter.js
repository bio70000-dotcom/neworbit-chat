/**
 * 초안 생성 모듈
 * Gemini 2.5 Flash를 사용하여 SEO 최적화된 블로그 초안 생성
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash-preview-05-20';

/**
 * Gemini API 호출
 */
async function callGemini(prompt, maxTokens = 2048) {
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
          temperature: 0.8,
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

/**
 * 블로그 초안 생성
 * @param {Object} topic - { keyword, category, source, cta? }
 * @param {string} researchData - 리서치 결과 텍스트
 * @returns {Promise<Object>} { title, metaDescription, body, tags }
 */
async function writeDraft(topic, researchData) {
  const year = new Date().getFullYear();
  const ctaLink = topic.cta === 'wave'
    ? 'https://wave.neworbit.co.kr'
    : 'https://chat.neworbit.co.kr';
  const ctaText = topic.cta === 'wave'
    ? '지금 전파 보내기'
    : '지금 채팅 시작하기';

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
4. 본문: 800~1500자. HTML 형식(h2, h3, p, ul, li 태그 사용).
   - 도입: 독자의 공감을 이끄는 훅 (1~2문장)
   - 본문: 3~4개 소제목(h2)으로 구분
   - 마무리: 자연스러운 마무리 + CTA
5. 본문 마지막에 아래 CTA를 자연스럽게 넣어:
   <p><strong><a href="${ctaLink}">${ctaText} →</a></strong></p>
6. 태그: 3~5개 관련 태그 배열
7. "${year}년" 현재 기준으로 최신 정보 반영

## 응답 형식 (JSON)
{
  "title": "제목",
  "metaDescription": "메타 설명",
  "body": "<h2>소제목</h2><p>본문...</p>...",
  "tags": ["태그1", "태그2", "태그3"]
}`;

  const raw = await callGemini(prompt, 2048);

  // JSON 파싱 (마크다운 코드블록 제거)
  const jsonStr = raw
    .replace(/^```json?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const draft = JSON.parse(jsonStr);

    // 필수 필드 검증
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

    // 파싱 실패 시 기본 구조로 반환
    return {
      title: `${topic.keyword} - ${year}년 완벽 가이드`,
      metaDescription: `${year}년 ${topic.keyword}에 대한 모든 것을 알려드립니다.`,
      body: `<h2>${topic.keyword}</h2><p>${raw.slice(0, 1500)}</p>`,
      tags: [topic.keyword, topic.category],
    };
  }
}

module.exports = { writeDraft };
