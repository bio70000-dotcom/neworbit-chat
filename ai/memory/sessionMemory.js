const { createClient } = require('redis');

function getRedisUrl() {
  // docker-compose 내부 기본
  return process.env.REDIS_URL || 'redis://redis:6379';
}

let _client;
async function getRedisClient() {
  if (_client) return _client;
  _client = createClient({ url: getRedisUrl() });
  _client.on('error', (e) => console.error('Redis Error:', e));
  await _client.connect();
  return _client;
}

function keyTurns(roomId) {
  return `session:${roomId}:turns`;
}
function keySummary(roomId) {
  return `session:${roomId}:summary`;
}
function keyPersona(roomId) {
  return `session:${roomId}:persona`;
}
function keyProfile(socketId) {
  return `profile:${socketId}`;
}

async function setProfile(socketId, profile, ttlSeconds = 3600) {
  const c = await getRedisClient();
  await c.set(keyProfile(socketId), JSON.stringify(profile || {}), { EX: ttlSeconds });
}

async function getProfile(socketId) {
  const c = await getRedisClient();
  const raw = await c.get(keyProfile(socketId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setRoomPersona(roomId, personaId, ttlSeconds = 6 * 3600) {
  const c = await getRedisClient();
  await c.set(keyPersona(roomId), personaId, { EX: ttlSeconds });
}

async function getRoomPersona(roomId) {
  const c = await getRedisClient();
  return await c.get(keyPersona(roomId));
}

async function getSummary(roomId) {
  const c = await getRedisClient();
  return await c.get(keySummary(roomId));
}

async function setSummary(roomId, summary, ttlSeconds = 6 * 3600) {
  const c = await getRedisClient();
  await c.set(keySummary(roomId), summary || '', { EX: ttlSeconds });
}

async function appendTurn(roomId, turn, maxTurns = 10, ttlSeconds = 6 * 3600) {
  const c = await getRedisClient();
  const k = keyTurns(roomId);
  await c.rPush(k, JSON.stringify(turn));
  await c.lTrim(k, -maxTurns, -1);
  await c.expire(k, ttlSeconds);
}

async function getTurns(roomId) {
  const c = await getRedisClient();
  const raw = await c.lRange(keyTurns(roomId), 0, -1);
  return raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  getRedisClient,
  setProfile,
  getProfile,
  setRoomPersona,
  getRoomPersona,
  getSummary,
  setSummary,
  appendTurn,
  getTurns
};

