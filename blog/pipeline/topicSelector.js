/**
 * 글감 선정 모듈
 * 시즌 캘린더 + Google Trends + 에버그린 주제를 조합하여
 * 1회 실행 시 1편의 글감을 선정 (cron 3회 x 1편 = 하루 3편)
 *
 * 소스 선택 확률:
 *  - 시즌 캘린더: 40% (해당 시기 이벤트가 있을 때)
 *  - 트렌드: 30%
 *  - 에버그린: 30% (또는 시즌/트렌드 없을 때 fallback)
 */

const calendar = require('../calendar.json');
const evergreen = require('../evergreen.json');
const { getRelevantTrends } = require('../utils/googleTrends');
const { isDuplicate, getEvergreenIndex, incrementEvergreenIndex } = require('../utils/dedup');

/**
 * 시즌 캘린더에서 지금 발행해야 할 주제 찾기
 */
function getSeasonalTopics() {
  const now = new Date();
  const month = String(now.getMonth() + 1);
  const day = now.getDate();
  const year = now.getFullYear();

  const monthEvents = calendar[month] || [];

  return monthEvents
    .filter((event) => {
      const daysUntilEvent = event.publishBefore - day;
      return daysUntilEvent >= 0 && daysUntilEvent <= 21;
    })
    .map((event) => ({
      keyword: event.keyword.replace(/\d{4}/, String(year)),
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

  await incrementEvergreenIndex(topics.length);

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
 * 1편의 글감 선정 (랜덤 소스 선택)
 * @returns {Promise<Array>} 1편짜리 배열
 */
async function selectTopics() {
  // 소스 우선순위를 랜덤하게 결정
  const roll = Math.random();

  // 40%: 시즌 캘린더 우선
  if (roll < 0.4) {
    const seasonal = getSeasonalTopics();
    for (const s of seasonal) {
      const dup = await isDuplicate(s.keyword);
      if (!dup) {
        console.log(`[TopicSelector] 선정: [${s.source}] "${s.keyword}"`);
        return [s];
      }
    }
    // 시즌 이벤트 없으면 에버그린 fallback
  }

  // 30%: 트렌드 우선
  if (roll < 0.7) {
    const trend = await getTrendTopic();
    if (trend) {
      console.log(`[TopicSelector] 선정: [${trend.source}] "${trend.keyword}"`);
      return [trend];
    }
    // 트렌드 실패하면 에버그린 fallback
  }

  // 30% 또는 fallback: 에버그린
  const eg = await getNextEvergreen();
  console.log(`[TopicSelector] 선정: [${eg.source}] "${eg.keyword}"`);
  return [eg];
}

module.exports = { selectTopics };
