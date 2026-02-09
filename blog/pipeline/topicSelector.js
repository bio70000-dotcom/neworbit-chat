/**
 * 글감 선정 모듈
 * 작가별 전문 분야에 맞는 주제를 선정
 *
 * 소스 선택 확률:
 *  - Google Trends: 35%
 *  - 네이버 뉴스: 35%
 *  - 시즌 캘린더: 20%
 *  - 에버그린: 10%
 */

const calendar = require('../calendar.json');
const evergreen = require('../evergreen.json');
const { getRelevantTrends } = require('../utils/googleTrends');
const { getNaverNewsTopics } = require('../utils/naverTopics');
const { isDuplicate, getEvergreenIndex, incrementEvergreenIndex } = require('../utils/dedup');

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

// ── 에버그린 주제 ↔ 작가 매칭 ──────────────────

const EVERGREEN_WRITER_MAP = {
  // 달산책 (라이프스타일, 감성, 인간관계)
  '심심할 때 할 것 추천': 'dalsanchek',
  '외로울 때 극복하는 방법': 'dalsanchek',
  '혼자 시간 보내기 좋은 방법': 'dalsanchek',
  '대화 잘 하는 법': 'dalsanchek',
  '인간관계 고민 해결법': 'dalsanchek',
  '번아웃 극복하는 방법': 'dalsanchek',
  '나만의 힐링 루틴 만들기': 'dalsanchek',
  '주말에 혼자 할 수 있는 것': 'dalsanchek',
  '좋은 습관 만들기': 'dalsanchek',
  '독서 습관 들이는 법': 'dalsanchek',
  '자존감 높이는 방법': 'dalsanchek',
  '감성 글귀 모음': 'dalsanchek',

  // 텍스트리 (IT, 테크, 생산성, 경제)
  'AI 챗봇 활용법': 'textree',
  '무료 어플 추천 모음': 'textree',
  '효과적인 메모 방법': 'textree',
  '직장인 점심시간 활용법': 'textree',
  '집에서 할 수 있는 취미 추천': 'textree',

  // 삐뚤빼뚤 (트렌드, 엔터, MBTI, 먹거리)
  'MBTI 유형별 대화 스타일': 'bbittul',
  '익명 대화의 매력과 장점': 'bbittul',
  '스트레스 해소법 모음': 'bbittul',
  '낯선 사람과 대화하는 팁': 'bbittul',
  '온라인 친구 만들기': 'bbittul',
  '자취생 꿀팁 모음': 'bbittul',
  '잠 못 잘 때 하면 좋은 것': 'bbittul',
  '고민 상담 받는 법': 'bbittul',
  '소개팅 대화 주제 추천': 'bbittul',
  'MZ세대 트렌드 모음': 'bbittul',
  '혼밥 맛집 찾는 팁': 'bbittul',
  'SNS 피로감 극복법': 'bbittul',
  '친구 사귀기 어려운 이유': 'bbittul',
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
 * 에버그린 풀에서 작가에 맞는 다음 주제 가져오기
 */
async function getNextEvergreen(writerId) {
  const topics = evergreen.topics;

  // 작가에 맞는 에버그린 주제만 필터
  const writerTopics = topics.filter((t) => {
    const assigned = EVERGREEN_WRITER_MAP[t.keyword];
    return assigned === writerId || !assigned; // 매핑된 것 또는 미배정
  });

  if (writerTopics.length === 0) {
    // fallback: 전체 풀에서
    const idx = await getEvergreenIndex();
    const topic = topics[idx % topics.length];
    await incrementEvergreenIndex(topics.length);
    return { keyword: topic.keyword, category: topic.category, cta: topic.cta, source: 'evergreen' };
  }

  const idx = await getEvergreenIndex();
  const topic = writerTopics[idx % writerTopics.length];
  await incrementEvergreenIndex(writerTopics.length);

  return { keyword: topic.keyword, category: topic.category, cta: topic.cta, source: 'evergreen' };
}

/**
 * Google Trends에서 작가 분야에 맞는 트렌드 가져오기
 */
async function getTrendTopic(writerId) {
  try {
    const trends = await getRelevantTrends();
    if (trends.length === 0) return null;

    const writerKws = WRITER_SEARCH_KEYWORDS[writerId] || [];

    // 작가 분야와 매칭되는 트렌드 우선
    const matched = trends.filter((t) => {
      const lower = t.toLowerCase();
      return writerKws.some((kw) => lower.includes(kw.toLowerCase()));
    });

    const candidates = matched.length > 0 ? matched : trends;

    for (const keyword of candidates) {
      const dup = await isDuplicate(keyword);
      if (!dup) {
        return { keyword, category: 'trending', source: 'google_trends' };
      }
    }

    return { keyword: candidates[0], category: 'trending', source: 'google_trends' };
  } catch (e) {
    console.warn(`[TopicSelector] 트렌드 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 네이버 뉴스에서 작가 분야에 맞는 주제 가져오기
 */
async function getNaverTopic(writerId) {
  try {
    const topics = await getNaverNewsTopics(writerId);
    if (topics.length === 0) return null;

    for (const topic of topics) {
      const dup = await isDuplicate(topic.keyword);
      if (!dup) return topic;
    }

    return topics[0];
  } catch (e) {
    console.warn(`[TopicSelector] 네이버 뉴스 주제 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 소스 목록에서 순서대로 시도
 */
async function trySourcesInOrder(sources, writerId) {
  for (const source of sources) {
    let topic = null;

    switch (source) {
      case 'google_trends':
        topic = await getTrendTopic(writerId);
        break;
      case 'naver_news':
        topic = await getNaverTopic(writerId);
        break;
      case 'seasonal': {
        const seasonal = getSeasonalTopics(writerId);
        for (const s of seasonal) {
          const dup = await isDuplicate(s.keyword);
          if (!dup) { topic = s; break; }
        }
        break;
      }
      case 'evergreen':
        topic = await getNextEvergreen(writerId);
        break;
    }

    if (topic) {
      console.log(`[TopicSelector] 선정: [${topic.source}] "${topic.keyword}"`);
      return topic;
    }
  }

  const eg = await getNextEvergreen(writerId);
  console.log(`[TopicSelector] 선정 (fallback): [${eg.source}] "${eg.keyword}"`);
  return eg;
}

/**
 * 1편의 글감 선정 (작가 분야 기반)
 * @param {Object} writer - 작가 객체 (writers.js)
 */
async function selectTopics(writer) {
  const writerId = writer?.id || 'dalsanchek';
  const roll = Math.random();

  let primarySource;
  let fallbackSources;

  if (roll < 0.35) {
    primarySource = 'google_trends';
    fallbackSources = ['google_trends', 'naver_news', 'seasonal', 'evergreen'];
  } else if (roll < 0.70) {
    primarySource = 'naver_news';
    fallbackSources = ['naver_news', 'google_trends', 'seasonal', 'evergreen'];
  } else if (roll < 0.90) {
    primarySource = 'seasonal';
    fallbackSources = ['seasonal', 'google_trends', 'naver_news', 'evergreen'];
  } else {
    primarySource = 'evergreen';
    fallbackSources = ['evergreen'];
  }

  console.log(`[TopicSelector] 작가: ${writer?.nickname || writerId}, 소스: ${primarySource} (roll: ${roll.toFixed(2)})`);

  const topic = await trySourcesInOrder(fallbackSources, writerId);
  return [topic];
}

module.exports = { selectTopics };
