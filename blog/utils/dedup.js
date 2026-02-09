/**
 * 중복 글 방지 모듈
 * Redis에 발행된 키워드 해시를 저장하여 30일간 중복 방지
 */

const { createClient } = require('redis');
const crypto = require('crypto');

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const DEDUP_PREFIX = 'blog:published:';
const DEDUP_TTL = 30 * 24 * 60 * 60; // 30일 (초)
const EVERGREEN_PREFIX = 'blog:evergreen:idx';

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
 * 해당 키워드가 이미 발행되었는지 확인
 * @param {string} keyword
 * @returns {Promise<boolean>}
 */
async function isDuplicate(keyword) {
  try {
    const redis = await getClient();
    const key = DEDUP_PREFIX + hashKeyword(keyword);
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (e) {
    console.warn(`[Dedup] Redis 확인 실패: ${e.message}`);
    return false; // 실패 시 중복 아닌 것으로 처리
  }
}

/**
 * 키워드를 발행 완료로 기록
 * @param {string} keyword
 */
async function markPublished(keyword) {
  try {
    const redis = await getClient();
    const key = DEDUP_PREFIX + hashKeyword(keyword);
    await redis.set(key, new Date().toISOString(), { EX: DEDUP_TTL });
  } catch (e) {
    console.warn(`[Dedup] Redis 기록 실패: ${e.message}`);
  }
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
