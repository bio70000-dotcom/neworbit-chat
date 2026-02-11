/**
 * Google Trends 키워드 수집 모듈
 * Google Trends RSS 피드를 직접 파싱하여 한국 실시간 트렌드 수집
 * (google-trends-api npm 패키지가 불안정하여 직접 구현)
 */

const TRENDS_RSS_URL = 'https://trends.google.co.kr/trending/rss?geo=KR';

// 사이트 관련 카테고리 키워드 (이것과 교집합 되는 트렌드만 선택)
const SITE_KEYWORDS = [
  '채팅', '대화', '소통', '친구', '만남', '심심', '외로',
  '연애', '고민', '상담', '힐링', 'MBTI', '성격', '심리',
  '스트레스', '취미', '혼자', '감성', '일상', '트렌드',
  'AI', '챗봇', '앱', '추천', '방법', '꿀팁', '선물',
  '여행', '맛집', '카페', '데이트', '자취', '직장',
  '건강', '운동', '다이어트', '뷰티', '패션',
  '영화', '드라마', '게임', '음악', '공부', '시험',
  '부동산', '주식', '투자', '절약', '재테크',
];

/**
 * Google Trends RSS에서 한국 실시간 인기 검색어 가져오기
 * @returns {Promise<string[]>} 트렌드 키워드 배열
 */
async function getTrendingKeywords() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(TRENDS_RSS_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const xml = await res.text();

    // RSS XML에서 <title> 태그 파싱 (간단한 정규식)
    const keywords = [];
    const titleRegex = /<title><!\[CDATA\[(.+?)\]\]><\/title>/g;
    let match;
    while ((match = titleRegex.exec(xml)) !== null) {
      const title = match[1].trim();
      // RSS의 첫 번째 <title>은 피드 제목이므로 스킵
      if (title && !title.includes('Trending') && !title.includes('트렌드')) {
        keywords.push(title);
      }
    }

    // CDATA 없는 형식도 시도
    if (keywords.length === 0) {
      const simpleTitleRegex = /<title>([^<]+)<\/title>/g;
      while ((match = simpleTitleRegex.exec(xml)) !== null) {
        const title = match[1].trim();
        if (title && !title.includes('Trending') && !title.includes('Daily') && title.length > 1) {
          keywords.push(title);
        }
      }
    }

    // 단일 단어(인명 등) 제외: 공백 기준 2단어 이상인 제목만 사용
    const multiWord = keywords.filter((t) => t.trim().split(/\s+/).length >= 2);
    console.log(`[GoogleTrends] RSS에서 ${keywords.length}개 수집, 2단어 이상 ${multiWord.length}개`);
    return multiWord.slice(0, 30);
  } catch (e) {
    console.warn(`[GoogleTrends] RSS 수집 실패: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 트렌드 키워드 중 사이트 관련 키워드와 매칭되는 것 필터링
 * @returns {Promise<string[]>} 필터링된 키워드 배열
 */
async function getRelevantTrends() {
  const trends = await getTrendingKeywords();
  if (trends.length === 0) return [];

  // 사이트 키워드와 교집합 필터링
  const relevant = trends.filter((trend) => {
    const lower = trend.toLowerCase();
    return SITE_KEYWORDS.some((kw) => lower.includes(kw));
  });

  // 매칭되는게 없으면 트렌드 상위 5개 그대로 반환 (범용 주제로 활용)
  if (relevant.length === 0) {
    return trends.slice(0, 5);
  }

  return relevant.slice(0, 10);
}

module.exports = { getTrendingKeywords, getRelevantTrends };
