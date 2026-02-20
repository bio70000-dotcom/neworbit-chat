/**
 * 확정/발행된 주제 키워드 저장 (MongoDB)
 * - 중복 선정 방지: 다음날 주제 선정 시 DB에서 조회해 제외
 * - 시즌 키워드: 동일 연도에만 제외, 다음 연도 재사용
 * - 관련글 추천: 발행 후 ghost_post_id, post_url, title, excerpt 저장
 */

const { MongoClient } = require('mongodb');

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://mongo:27017';
const DB_NAME = 'blog';
const COLLECTION = 'published_posts';

let client = null;

async function getClient() {
  if (client) return client;
  client = new MongoClient(MONGO_URL);
  await client.connect();
  return client;
}

function getCollection() {
  return getClient().then((c) => c.db(DB_NAME).collection(COLLECTION));
}

/**
 * 확정된 일일 플랜 6건 저장 (승인 직후 호출)
 * @param {Array} plan [{ writer, topics: [{ keyword, source }] }]
 * @param {string} planDate 'YYYY-MM-DD'
 */
async function insertConfirmedPlan(plan, planDate) {
  if (!plan || !planDate) return;
  const year = new Date(planDate).getFullYear();
  const docs = [];
  for (const entry of plan) {
    for (const topic of entry.topics || []) {
      const keyword = (topic.keyword || '').trim();
      if (!keyword) continue;
      docs.push({
        keyword,
        source: topic.source || 'naver_news',
        plan_date: planDate,
        year,
        ghost_post_id: null,
        post_url: null,
        title: null,
        excerpt: null,
        created_at: new Date().toISOString(),
        updated_at: null,
      });
    }
  }
  if (docs.length === 0) return;
  try {
    const col = await getCollection();
    await col.insertMany(docs);
    console.log(`[PublishedPostsDb] 확정 주제 ${docs.length}건 저장: ${planDate}`);
  } catch (e) {
    console.warn(`[PublishedPostsDb] insertConfirmedPlan 실패: ${e.message}`);
  }
}

/**
 * 발행 완료 후 해당 문서 업데이트 (plan_date + keyword로 1건 매칭)
 */
async function updatePublishedPost(planDate, keyword, payload) {
  if (!planDate || !keyword) return;
  const k = (keyword || '').trim();
  if (!k) return;
  try {
    const col = await getCollection();
    const result = await col.updateOne(
      { plan_date: planDate, keyword: k },
      {
        $set: {
          ...payload,
          updated_at: new Date().toISOString(),
        },
      }
    );
    if (result.matchedCount > 0) {
      console.log(`[PublishedPostsDb] 발행 메타 업데이트: "${k}"`);
    }
  } catch (e) {
    console.warn(`[PublishedPostsDb] updatePublishedPost 실패: ${e.message}`);
  }
}

/**
 * 주제 선정 시 제외할 키워드 Set 반환
 * - 일반(source !== 'seasonal'): 한 번이라도 있으면 제외
 * - 시즌(source === 'seasonal'): 같은 연도에만 제외
 * @param {{ currentYear: number }} options
 * @returns {Promise<Set<string>>}
 */
async function getExcludedKeywordsForSelection(options = {}) {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const set = new Set();
  try {
    const col = await getCollection();
    const cursor = col.find({
      $or: [
        { source: { $ne: 'seasonal' } },
        { source: 'seasonal', year: currentYear },
      ],
    }, { projection: { keyword: 1 } });
    for await (const doc of cursor) {
      if (doc.keyword) set.add((doc.keyword || '').trim());
    }
    if (set.size > 0) {
      console.log(`[PublishedPostsDb] 제외 키워드 ${set.size}건 (선정 시 사용)`);
    }
  } catch (e) {
    console.warn(`[PublishedPostsDb] getExcludedKeywordsForSelection 실패: ${e.message}`);
  }
  return set;
}

/**
 * 관련글 후보 조회 (현재 글 제외, 발행 완료된 것만, 최근순)
 * @param {string} excludeKeyword 현재 글 키워드
 * @param {number} limit
 * @returns {Promise<Array<{ title, post_url, excerpt }>>}
 */
async function getCandidatesForRelated(excludeKeyword, limit = 15) {
  const exclude = (excludeKeyword || '').trim();
  try {
    const col = await getCollection();
    const list = await col
      .find(
        { keyword: { $ne: exclude }, post_url: { $exists: true, $ne: null } },
        { projection: { title: 1, post_url: 1, excerpt: 1 } }
      )
      .sort({ plan_date: -1, created_at: -1 })
      .limit(limit)
      .toArray();
    return list.map((d) => ({
      title: d.title || d.keyword || '',
      post_url: d.post_url,
      excerpt: (d.excerpt || '').slice(0, 300),
    })).filter((d) => d.post_url);
  } catch (e) {
    console.warn(`[PublishedPostsDb] getCandidatesForRelated 실패: ${e.message}`);
    return [];
  }
}

async function disconnect() {
  if (client) {
    await client.close().catch(() => {});
    client = null;
  }
}

module.exports = {
  insertConfirmedPlan,
  updatePublishedPost,
  getExcludedKeywordsForSelection,
  getCandidatesForRelated,
  disconnect,
};
