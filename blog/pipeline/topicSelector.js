/**
 * 글감 선정 모듈
 * 작가별 전문 분야에 맞는 주제를 선정
 *
 * 소스 선택 확률:
 *  - 시즌 캘린더: 40%
 *  - 네이버 뉴스: 30%
 *  - Google Trends: 30%
 */

const calendar = require('../calendar.json');
const { getRelevantTrends } = require('../utils/googleTrends');
const { getNaverNewsTopics } = require('../utils/naverTopics');
const { isDuplicate } = require('../utils/dedup');

// ── 작가별 카테고리 → 검색 키워드 매핑 ──────────────────

const WRITER_SEARCH_KEYWORDS = {
  dalsanchek: [
    '라이프스타일', '일상', '감성', '인간관계', '자기계발', '여행',
    '카페', '힐링', '취미', '선물', '데이트', '산책', '독서',
    '자존감', '명상', '감정', '관계', '우정', '습관',
  ],
  textree: [
    'IT', '테크', '생산성', '경제', '리뷰', '앱',
    'AI', '개발', '가젯', '서비스', '투자', '재테크',
    '부업', '효율', '자동화', '비교', '분석', '플랫폼',
  ],
  bbittul: [
    '트렌드', '엔터', 'MBTI', '먹거리', '꿀팁', '후기',
    '맛집', '신상', 'MZ', '밈', '게임', '유행',
    '넷플릭스', '다이어트', '운동', '패션', '뷰티', '핫플',
  ],
};


/**
 * 시즌 캘린더에서 작가에 맞는 주제 찾기
 */
function getSeasonalTopics(writerId) {
  const now = new Date();
  const month = String(now.getMonth() + 1);
  const day = now.getDate();
  const year = now.getFullYear();
  const writerKws = WRITER_SEARCH_KEYWORDS[writerId] || [];

  const monthEvents = calendar[month] || [];

  return monthEvents
    .filter((event) => {
      const daysUntilEvent = event.publishBefore - day;
      if (daysUntilEvent < 0 || daysUntilEvent > 21) return false;
      // 작가 분야와 시즌 키워드가 관련 있는지 체크
      const kw = event.keyword.toLowerCase();
      const cat = (event.category || '').toLowerCase();
      return writerKws.some((w) => kw.includes(w.toLowerCase()) || cat.includes(w.toLowerCase()));
    })
    .map((event) => ({
      keyword: event.keyword.replace(/\d{4}/, String(year)),
      category: event.category,
      source: 'seasonal',
    }));
}

/**
 * Google Trends에서 작가 분야에 맞는 트렌드 가져오기
 * 매칭되는 트렌드가 없으면 null (작가와 무관한 트렌드 할당 방지)
 */
async function getTrendTopic(writerId, excludeKeywords = new Set()) {
  try {
    const trends = await getRelevantTrends();
    if (trends.length === 0) return null;

    const writerKws = WRITER_SEARCH_KEYWORDS[writerId] || [];

    const matched = trends.filter((t) => {
      const lower = t.toLowerCase();
      return writerKws.some((kw) => lower.includes(kw.toLowerCase()));
    });

    // 작가 분야와 매칭되는 트렌드만 사용. 없으면 null (다른 소스 시도)
    const candidates = matched.length > 0 ? matched : [];

    for (const keyword of candidates) {
      if (excludeKeywords.has(keyword)) continue;
      const dup = await isDuplicate(keyword);
      if (!dup) {
        return { keyword, category: 'trending', source: 'google_trends' };
      }
    }

    return null;
  } catch (e) {
    console.warn(`[TopicSelector] 트렌드 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 네이버 뉴스에서 작가 분야에 맞는 주제 가져오기
 */
async function getNaverTopic(writerId, excludeKeywords = new Set()) {
  try {
    const topics = await getNaverNewsTopics(writerId);
    if (topics.length === 0) return null;

    for (const topic of topics) {
      if (excludeKeywords.has(topic.keyword)) continue;
      const dup = await isDuplicate(topic.keyword);
      if (!dup) return topic;
    }

    return null;
  } catch (e) {
    console.warn(`[TopicSelector] 네이버 뉴스 주제 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 소스 목록에서 순서대로 시도
 * @param {Set<string>} [excludeKeywords] - 오늘 이미 선정된 키워드 (중복 방지)
 */
async function trySourcesInOrder(sources, writerId, excludeKeywords = new Set()) {
  for (const source of sources) {
    let topic = null;

    switch (source) {
      case 'google_trends':
        topic = await getTrendTopic(writerId, excludeKeywords);
        break;
      case 'naver_news':
        topic = await getNaverTopic(writerId, excludeKeywords);
        break;
      case 'seasonal': {
        const seasonal = getSeasonalTopics(writerId);
        for (const s of seasonal) {
          if (excludeKeywords.has(s.keyword)) continue;
          const dup = await isDuplicate(s.keyword);
          if (!dup) { topic = s; break; }
        }
        break;
      }
    }

    if (topic) {
      console.log(`[TopicSelector] 선정: [${topic.source}] "${topic.keyword}"`);
      return topic;
    }
  }

  // 최종 fallback: 시즌 → 네이버 → 트렌드 순환
  console.warn('[TopicSelector] 모든 소스 실패, fallback 재시도');
  const fallbackOrder = ['seasonal', 'naver_news', 'google_trends'];
  for (const fb of fallbackOrder) {
    let topic = null;
    if (fb === 'seasonal') {
      const seasonal = getSeasonalTopics(writerId).filter((s) => !excludeKeywords.has(s.keyword));
      if (seasonal.length > 0) topic = seasonal[0];
    } else if (fb === 'naver_news') {
      topic = await getNaverTopic(writerId, excludeKeywords);
    } else {
      topic = await getTrendTopic(writerId, excludeKeywords);
    }
    if (topic) {
      console.log(`[TopicSelector] 선정 (fallback): [${topic.source}] "${topic.keyword}"`);
      return topic;
    }
  }

  // 정말 아무것도 없을 때 - 작가 카테고리 기반 기본 주제
  const writerKws = WRITER_SEARCH_KEYWORDS[writerId] || ['라이프스타일'];
  const defaultKeyword = `${new Date().getFullYear()}년 ${writerKws[0]} 트렌드`;
  console.log(`[TopicSelector] 선정 (기본): "${defaultKeyword}"`);
  return { keyword: defaultKeyword, category: writerKws[0], source: 'default' };
}

/**
 * 1편의 글감 선정 (작가 분야 기반)
 * @param {Object} writer - 작가 객체 (writers.js)
 * @param {{ excludeKeywords?: Set<string> }} [options] - 오늘 이미 쓴 키워드 (중복 방지)
 */
async function selectTopics(writer, options = {}) {
  const writerId = writer?.id || 'dalsanchek';
  const excludeKeywords = options.excludeKeywords || new Set();
  const roll = Math.random();

  let primarySource;
  let fallbackSources;

  if (roll < 0.40) {
    primarySource = 'seasonal';
    fallbackSources = ['seasonal', 'naver_news', 'google_trends'];
  } else if (roll < 0.70) {
    primarySource = 'naver_news';
    fallbackSources = ['naver_news', 'google_trends', 'seasonal'];
  } else {
    primarySource = 'google_trends';
    fallbackSources = ['google_trends', 'naver_news', 'seasonal'];
  }

  console.log(`[TopicSelector] 작가: ${writer?.nickname || writerId}, 소스: ${primarySource} (roll: ${roll.toFixed(2)})`);

  const topic = await trySourcesInOrder(fallbackSources, writerId, excludeKeywords);
  return [topic];
}

module.exports = { selectTopics };
