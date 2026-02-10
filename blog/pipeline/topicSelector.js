/**
 * 글감 선정 모듈
 * 작가별 전문 분야(writers.js categories·bio)에 맞는 주제를 선정
 *
 * 일일 6편 시 소스 할당: 시즌 2, 네이버 뉴스 2, 구글 트렌드 2 (균형 유지)
 */

const calendar = require('../calendar.json');
const { getRelevantTrends } = require('../utils/googleTrends');
const { getNaverNewsTopics } = require('../utils/naverTopics');
const { isDuplicate } = require('../utils/dedup');
const { getNaverBlogSearchTotal, getSearchVolumeLabel } = require('../utils/searchVolume');

// 카테고리별 확장 키워드 (작가 categories만으로는 부족할 때 보강)
const CATEGORY_EXPANSION = {
  라이프스타일: ['일상', '힐링', '카페', '취미', '데이트', '산책', '독서', '선물'],
  감성: ['감정', '관계', '우정', '명상', '자존감', '습관'],
  인간관계: ['관계', '우정', '소통', '데이트'],
  자기계발: ['습관', '목표', '독서', '효율'],
  여행: ['맛집', '핫플', '데이트', '휴가'],
  IT: ['앱', 'AI', '개발', '가젯', '서비스', '자동화'],
  테크: ['앱', 'AI', '가젯', '플랫폼', '비교'],
  생산성: ['효율', '자동화', '도구', '꿀팁'],
  경제: ['재테크', '투자', '부업', '절약'],
  리뷰: ['비교', '후기', '추천', '가성비'],
  트렌드: ['유행', 'MZ', '밈', '핫한', '화제'],
  엔터: ['넷플릭스', '드라마', '영화', '게임', '음악'],
  MBTI: ['성격', '심리', '유형'],
  먹거리: ['맛집', '후기', '추천', '꿀팁'],
  꿀팁: ['방법', '추천', '후기', '가성비'],
};

/**
 * 작가 객체(writers.js)에서 검색/매칭용 키워드 배열 생성
 * categories를 기준으로 하고, bio에서 추출 가능한 단어는 사용하지 않음(단순화)
 */
function getWriterKeywords(writer) {
  const id = writer?.id;
  const categories = writer?.categories;
  if (Array.isArray(categories) && categories.length > 0) {
    const expanded = new Set(categories);
    for (const cat of categories) {
      const extra = CATEGORY_EXPANSION[cat];
      if (extra) extra.forEach((k) => expanded.add(k));
    }
    return [...expanded];
  }
  // fallback: id 기반 기본 키워드
  const fallback = {
    dalsanchek: ['라이프스타일', '감성', '인간관계', '자기계발', '여행', '일상', '카페', '힐링'],
    textree: ['IT', '테크', '생산성', '경제', '리뷰', '앱', 'AI', '재테크'],
    bbittul: ['트렌드', '엔터', 'MBTI', '먹거리', '꿀팁', '맛집', '후기', 'MZ'],
  };
  return fallback[id] || ['라이프스타일'];
}


/**
 * 시즌 캘린더에서 작가에 맞는 주제 찾기
 */
