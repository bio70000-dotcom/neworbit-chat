/**
 * 웹 검색 모듈: 네이버 검색 API (주) + Gemini Google Search (보조)
 * 최신 이슈/뉴스에 대한 질문이 감지되면 검색 후 컨텍스트로 제공
 */

const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
const NAVER_WEB_URL = 'https://openapi.naver.com/v1/search/webkr.json';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// ── 검색 필요 여부 판단 ──────────────────────────────────────
const SEARCH_KEYWORDS = [
  // 시사/뉴스
  '뉴스', '이슈', '사건', '사고', '속보',
  // 시간 관련
  '요즘', '최근', '올해', '이번', '지금', '현재', '오늘',
  // 인물/정치
  '대통령', '총리', '장관', '국회', '선거', '정치',
  // 경제
  '주가', '환율', '코스피', '코스닥', '비트코인', '부동산',
  // 스포츠/연예
  '경기', '월드컵', '올림픽', '우승', '아이돌', '컴백',
  // 날씨/재난
  '날씨', '태풍', '지진', '폭우', '폭설',
  // 질문 패턴
  '알아', '알려줘', '뭐야', '어때', '어떻게 됐', '누가 이겼', '몇이야',
  // 기술
  'ai', 'chatgpt', '챗gpt', '테슬라', '애플', '삼성', '카카오', '네이버'
];

function needsSearch(text) {
  if (!text || text.length < 4) return false;
  const lower = text.toLowerCase();
  // 키워드 2개 이상 매칭 또는, 질문형 + 키워드 1개
  const matched = SEARCH_KEYWORDS.filter((kw) => lower.includes(kw));
  if (matched.length >= 2) return true;
  // 질문형 패턴 (?, ~야?, ~어?)  + 키워드 1개
  const isQuestion = /[?？]/.test(text) || /[야어지냐니까][\s?？]*$/.test(text.trim());
  return isQuestion && matched.length >= 1;
}

// ── 검색 쿼리 추출 ──────────────────────────────────────────
function extractQuery(text) {
  // 불필요한 접미사/채팅체 제거해서 검색 쿼리 최적화
  return text
    .replace(/[?？!~ㅋㅎㅠㅜ]+$/g, '')
    .replace(/(알려줘|알아|뭐야|어때|어떻게 됐|몇이야|누가 이겼|아세요|아시나요|알아요|모르겠는데|누군지|뭔지|인지)/g, '')
    .replace(/(지금|현재|요즘)\s*/g, '2026년 현재 ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

// ── 네이버 검색 ──────────────────────────────────────────────
async function searchNaver(query, type = 'news') {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const baseUrl = type === 'news' ? NAVER_NEWS_URL : NAVER_WEB_URL;
  const url = `${baseUrl}?query=${encodeURIComponent(query)}&display=3&sort=date`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      },
      signal: controller.signal
    });

    if (!res.ok) {
      console.warn(`[NaverSearch] HTTP ${res.status} for "${query}"`);
      return null;
    }

    const data = await res.json();
    const items = data?.items || [];

    return items.map((item) => ({
      title: stripHtml(item.title),
      description: stripHtml(item.description),
      link: item.link || item.originallink || ''
    }));
  } catch (e) {
    if (e.name === 'AbortError') {
      console.warn(`[NaverSearch] Timeout for "${query}"`);
    } else {
      console.warn(`[NaverSearch] Error: ${e.message}`);
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

// ── Gemini 검색 (fallback) ────────────────────────────────────
async function searchGemini(query) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `다음 질문에 대해 최신 정보를 간략하게 3줄 이내로 알려줘: ${query}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.3 }
      }),
      signal: controller.signal
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof content === 'string' ? content.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── 메인: 검색 컨텍스트 생성 ────────────────────────────────────
async function getSearchContext(userText) {
  if (!needsSearch(userText)) return null;

  const query = extractQuery(userText);
  if (!query || query.length < 2) return null;

  // 1차: 네이버 뉴스 검색
  let results = await searchNaver(query, 'news');

  // 네이버 실패 시 웹 검색 시도
  if (!results || results.length === 0) {
    results = await searchNaver(query, 'web');
  }

  const CONTEXT_HEADER = [
    `[최신 검색 결과 - 최우선 적용]`,
    `아래는 방금 인터넷에서 검색한 2026년 최신 정보다.`,
    `네가 기존에 알고 있는 정보와 다르더라도 반드시 아래 검색 결과를 기반으로 답해라.`,
    `출처/URL/검색했다는 사실은 언급하지 마라. 사람처럼 자연스럽게 아는 것처럼 말해라.`,
    ``
  ].join('\n');

  // 네이버 결과 있으면 컨텍스트 생성
  if (results && results.length > 0) {
    const context = results
      .map((r, i) => `${i + 1}. ${r.title}: ${r.description}`)
      .join('\n');
    return `${CONTEXT_HEADER}${context}`;
  }

  // 2차: Gemini 검색 fallback
  const geminiResult = await searchGemini(query);
  if (geminiResult) {
    return `${CONTEXT_HEADER}${geminiResult}`;
  }

  return null;
}

module.exports = { getSearchContext, needsSearch };
