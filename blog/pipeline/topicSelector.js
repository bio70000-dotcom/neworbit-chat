/**
 * 글감 선정 모듈
 * 시즌 캘린더 + Google Trends + 에버그린 주제를 조합하여
 * 하루 3편의 글감을 선정
 */

const calendar = require('../calendar.json');
const evergreen = require('../evergreen.json');
const { getRelevantTrends } = require('../utils/googleTrends');
const { isDuplicate, getEvergreenIndex, incrementEvergreenIndex } = require('../utils/dedup');

/**
 * 시즌 캘린더에서 지금 발행해야 할 주제 찾기
 * (현재 날짜 기준 publishBefore일 이내인 이벤트)
 */
function getSeasonalTopics() {
  const now = new Date();
  const month = String(now.getMonth() + 1); // 1~12
  const day = now.getDate();
  const year = now.getFullYear();

  const monthEvents = calendar[month] || [];

  return monthEvents
    .filter((event) => {
      // publishBefore일 전부터 해당 날짜까지 발행 가능
      const daysUntilEvent = event.publishBefore - day;
      return daysUntilEvent >= 0 && daysUntilEvent <= 21; // 3주 전부터
    })
    .map((event) => ({
      keyword: event.keyword.replace(/\d{4}/, String(year)), // 연도 자동 업데이트
      category: event.category,
      source: 'seasonal',
    }));
}

/**
 * 에버그린 풀에서 다음 주제 가져오기 (순환)
 */
async function getNextEvergreen() {
  const topics = evergreen.topics;
  const idx = await getEvergreenIndex();
  const topic = topics[idx % topics.length];

  return {
    keyword: topic.keyword,
    category: topic.category,
    cta: topic.cta,
    source: 'evergreen',
  };
}

/**
 * Google Trends에서 관련 트렌드 가져오기
 */
async function getTrendTopic() {
  try {
    const trends = await getRelevantTrends();
    if (trends.length === 0) return null;

    // 중복되지 않은 첫 번째 트렌드 선택
    for (const keyword of trends) {
      const dup = await isDuplicate(keyword);
      if (!dup) {
        return {
          keyword,
          category: 'trending',
          source: 'google_trends',
        };
      }
    }

    // 모두 중복이면 첫 번째 반환
    return {
      keyword: trends[0],
      category: 'trending',
      source: 'google_trends',
    };
  } catch (e) {
    console.warn(`[TopicSelector] 트렌드 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 하루 3편의 글감 선정
 * @returns {Promise<Array<{keyword: string, category: string, source: string}>>}
 */
async function selectTopics() {
  const topics = [];

  // 1편: 시즌 캘린더
  const seasonal = getSeasonalTopics();
  let seasonalPicked = null;
  for (const s of seasonal) {
    const dup = await isDuplicate(s.keyword);
    if (!dup) {
      seasonalPicked = s;
      break;
    }
  }

  if (seasonalPicked) {
    topics.push(seasonalPicked);
  } else {
    // 시즌 이벤트 없으면 에버그린으로 대체
    const eg = await getNextEvergreen();
    topics.push(eg);
    await incrementEvergreenIndex(evergreen.topics.length);
  }

  // 2편: 실시간 트렌드
  const trend = await getTrendTopic();
  if (trend) {
    topics.push(trend);
  } else {
    // 트렌드 실패 시 에버그린으로 대체
    const eg = await getNextEvergreen();
    topics.push(eg);
    await incrementEvergreenIndex(evergreen.topics.length);
  }

  // 3편: 에버그린
  const eg = await getNextEvergreen();
  // 이미 선택된 키워드와 중복 확인
  const alreadyPicked = topics.map((t) => t.keyword);
  if (alreadyPicked.includes(eg.keyword)) {
    // 다음 에버그린으로 이동
    await incrementEvergreenIndex(evergreen.topics.length);
    const eg2 = await getNextEvergreen();
    topics.push(eg2);
  } else {
    topics.push(eg);
  }
  await incrementEvergreenIndex(evergreen.topics.length);

  console.log(`[TopicSelector] 선정된 글감 ${topics.length}편:`);
  topics.forEach((t, i) => console.log(`  ${i + 1}. [${t.source}] ${t.keyword}`));

  return topics;
}

module.exports = { selectTopics };
