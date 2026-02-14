/**
 * 중복 글 방지 모듈
 * Redis + 로컬 파일에 발행된 키워드를 저장하여 30일간 중복 방지.
 * 매일 주제 선정 시 포스팅된 키워드는 후보에서 제외됨.
 */

const { createClient } = require('redis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const DEDUP_PREFIX = 'blog:published:';
const DEDUP_TTL = 30 * 24 * 60 * 60; // 30일 (초)
const EVERGREEN_PREFIX = 'blog:evergreen:idx';
const PUBLISHED_KEYWORDS_FILE = path.join(__dirname, '..', 'data', 'published-keywords.json');
const FILE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일 (ms)

let client = null;

async function getClient() {
  if (client && client.isOpen) return client;
  client = createClient({ url: `redis://${REDIS_HOST}:6379` });
  client.on('error', (err) => console.warn(`[Redis] ${err.message}`));
  await client.connect();
  return client;
}

/**
 * 키워드를 해시로 변환
 */
function hashKeyword(keyword) {
  return crypto.createHash('md5').update(keyword.trim().toLowerCase()).digest('hex');
}

/**
 * 파일에서 30일 이내 발행된 키워드 Set 로드
 * @returns {Promise<Set<string>>}
 */
async function getPublishedSetFromFile() {
  try {
    const raw = fs.readFileSync(PUBLISHED_KEYWORDS_FILE, 'utf8');
    const data = JSON.parse(raw);
    const entries = data.entries || [];
    const now = Date.now();
    const set = new Set();
    for (const e of entries) {
      const at = e.publishedAt ? new Date(e.publishedAt).getTime() : 0;
      if (now - at < FILE_TTL_MS && e.keyword) {
        set.add((e.keyword || '').trim());
      }
    }
    return set;
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[Dedup] 파일 로드 실패: ${e.message}`);
    return new Set();
  }
}

/**
 * 키워드를 파일에 추가 (30일 TTL 유지)
 * @param {string} keyword
 */
function appendPublishedToFile(keyword) {
  const k = (keyword || '').trim();
  if (!k) return;
  try {
    const dir = path.dirname(PUBLISHED_KEYWORDS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let entries = [];
    if (fs.existsSync(PUBLISHED_KEYWORDS_FILE)) {
      const raw = fs.readFileSync(PUBLISHED_KEYWORDS_FILE, 'utf8');
      const data = JSON.parse(raw);
      entries = data.entries || [];
    }
    const now = new Date().toISOString();
    entries.push({ keyword: k, publishedAt: now });
    const cutoff = Date.now() - FILE_TTL_MS;
    entries = entries.filter((e) => {
      const t = e.publishedAt ? new Date(e.publishedAt).getTime() : 0;
      return t >= cutoff;
    });
    fs.writeFileSync(
      PUBLISHED_KEYWORDS_FILE,
      JSON.stringify({ entries, updated: now }, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn(`[Dedup] 파일 저장 실패: ${e.message}`);
  }
}

/**
 * 해당 키워드가 이미 발행되었는지 확인 (Redis 우선, 실패 시 파일 확인)
 * @param {string} keyword
 * @returns {Promise<boolean>}
 */
async function isDuplicate(keyword) {
  const k = (keyword || '').trim();
  if (!k) return false;
  try {
    const redis = await getClient();
    const key = DEDUP_PREFIX + hashKeyword(k);
    const exists = await redis.exists(key);
    if (exists === 1) return true;
  } catch (e) {
    console.warn(`[Dedup] Redis 확인 실패: ${e.message}`);
  }
  const fileSet = await getPublishedSetFromFile();
  if (fileSet.has(k)) return true;
  const normalized = k.toLowerCase().replace(/\s+/g, ' ');
  for (const stored of fileSet) {
    if (stored.toLowerCase().replace(/\s+/g, ' ') === normalized) return true;
  }
  return false;
}

/**
 * 키워드를 발행 완료로 기록 (Redis + 파일 둘 다 저장)
 * @param {string} keyword
 */
async function markPublished(keyword) {
  const k = (keyword || '').trim();
  if (!k) return;
  try {
    const redis = await getClient();
    const key = DEDUP_PREFIX + hashKeyword(k);
    await redis.set(key, new Date().toISOString(), { EX: DEDUP_TTL });
  } catch (e) {
    console.warn(`[Dedup] Redis 기록 실패: ${e.message}`);
  }
  appendPublishedToFile(k);
}

/**
 * 에버그린 주제의 현재 인덱스 가져오기 (순환용)
 * @returns {Promise<number>}
 */
async function getEvergreenIndex() {
  try {
    const redis = await getClient();
    const idx = await redis.get(EVERGREEN_PREFIX);
    return idx ? parseInt(idx, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * 에버그린 인덱스 증가
 * @param {number} maxLen 에버그린 주제 총 개수
 */
async function incrementEvergreenIndex(maxLen) {
  try {
    const redis = await getClient();
    const current = await getEvergreenIndex();
    const next = (current + 1) % maxLen;
    await redis.set(EVERGREEN_PREFIX, next.toString());
  } catch (e) {
    console.warn(`[Dedup] 에버그린 인덱스 업데이트 실패: ${e.message}`);
  }
}

/**
 * Redis 연결 종료
 */
async function disconnect() {
  try {
    if (client && client.isOpen) await client.quit();
  } catch {}
}

module.exports = {
  isDuplicate,
  markPublished,
  getEvergreenIndex,
  incrementEvergreenIndex,
  disconnect,
};
