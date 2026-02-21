/**
 * 글감 선정 모듈
 * 국내 소스 3종 + 구글 뉴스 RSS로 Topic Pool 약 35개 구성.
 * 구글 트렌드/유튜브/시그널 배제.
 */

const calendar = require('../calendar.json');
const { getNateTrendTopics } = require('../utils/nateTrends');
const { getNaverNewsTopics, getNaverTopicsByWriterQueries } = require('../utils/naverTopics');
const { getGoogleNewsTopicsByCategory } = require('../utils/googleNewsRss');
const { isDuplicate } = require('../utils/dedup');
const { getNaverBlogSearchTotal, getSearchVolumeLabel } = require('../utils/searchVolume');
const { getExcludedKeywordsForSelection } = require('../utils/publishedPostsDb');

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
 * 풀용: 시즌 캘린더에서 최대 maxCount개 (작가 무관)
 */
function getSeasonalTopicsForPool(maxCount = 5) {
  const now = new Date();
  const month = String(now.getMonth() + 1);
  const day = now.getDate();
  const year = now.getFullYear();
  const monthEvents = calendar[month] || [];
  const inRange = monthEvents
    .filter((event) => {
      const daysUntilEvent = event.publishBefore - day;
      return daysUntilEvent >= 0 && daysUntilEvent <= 21;
    })
    .map((event) => ({
      keyword: event.keyword.replace(/\d{4}/, String(year)),
      category: event.category,
      source: 'seasonal',
    }));
  return inRange.slice(0, maxCount);
}

/**
 * YouTube 인기 뉴스/이슈에서 1개
 */
/** 네이트 실시간 이슈에서 1개 (fallback/단일 선정용) */
async function getNateTopic(writer, excludeKeywords = new Set()) {
  const topics = await getNateTopics(excludeKeywords, 1);
  return topics[0] || null;
}

