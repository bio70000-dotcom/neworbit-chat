/**
 * 리서치 모듈
 * 선정된 키워드로 네이버 뉴스/블로그 검색하여 팩트/통계 수집
 */

const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
const NAVER_BLOG_URL = 'https://openapi.naver.com/v1/search/blog.json';

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

/**
 * 네이버 검색 API 호출
 * @param {string} query 검색어
 * @param {'news'|'blog'} type 검색 타입
 * @param {number} display 결과 수
 */
async function searchNaver(query, type = 'news', display = 3) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('[Researcher] NAVER API 키가 없습니다');
    return [];
  }

  const baseUrl = type === 'news' ? NAVER_NEWS_URL : NAVER_BLOG_URL;
  const url = `${baseUrl}?query=${encodeURIComponent(query)}&display=${display}&sort=sim`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[Researcher] Naver ${type} HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data?.items || []).map((item) => ({
      title: stripHtml(item.title),
      description: stripHtml(item.description),
      link: item.link || item.originallink || '',
    }));
  } catch (e) {
    console.warn(`[Researcher] Naver ${type} 검색 실패: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 키워드에 대한 리서치 수행
 * 뉴스 3건 + 블로그 3건 검색 후 요약 텍스트 생성
 * @param {string} keyword
 * @returns {Promise<string>} 리서치 결과 텍스트
 */
async function research(keyword) {
  const year = new Date().getFullYear();
  const enrichedQuery = `${year}년 ${keyword}`;

  // 병렬로 뉴스/블로그 검색
  const [newsResults, blogResults] = await Promise.all([
    searchNaver(enrichedQuery, 'news', 3),
    searchNaver(enrichedQuery, 'blog', 3),
  ]);

  const sections = [];

  if (newsResults.length > 0) {
    sections.push('## 최신 뉴스');
    newsResults.forEach((item, i) => {
      sections.push(`${i + 1}. ${item.title}: ${item.description}`);
    });
  }

  if (blogResults.length > 0) {
    sections.push('\n## 관련 블로그');
    blogResults.forEach((item, i) => {
      sections.push(`${i + 1}. ${item.title}: ${item.description}`);
    });
  }

  if (sections.length === 0) {
    return `"${keyword}"에 대한 검색 결과가 없습니다. 일반적인 지식을 기반으로 작성해주세요.`;
  }

  const researchText = sections.join('\n');
  console.log(`[Researcher] "${keyword}" 리서치 완료: 뉴스 ${newsResults.length}건, 블로그 ${blogResults.length}건`);

  return researchText;
}

module.exports = { research };