function getSeasonalTopics(writer) {
  const now = new Date();
  const month = String(now.getMonth() + 1);
  const day = now.getDate();
  const year = now.getFullYear();
  const writerKws = getWriterKeywords(writer);

  const monthEvents = calendar[month] || [];

  return monthEvents
    .filter((event) => {
      const daysUntilEvent = event.publishBefore - day;
      if (daysUntilEvent < 0 || daysUntilEvent > 21) return false;
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
 * Google Trends에서 작가 분야에 맞는 트렌드 1개
 */
async function getTrendTopic(writer, excludeKeywords = new Set()) {
  const topics = await getTrendTopics(writer, excludeKeywords, 1);
  return topics[0] || null;
}

/**
 * Google Trends에서 작가 분야에 맞는 트렌드 최대 maxCount개
 */
async function getTrendTopics(writer, excludeKeywords = new Set(), maxCount = 2) {
  try {
    const trends = await getRelevantTrends();
    if (trends.length === 0) return [];

    const writerKws = getWriterKeywords(writer);
    const matched = trends.filter((t) => {
      const lower = t.toLowerCase();
      return writerKws.some((kw) => lower.includes(kw.toLowerCase()));
    });
    const candidates = matched.length > 0 ? matched : trends.slice(0, 5);

    const result = [];
    for (const keyword of candidates) {
      if (result.length >= maxCount) break;
      if (excludeKeywords.has(keyword)) continue;
      const dup = await isDuplicate(keyword);
      if (!dup) result.push({ keyword, category: 'trending', source: 'google_trends' });
    }
    return result;
  } catch (e) {
    console.warn(`[TopicSelector] 트렌드 수집 실패: ${e.message}`);
    return [];
  }
}

/**
 * 네이버 뉴스에서 작가 분야에 맞는 주제 1개
 */
async function getNaverTopic(writer, excludeKeywords = new Set()) {
  const topics = await getNaverTopics(writer, excludeKeywords, 1);
  return topics[0] || null;
}

/**
 * 네이버 뉴스에서 작가 분야에 맞는 주제 최대 maxCount개
 */
async function getNaverTopics(writer, excludeKeywords = new Set(), maxCount = 2) {
  try {
    const all = await getNaverNewsTopics(writer);
    const result = [];
    for (const topic of all) {
      if (result.length >= maxCount) break;
      if (excludeKeywords.has(topic.keyword)) continue;
      const dup = await isDuplicate(topic.keyword);
      if (!dup) result.push(topic);
    }
    return result;
  } catch (e) {
    console.warn(`[TopicSelector] 네이버 뉴스 주제 수집 실패: ${e.message}`);
    return [];
  }
}

/**
 * 소스 목록에서 순서대로 시도
 * @param {Set<string>} [excludeKeywords] - 오늘 이미 선정된 키워드 (중복 방지)
 */
async function trySourcesInOrder(sources, writer, excludeKeywords = new Set()) {
  for (const source of sources) {
    let topic = null;

    switch (source) {
      case 'google_trends':
        topic = await getTrendTopic(writer, excludeKeywords);
        break;
      case 'naver_news':
        topic = await getNaverTopic(writer, excludeKeywords);
        break;
      case 'seasonal': {
        const seasonal = getSeasonalTopics(writer);
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
      const seasonal = getSeasonalTopics(writer).filter((s) => !excludeKeywords.has(s.keyword));
      if (seasonal.length > 0) topic = seasonal[0];
    } else if (fb === 'naver_news') {
      topic = await getNaverTopic(writer, excludeKeywords);
    } else {
      topic = await getTrendTopic(writer, excludeKeywords);
    }
    if (topic) {
      console.log(`[TopicSelector] 선정 (fallback): [${topic.source}] "${topic.keyword}"`);
      return topic;
    }
  }

  const writerKws = getWriterKeywords(writer);
  const defaultKeyword = `${new Date().getFullYear()}년 ${writerKws[0]} 트렌드`;
  console.log(`[TopicSelector] 선정 (기본): "${defaultKeyword}"`);
  return { keyword: defaultKeyword, category: writerKws[0], source: 'default' };
}

/**
 * 지정한 소스에서만 1개 주제 선정 (다른 소스로 넘어가지 않음)
 */
async function getTopicFromSource(writer, source, excludeKeywords = new Set()) {
  let topic = null;
  switch (source) {
    case 'seasonal': {
      const seasonal = getSeasonalTopics(writer);
      for (const s of seasonal) {
        if (excludeKeywords.has(s.keyword)) continue;
        const dup = await isDuplicate(s.keyword);
        if (!dup) { topic = s; break; }
      }
      break;
    }
    case 'naver_news':
      topic = await getNaverTopic(writer, excludeKeywords);
      break;
    case 'google_trends':
      topic = await getTrendTopic(writer, excludeKeywords);
      break;
    default:
      break;
  }
  return topic;
}

/** AI 선정용 후보 풀: 시즌 6 + 네이버 6 + 트렌드 6 (작가당 각 2개씩, 전역 중복 제외) */
async function getCandidatesPool(writers, postsPerWriter = 2) {
  const pool = [];
  const perWriter = 2;
  const usedGlobal = new Set();

  for (const writer of writers) {
    const seasonal = getSeasonalTopics(writer);
    let n = 0;
    for (const s of seasonal) {
      if (n >= perWriter) break;
      if (usedGlobal.has(s.keyword)) continue;
      const dup = await isDuplicate(s.keyword);
      if (!dup) {
        pool.push({ keyword: s.keyword, category: s.category, source: 'seasonal', writerId: writer.id });
        usedGlobal.add(s.keyword);
        n++;
      }
    }

    const naverList = await getNaverTopics(writer, usedGlobal, perWriter);
    for (const t of naverList) {
      pool.push({ keyword: t.keyword, category: t.category, source: 'naver_news', writerId: writer.id });
      usedGlobal.add(t.keyword);
    }

    const trendList = await getTrendTopics(writer, usedGlobal, perWriter);
    for (const t of trendList) {
      pool.push({ keyword: t.keyword, category: t.category || 'trending', source: 'google_trends', writerId: writer.id });
      usedGlobal.add(t.keyword);
    }
  }

  console.log(`[TopicSelector] 후보 풀: ${pool.length}개 (시즌/네이버/트렌드)`);
  return pool;
}

/** 후보 풀에 네이버 검색량(검색결과 수) 대리 지표 추가 */
async function enrichPoolWithSearchVolume(pool) {
  const delayMs = 150;
  for (const c of pool) {
    try {
      const total = await getNaverBlogSearchTotal(c.keyword);
      c.searchVolume = total;
      c.searchVolumeLabel = getSearchVolumeLabel(total);
    } catch (e) {
      c.searchVolume = null;
      c.searchVolumeLabel = '-';
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log(`[TopicSelector] 검색량 지표 부여 완료`);
  return pool;
}

/**
 * 일일 6편 주제 선정 — AI 추론으로 선정 + 선정 이유
 * @param {Array} writers - 작가 배열 (writers.js WRITERS)
 * @param {number} postsPerWriter - 작가당 글 수 (2)
 * @returns {Promise<Array<{writer, topics}>>} plan (각 topic에 rationale 포함)
 */
async function selectDailyTopicsWithQuota(writers, postsPerWriter = 2) {
  const { selectTopicsWithAI } = require('./topicSelectAI');
  let pool = await getCandidatesPool(writers, postsPerWriter);
  if (pool.length < 6) {
    console.warn('[TopicSelector] 후보 부족, 기존 랜덤 할당으로 보충');
    return selectDailyTopicsWithQuotaFallback(writers, postsPerWriter);
  }
  await enrichPoolWithSearchVolume(pool);
  const plan = await selectTopicsWithAI(pool, writers);
  if (!plan || plan.every((p) => p.topics.length === 0)) {
    console.warn('[TopicSelector] AI 선정 실패, fallback');
    return selectDailyTopicsWithQuotaFallback(writers, postsPerWriter);
  }
  return plan;
}

/** AI 미사용 시 fallback: 기존 랜덤 할당 (시즌2/네이버2/트렌드2) */
async function selectDailyTopicsWithQuotaFallback(writers, postsPerWriter = 2) {
  const total = writers.length * postsPerWriter;
  const sourceQuota = ['seasonal', 'seasonal', 'naver_news', 'naver_news', 'google_trends', 'google_trends'];
  for (let i = sourceQuota.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sourceQuota[i], sourceQuota[j]] = [sourceQuota[j], sourceQuota[i]];
  }
  const usedKeywords = new Set();
  const plan = writers.map((w) => ({ writer: w, topics: [] }));

  for (let slot = 0; slot < total; slot++) {
    const writerIndex = Math.floor(slot / postsPerWriter);
    const writer = writers[writerIndex];
    const source = sourceQuota[slot];
    let topic = await getTopicFromSource(writer, source, usedKeywords);
    if (!topic) {
      const other = ['seasonal', 'naver_news', 'google_trends'].filter((s) => s !== source);
      topic = await trySourcesInOrder(other, writer, usedKeywords);
    }
    if (!topic) {
      const writerKws = getWriterKeywords(writer);
      topic = { keyword: `${new Date().getFullYear()}년 ${writerKws[0]} 트렌드`, category: writerKws[0], source: 'default' };
    }
    plan[writerIndex].topics.push(topic);
    usedKeywords.add(topic.keyword);
  }
  return plan;
}

/**
 * 1편의 글감 선정 (작가 분야 기반) — 재선정 등 단일 주제 필요 시 사용
 * @param {Object} writer - 작가 객체 (writers.js)
 * @param {{ excludeKeywords?: Set<string> }} [options] - 오늘 이미 쓴 키워드 (중복 방지)
 */
async function selectTopics(writer, options = {}) {
  const excludeKeywords = options.excludeKeywords || new Set();
  const fallbackSources = ['seasonal', 'naver_news', 'google_trends'];
  const topic = await trySourcesInOrder(fallbackSources, writer, excludeKeywords);
  return [topic];
}

module.exports = { selectTopics, selectDailyTopicsWithQuota };
