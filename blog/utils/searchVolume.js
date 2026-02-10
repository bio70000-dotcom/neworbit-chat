/**
 * 주제 후보의 검색량 지표 수집
 * - 네이버 블로그 검색 결과 수(total) → 검색 수요 대리 지표
 * - 해당일/전일 기준으로 사용 가능 (API는 현재 시점 스냅샷)
 */

const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json';

/**
 * 네이버 블로그 검색 결과 수 조회 (검색량 대리 지표)
 * @param {string} keyword 검색어
 * @returns {Promise<number|null>} 총 검색결과 수, 실패 시 null
 */
async function getNaverBlogSearchTotal(keyword) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `${NAVER_BLOG_URL}?query=${encodeURIComponent(keyword)}&display=1&start=1`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();
    const raw = data.total ?? data.channel?.total;
    const total = typeof raw === 'number' ? raw : parseInt(raw, 10);
    if (Number.isFinite(total) && total >= 0) return total;
    return null;
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * 검색결과 수를 구간 레이블로 변환 (AI·보고용)
 * @param {number|null} total
 * @returns {'높음'|'보통'|'낮음'|'-'}
 */
function getSearchVolumeLabel(total) {
  if (total == null) return '-';
  if (total >= 100000) return '높음';
  if (total >= 5000) return '보통';
  return '낮음';
}

/**
 * 여러 키워드의 네이버 검색량 조회 (순차 호출, API 한도 고려)
 * @param {string[]} keywords
 * @param {number} delayMs 키워드 간 대기 ms
 * @returns {Promise<Map<string, number|null>>} keyword -> total
 */
async function getNaverSearchTotals(keywords, delayMs = 100) {
  const map = new Map();
  for (const kw of keywords) {
    const total = await getNaverBlogSearchTotal(kw);
    map.set(kw, total);
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return map;
}

module.exports = {
  getNaverBlogSearchTotal,
  getSearchVolumeLabel,
  getNaverSearchTotals,
};
