/**
 * AI(Gemini)로 새 글과 연관된 기존 글 선정 (관련글 링크용)
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.5-flash';

async function callGemini(prompt, maxTokens = 1024) {
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
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 응답이 비어있습니다');
    return text.trim();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * 새 글과 연결성/유사도가 높은 글 최대 maxCount개 선정
 * @param {string} newPostTitle 새 글 제목
 * @param {string} newPostExcerpt 새 글 요약(또는 본문 앞 400자)
 * @param {Array<{ title, post_url, excerpt? }>} candidates 후보 목록
 * @param {number} maxCount 최대 개수 (기본 3)
 * @returns {Promise<Array<{ title, post_url }>>}
 */
async function pickRelatedPosts(newPostTitle, newPostExcerpt, candidates, maxCount = 3) {
  if (!candidates || candidates.length === 0) return [];

  const list = candidates.slice(0, 20).map((c, i) => `${i + 1}. [${c.title}] ${c.post_url}`).join('\n');

  const prompt = `너는 블로그 편집자다. 아래 "새 글"과 연결성·유사도가 높은 기존 글을 최대 ${maxCount}개 골라라.

## 새 글
- 제목: ${newPostTitle}
- 요약: ${(newPostExcerpt || '').slice(0, 500)}

## 후보 글 (번호와 URL만 사용해 골라라)
${list}

## 규칙
- 주제·키워드·독자 관심이 겹치는 순으로 골라라.
- 반드시 후보 목록에 있는 URL만 사용할 것.
- 최대 ${maxCount}개. JSON 배열만 출력할 것.

## 응답 형식 (JSON만)
[
  { "title": "선정한 글 제목", "post_url": "선정한 글 URL" },
  ...
]`;

  try {
    const raw = await callGemini(prompt);
    let jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
    const first = jsonStr.indexOf('[');
    const last = jsonStr.lastIndexOf(']');
    if (first !== -1 && last > first) jsonStr = jsonStr.slice(first, last + 1);
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return [];
    const valid = arr
      .slice(0, maxCount)
      .filter((x) => x && x.post_url)
      .map((x) => ({ title: (x.title || '').trim() || '관련 글', post_url: String(x.post_url).trim() }));
    return valid;
  } catch (e) {
    console.warn(`[RelatedPostsPicker] AI 선정 실패: ${e.message}`);
    return [];
  }
}

module.exports = { pickRelatedPosts };
