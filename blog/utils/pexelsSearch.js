/**
 * Pexels 스톡 사진 검색 모듈
 * 블로그 본문 키워드에 맞는 실사 이미지를 Pexels에서 검색
 *
 * - 무료 상업적 사용 가능
 * - 한국어 검색 지원
 * - 200요청/시간 제한
 */

const PEXELS_API_URL = 'https://api.pexels.com/v1/search';

/**
 * Pexels에서 키워드로 사진 검색
 * @param {string} query 검색어
 * @param {number} perPage 결과 수
 * @returns {Promise<Array<{url: string, photographer: string, pexelsUrl: string, alt: string}>>}
 */
async function searchPexels(query, perPage = 3) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.warn('[Pexels] PEXELS_API_KEY가 없습니다');
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({
      query,
      per_page: String(perPage),
      orientation: 'landscape',
      size: 'medium',
    });

    const res = await fetch(`${PEXELS_API_URL}?${params}`, {
      headers: { Authorization: apiKey },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[Pexels] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    const photos = data?.photos || [];

    return photos.map((p) => ({
      url: p.src?.large || p.src?.medium || p.src?.original,
      photographer: p.photographer || 'Unknown',
      pexelsUrl: p.url || 'https://www.pexels.com',
      alt: p.alt || query,
    }));
  } catch (e) {
    console.warn(`[Pexels] 검색 실패: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 블로그 본문 HTML에서 h2 소제목 키워드 추출
 * @param {string} html 본문 HTML
 * @returns {string[]} 키워드 배열
 */
function extractKeywordsFromHtml(html) {
  const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gi;
  const keywords = [];
  let match;

  while ((match = h2Regex.exec(html)) !== null) {
    // HTML 태그 제거
    const text = match[1].replace(/<[^>]*>/g, '').trim();
    if (text && text.length > 2 && text.length < 50) {
      keywords.push(text);
    }
  }

  return keywords;
}

/**
 * 블로그 글의 키워드 기반으로 Pexels 실사 사진 검색
 * 각 h2 소제목에서 키워드를 추출하여 가장 관련 높은 사진 반환
 *
 * @param {string} bodyHtml 본문 HTML
 * @param {string} mainKeyword 글 메인 키워드
 * @param {number} count 필요한 사진 수
 * @returns {Promise<Array<{url, photographer, pexelsUrl, alt}>>}
 */
async function searchRelevantPhotos(bodyHtml, mainKeyword, count = 2) {
  const keywords = extractKeywordsFromHtml(bodyHtml);

  // 메인 키워드도 포함
  const searchTerms = [mainKeyword, ...keywords];

  const results = [];
  const usedUrls = new Set();

  for (const term of searchTerms) {
    if (results.length >= count) break;

    const photos = await searchPexels(term, 2);

    for (const photo of photos) {
      if (results.length >= count) break;
      if (usedUrls.has(photo.url)) continue;

      usedUrls.add(photo.url);
      results.push(photo);
    }
  }

  console.log(`[Pexels] ${results.length}장 실사 사진 검색 완료`);
  return results;
}

module.exports = { searchPexels, searchRelevantPhotos, extractKeywordsFromHtml };
