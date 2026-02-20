/**
 * Unsplash 스톡 사진 검색 모듈
 * 블로그 본문 키워드에 맞는 실사 이미지를 Unsplash에서 검색
 *
 * - 무료 사용 (API Guidelines 준수, 출처 표기 필수)
 * - Demo: 50 req/h, Production 승인 시 상향
 * - 반환 형식: publisher 호환 (url, photographer, creditUrl, alt, source: 'unsplash')
 */

const { extractKeywordsFromHtml } = require('./pexelsSearch');

const UNSPLASH_API_URL = 'https://api.unsplash.com/search/photos';

/**
 * Unsplash에서 키워드로 사진 검색
 * @param {string} query 검색어
 * @param {number} perPage 결과 수 (최대 30)
 * @returns {Promise<Array<{url: string, photographer: string, creditUrl: string, alt: string, source: 'unsplash'}>>}
 */
async function searchUnsplash(query, perPage = 3) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    console.warn('[Unsplash] UNSPLASH_ACCESS_KEY가 없습니다');
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({
      query,
      per_page: String(Math.min(perPage, 10)),
      orientation: 'landscape',
    });

    const res = await fetch(`${UNSPLASH_API_URL}?${params}`, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[Unsplash] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const results = data?.results || [];

    return results.map((p) => ({
      url: p.urls?.regular || p.urls?.small || p.urls?.full,
      photographer: p.user?.name || p.user?.username || 'Unknown',
      creditUrl: p.links?.html || 'https://unsplash.com',
      alt: p.description || p.alt_description || query,
      source: 'unsplash',
    }));
  } catch (e) {
    console.warn(`[Unsplash] 검색 실패: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 블로그 글의 키워드 기반으로 Unsplash 실사 사진 검색
 * @param {string} bodyHtml 본문 HTML
 * @param {string} mainKeyword 글 메인 키워드
 * @param {number} count 필요한 사진 수
 * @returns {Promise<Array<{url, photographer, creditUrl, alt, source: 'unsplash'}>>}
 */
async function searchRelevantPhotos(bodyHtml, mainKeyword, count = 2) {
  const keywords = extractKeywordsFromHtml(bodyHtml);
  const searchTerms = [mainKeyword, ...keywords];

  const results = [];
  const usedUrls = new Set();

  for (const term of searchTerms) {
    if (results.length >= count) break;

    const photos = await searchUnsplash(term, 2);

    for (const photo of photos) {
      if (results.length >= count) break;
      if (usedUrls.has(photo.url)) continue;

      usedUrls.add(photo.url);
      results.push(photo);
    }
  }

  if (results.length > 0) {
    console.log(`[Unsplash] ${results.length}장 실사 사진 검색 완료`);
  }
  return results;
}

module.exports = { searchUnsplash, searchRelevantPhotos };
