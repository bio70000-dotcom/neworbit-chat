/**
 * 전파(wave) Redis 키 및 헬퍼
 * - wave:receivers: 수신 대기 풀 (SET, socketId)
 * - wave:pair:{pairId}: 페어 정보 JSON { a, b, createdAt } (b는 socketId 또는 'ai')
 * - wave:socket:{socketId}: 해당 소켓의 현재 pairId
 */

const WAVE_RECEIVERS = 'wave:receivers';
const WAVE_PAIR_PREFIX = 'wave:pair:';
const WAVE_SOCKET_PREFIX = 'wave:socket:';
const PAIR_TTL = 6 * 3600; // 6시간

function pairKey(pairId) {
  return WAVE_PAIR_PREFIX + pairId;
}
function socketKey(socketId) {
  return WAVE_SOCKET_PREFIX + socketId;
}

async function addReceiver(redis, socketId) {
  await redis.sAdd(WAVE_RECEIVERS, socketId);
}
async function removeReceiver(redis, socketId) {
  await redis.sRem(WAVE_RECEIVERS, socketId);
}
async function getRandomReceiver(redis, excludeSocketId) {
  const members = await redis.sMembers(WAVE_RECEIVERS);
  const available = members.filter((id) => id !== excludeSocketId);
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}
async function getReceiverCount(redis) {
  return await redis.sCard(WAVE_RECEIVERS);
}

async function createPair(redis, pairId, a, b) {
  const data = JSON.stringify({ a, b, createdAt: Date.now() });
  await redis.set(pairKey(pairId), data, { EX: PAIR_TTL });
  await redis.set(socketKey(a), pairId, { EX: PAIR_TTL });
  if (b !== 'ai') await redis.set(socketKey(b), pairId, { EX: PAIR_TTL });
}
async function getPair(redis, pairId) {
  const raw = await redis.get(pairKey(pairId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function getPairIdBySocket(redis, socketId) {
  return await redis.get(socketKey(socketId));
}
async function deletePair(redis, pairId) {
  const pair = await getPair(redis, pairId);
  if (pair) {
    await redis.del(pairKey(pairId));
    await redis.del(socketKey(pair.a));
    if (pair.b !== 'ai') await redis.del(socketKey(pair.b));
  }
  return pair;
}

function otherInPair(pair, socketId) {
  if (!pair) return null;
  if (pair.a === socketId) return pair.b;
  if (pair.b === socketId) return pair.a;
  return null;
}

module.exports = {
  addReceiver,
  removeReceiver,
  getRandomReceiver,
  getReceiverCount,
  createPair,
  getPair,
  getPairIdBySocket,
  deletePair,
  otherInPair,
  pairKey,
  socketKey
};
