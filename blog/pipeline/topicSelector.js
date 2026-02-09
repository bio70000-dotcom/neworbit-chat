/**
 * 글감 선정 모듈
 * Google Trends + 네이버 뉴스 + 시즌 캘린더 + 에버그린 주제를 조합
 *
 * 소스 선택 확률:
 *  - Google Trends: 35%
 *  - 네이버 뉴스: 35%
 *  - 시즌 캘린더: 20%
 *  - 에버그린: 10%
 *
 * 각 소스 실패 시 다음 소스로 fallback
 */

const calendar = require('../calendar.json');
const evergreen = require('../evergreen.json');
const { getRelevantTrends } = require('../utils/googleTrends');
const { getNaverNewsTopics } = require('../utils/naverTopics');
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
 * Google Trends에서 중복 아닌 트렌드 하나 가져오기
 */
async function getTrendTopic() {
  try {
    const trends = await getRelevantTrends();
    if (trends.length === 0) return null;

    for (const keyword of trends) {
      const dup = await isDuplicate(keyword);
      if (!dup) {
        return { keyword, category: 'trending', source: 'google_trends' };
      }
    }

    // 모두 중복이면 첫 번째 반환
    return { keyword: trends[0], category: 'trending', source: 'google_trends' };
  } catch (e) {
    console.warn(`[TopicSelector] 트렌드 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 네이버 뉴스에서 중복 아닌 주제 하나 가져오기
 */
async function getNaverTopic() {
  try {
    const topics = await getNaverNewsTopics();
    if (topics.length === 0) return null;

    for (const topic of topics) {
      const dup = await isDuplicate(topic.keyword);
      if (!dup) {
        return topic;
      }
    }

    // 모두 중복이면 첫 번째 반환
    return topics[0];
  } catch (e) {
    console.warn(`[TopicSelector] 네이버 뉴스 주제 수집 실패: ${e.message}`);
    return null;
  }
}

/**
 * 소스 목록에서 순서대로 시도하여 주제 하나 선정
 * @param {Array<string>} sources - 시도할 소스 순서
 */
async function trySourcesInOrder(sources) {
  for (const source of sources) {
    let topic = null;

    switch (source) {
      case 'google_trends':
        topic = await getTrendTopic();
        break;
      case 'naver_news':
        topic = await getNaverTopic();
        break;
      case 'seasonal': {
        const seasonal = getSeasonalTopics();
        for (const s of seasonal) {
          const dup = await isDuplicate(s.keyword);
          if (!dup) { topic = s; break; }
        }
        break;
      }
      case 'evergreen':
        topic = await getNextEvergreen();
        break;
    }

    if (topic) {
      console.log(`[TopicSelector] 선정: [${topic.source}] "${topic.keyword}"`);
      return topic;
    }
  }

  // 최종 fallback: 에버그린
  const eg = await getNextEvergreen();
  console.log(`[TopicSelector] 선정 (fallback): [${eg.source}] "${eg.keyword}"`);
  return eg;
}

/**
 * 1편의 글감 선정
 * Google Trends 35% / 네이버뉴스 35% / 시즌 20% / 에버그린 10%
 * 선택된 소스가 실패하면 나머지 소스를 순서대로 시도
 */
async function selectTopics() {
  const roll = Math.random();

  let primarySource;
  let fallbackSources;

  if (roll < 0.35) {
    // 35%: Google Trends 우선
    primarySource = 'google_trends';
    fallbackSources = ['google_trends', 'naver_news', 'seasonal', 'evergreen'];
  } else if (roll < 0.70) {
    // 35%: 네이버 뉴스 우선
    primarySource = 'naver_news';
    fallbackSources = ['naver_news', 'google_trends', 'seasonal', 'evergreen'];
  } else if (roll < 0.90) {
    // 20%: 시즌 캘린더 우선
    primarySource = 'seasonal';
    fallbackSources = ['seasonal', 'google_trends', 'naver_news', 'evergreen'];
  } else {
    // 10%: 에버그린
    primarySource = 'evergreen';
    fallbackSources = ['evergreen'];
  }

  console.log(`[TopicSelector] 소스 선택: ${primarySource} (roll: ${roll.toFixed(2)})`);

  const topic = await trySourcesInOrder(fallbackSources);
  return [topic];
}

module.exports = { selectTopics };
