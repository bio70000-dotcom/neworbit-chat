/**
 * Google Trends 키워드 수집 모듈
 * google-trends-api 패키지를 사용해 한국 실시간 트렌드 수집
 */

const googleTrends = require('google-trends-api');

// 사이트 관련 카테고리 키워드 (이것과 교집합 되는 트렌드만 선택)
const SITE_KEYWORDS = [
  '채팅', '대화', '소통', '친구', '만남', '심심', '외로',
  '연애', '고민', '상담', '힐링', 'MBTI', '성격', '심리',
  '스트레스', '취미', '혼자', '감성', '일상', '트렌드',
  'AI', '챗봇', '앱', '추천', '방법', '꿀팁', '선물',
  '여행', '맛집', '카페', '데이트', '자취', '직장',
  '건강', '운동', '다이어트', '뷰티', '패션'
];

/**
 * Google Trends에서 한국 실시간 인기 검색어 가져오기
 * @returns {Promise<string[]>} 트렌드 키워드 배열
 */
async function getTrendingKeywords() {
  try {
    const results = await googleTrends.dailyTrends({
      trendDate: new Date(),
      geo: 'KR',
    });

    const parsed = JSON.parse(results);
    const days = parsed?.default?.trendingSearchesDays || [];

    const keywords = [];
    for (const day of days) {
      for (const search of day.trendingSearches || []) {
        const title = search?.title?.query;
        if (title) keywords.push(title);

        // 관련 검색어도 수집
        for (const related of search?.relatedQueries || []) {
          if (related?.query) keywords.push(related.query);
        }
      }
    }

    return keywords.slice(0, 30); // 최대 30개
  } catch (e) {
    console.warn(`[GoogleTrends] 트렌드 수집 실패: ${e.message}`);
    return [];
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