/** 네이트 실시간 이슈에서 최대 maxCount개 (금지어 제외됨) */
async function getNateTopics(excludeKeywords = new Set(), maxCount = 5) {
  try {
    const list = await getNateTrendTopics(maxCount * 2);
    const result = [];
    for (const t of list) {
      if (result.length >= maxCount) break;
      if (excludeKeywords.has(t.keyword)) continue;
      const dup = await isDuplicate(t.keyword);
      if (!dup) result.push(t);
    }
    return result;
  } catch (e) {
    console.warn(`[TopicSelector] 네이트 주제 수집 실패: ${e.message}`);
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
 * 구글 뉴스 RSS에서 작가 newsCategories에 맞는 주제 1개
 */
async function getGoogleNewsTopic(writer, excludeKeywords = new Set()) {
  try {
    const newsCats = writer?.newsCategories;
    const list = await getGoogleNewsTopicsByCategory({ totalTarget: 15 });
    const preferred = Array.isArray(newsCats) && newsCats.length > 0
      ? list.filter((t) => newsCats.includes(t.category))
      : list;
    const ordered = preferred.length > 0 ? preferred : list;
    for (const topic of ordered) {
      if (excludeKeywords.has(topic.keyword)) continue;
      const dup = await isDuplicate(topic.keyword);
      if (!dup) return topic;
    }
    return null;
  } catch (e) {
    console.warn(`[TopicSelector] 구글 뉴스 주제 수집 실패: ${e.message}`);
    return null;
  }
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
      case 'nate_trend':
        topic = await getNateTopic(writer, excludeKeywords);
        break;
      case 'naver_news':
        topic = await getNaverTopic(writer, excludeKeywords);
        break;
      case 'google_news':
        topic = await getGoogleNewsTopic(writer, excludeKeywords);
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

  // 최종 fallback: 시즌 → 네이버 → 구글 뉴스 → 트렌드 순환
  console.warn('[TopicSelector] 모든 소스 실패, fallback 재시도');
  const fallbackOrder = ['seasonal', 'naver_news', 'google_news', 'nate_trend'];
  for (const fb of fallbackOrder) {
    let topic = null;
    if (fb === 'seasonal') {
      const seasonal = getSeasonalTopics(writer).filter((s) => !excludeKeywords.has(s.keyword));
      if (seasonal.length > 0) topic = seasonal[0];
    } else if (fb === 'naver_news') {
      topic = await getNaverTopic(writer, excludeKeywords);
    } else if (fb === 'google_news') {
      topic = await getGoogleNewsTopic(writer, excludeKeywords);
    } else if (fb === 'nate_trend') {
      topic = await getNateTopic(writer, excludeKeywords);
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
    case 'nate_trend':
      topic = await getNateTopic(writer, excludeKeywords);
      break;
    case 'google_news':
      topic = await getGoogleNewsTopic(writer, excludeKeywords);
      break;
    default:
      break;
  }
  return topic;
}

/** AI 선정용 후보 풀: 네이트 10 + 네이버(달산책 5, 텍스트리 5, 삐뚤빼뚤 3) + 시즌 2 ≈ 25개. sourceTag 명확 부여. DB 확정 키워드 제외 */
async function getCandidatesPool(writers, postsPerWriter = 2) {
  const pool = [];
  const usedGlobal = new Set();
  let dbExcluded = new Set();
  try {
    dbExcluded = await getExcludedKeywordsForSelection({ currentYear: new Date().getFullYear() });
  } catch (e) {
    console.warn('[TopicSelector] DB 제외 키워드 조회 실패:', e.message);
  }

  const addToPool = async (topic, sourceLabel, sourceTag) => {
    const keyword = (topic.keyword || '').trim().replace(/\s+/g, ' ');
    if (!keyword || usedGlobal.has(keyword)) return false;
    if (dbExcluded.has(keyword)) return false;
    const dup = await isDuplicate(keyword);
    if (dup) return false;
    pool.push({
      keyword,
      category: topic.category || 'trending',
      source: topic.source || sourceLabel,
      sourceTag: sourceTag || sourceLabel,
    });
    usedGlobal.add(keyword);
    return true;
  };

  const wD = writers.find((w) => w.id === 'dalsanchek');
  const wT = writers.find((w) => w.id === 'textree');
  const wB = writers.find((w) => w.id === 'bbittul');

  const [nateList, seasonalList, naverDalsanchek, naverTextree, naverBbittul, googleNewsList] = await Promise.all([
    getNateTrendTopics(10).catch((e) => { console.warn('[TopicSelector] 네이트 수집 실패:', e.message); return []; }),
    Promise.resolve(getSeasonalTopicsForPool(2)),
    wD ? getNaverTopicsByWriterQueries(wD, 5).catch((e) => { console.warn('[TopicSelector] 네이버(달산책) 실패:', e.message); return []; }) : Promise.resolve([]),
    wT ? getNaverTopicsByWriterQueries(wT, 5).catch((e) => { console.warn('[TopicSelector] 네이버(텍스트리) 실패:', e.message); return []; }) : Promise.resolve([]),
    wB ? getNaverTopicsByWriterQueries(wB, 3).catch((e) => { console.warn('[TopicSelector] 네이버(삐뚤빼뚤) 실패:', e.message); return []; }) : Promise.resolve([]),
    getGoogleNewsTopicsByCategory({ totalTarget: 10 }).catch((e) => { console.warn('[TopicSelector] 구글 뉴스 수집 실패:', e.message); return []; }),
  ]);

  const batches = [
    [nateList, 'nate_trend', 'Nate_Trend'],
    [naverDalsanchek, 'naver_news', 'Naver_Dalsanchek'],
    [naverTextree, 'naver_news', 'Naver_Textree'],
    [naverBbittul, 'naver_news', 'Naver_Bbittul'],
    [googleNewsList, 'google_news_rss', null],
    [seasonalList, 'seasonal', 'Seasonal'],
  ];
  for (const [list, sourceLabel, sourceTag] of batches) {
    for (const t of list || []) {
      const tag = sourceTag || t.sourceTag || sourceLabel;
      await addToPool(t, sourceLabel, tag);
    }
  }

  console.log(`[TopicSelector] 후보 풀: ${pool.length}개 (네이트+네이버+구글뉴스+시즌, ~35개 목표)`);
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
  const result = await selectTopicsWithAI(pool, writers);
  const plan = result?.plan;
  if (!plan || plan.every((p) => p.topics.length === 0)) {
    console.warn('[TopicSelector] AI 선정 실패, fallback:', result?.error || '');
    return selectDailyTopicsWithQuotaFallback(writers, postsPerWriter);
  }
  return plan;
}

/**
 * 주제 한 건에 검색량 + 선정 사유 부여 (보고 메시지용)
 * @param {Object} topic - { keyword, source, ... }
 * @param {string} defaultRationale - rationale 없을 때 사용할 문구
 * @param {number} [delayMs] - 호출 후 대기 ms (연속 호출 시 API 한도 고려)
 */
async function enrichTopicForReport(topic, defaultRationale, delayMs = 0) {
  if (!topic || !topic.keyword) return;
  if (!topic.rationale) topic.rationale = defaultRationale;
  if (topic.searchVolumeLabel != null && topic.searchVolumeLabel !== '-') return; // 이미 있으면 스킵

  try {
    const total = await getNaverBlogSearchTotal(topic.keyword);
    topic.searchVolume = total;
    topic.searchVolumeLabel = getSearchVolumeLabel(total);
  } catch (e) {
    topic.searchVolume = null;
    topic.searchVolumeLabel = '-';
  }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
}

/** AI 미사용 시 fallback: 랜덤 할당 (시즌2/네이버2/트렌드1/구글뉴스1). DB 확정 키워드 제외 */
async function selectDailyTopicsWithQuotaFallback(writers, postsPerWriter = 2) {
  const total = writers.length * postsPerWriter;
  const sourceQuota = ['seasonal', 'seasonal', 'naver_news', 'naver_news', 'nate_trend', 'google_news'];
  for (let i = sourceQuota.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sourceQuota[i], sourceQuota[j]] = [sourceQuota[j], sourceQuota[i]];
  }
  let usedKeywords = new Set();
  try {
    const dbExcluded = await getExcludedKeywordsForSelection({ currentYear: new Date().getFullYear() });
    dbExcluded.forEach((k) => usedKeywords.add(k));
  } catch (e) {
    console.warn('[TopicSelector] fallback DB 제외 키워드 조회 실패:', e.message);
  }
  const plan = writers.map((w) => ({ writer: w, topics: [] }));

  const allSources = ['seasonal', 'naver_news', 'nate_trend', 'google_news'];
  for (let slot = 0; slot < total; slot++) {
    const writerIndex = Math.floor(slot / postsPerWriter);
    const writer = writers[writerIndex];
    const source = sourceQuota[slot];
    let topic = await getTopicFromSource(writer, source, usedKeywords);
    if (!topic) {
      const other = allSources.filter((s) => s !== source);
      topic = await trySourcesInOrder(other, writer, usedKeywords);
    }
    if (!topic) {
      const writerKws = getWriterKeywords(writer);
      topic = { keyword: `${new Date().getFullYear()}년 ${writerKws[0]} 트렌드`, category: writerKws[0], source: 'default' };
    }
    plan[writerIndex].topics.push(topic);
    usedKeywords.add(topic.keyword);
  }

  // fallback 경로도 보고서에 선정 사유·검색량 표시되도록 보강
  const ENRICH_DELAY_MS = 150;
  for (const entry of plan) {
    for (const topic of entry.topics) {
      const rationale = `소스별 할당 (${topic.source})`;
      await enrichTopicForReport(topic, rationale, ENRICH_DELAY_MS);
    }
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
  const fallbackSources = ['seasonal', 'naver_news', 'google_news', 'nate_trend'];
  const topic = await trySourcesInOrder(fallbackSources, writer, excludeKeywords);
  return [topic];
}

module.exports = { selectTopics, selectDailyTopicsWithQuota, getTopicFromSource, getCandidatesPool, enrichPoolWithSearchVolume, enrichTopicForReport };
