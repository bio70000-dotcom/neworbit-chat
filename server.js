require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createClient } = require("redis");
const { replyToUser, ensurePersonaForRoom, getPersonaList } = require('./ai/orchestrator');
const sessionMemory = require('./ai/memory/sessionMemory');
const client = require('prom-client');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============ Prometheus 메트릭 설정 ============
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const activeConnections = new client.Gauge({
    name: 'chat_active_connections',
    help: '현재 소켓 접속자 수',
    registers: [register]
});

const waitingQueueLength = new client.Gauge({
    name: 'chat_waiting_queue_length',
    help: '대기열 인원 수',
    registers: [register]
});

const matchesTotal = new client.Counter({
    name: 'chat_matches_total',
    help: '누적 매칭 수',
    labelNames: ['type'],
    registers: [register]
});

const messagesTotal = new client.Counter({
    name: 'chat_messages_total',
    help: '누적 메시지 수',
    registers: [register]
});

const aiRepliesTotal = new client.Counter({
    name: 'chat_ai_replies_total',
    help: 'AI 응답 수 (persona/provider/fallback)',
    labelNames: ['persona', 'provider', 'fallback'],
    registers: [register]
});

const aiReplyLatencyMs = new client.Histogram({
    name: 'chat_ai_reply_latency_ms',
    help: 'AI 응답 지연(ms)',
    labelNames: ['provider', 'fallback'],
    buckets: [100, 250, 500, 1000, 1500, 2500, 3500, 4500, 6000],
    registers: [register]
});

// ============ Redis 클라이언트 설정 ============
const redisClient = createClient({ url: 'redis://redis:6379' });
redisClient.connect().catch(console.error);

const WAITING_QUEUE = 'waiting_queue';
const waveRedis = require('./lib/waveRedis');
const { selectPersona } = require('./ai/personas/selectPersona');

// ============ 채팅(rooms) 인메모리 상태 ============
const chatRooms = new Map(); // roomId -> { settings, roomSize, sockets, humans, aiParticipants, timers }
const waveIdleTimers = new Map(); // pairId -> { warn, leave }
const chatIdleTimers = new Map(); // roomId -> Map(socketId -> { warn, leave })

function normalizeSettings(input = {}) {
  const roomSize = [2, 3, 4].includes(Number(input.roomSize)) ? Number(input.roomSize) : 2;
  const ageGroup = ['10s', '20s', '30s', '40plus'].includes(input.ageGroup) ? input.ageGroup : 'na';
  const gender = ['male', 'female'].includes(input.gender) ? input.gender : 'na';
  const interests = Array.isArray(input.interests)
    ? input.interests.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
    : String(input.interests || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return { roomSize, ageGroup, gender, interests };
}

function normalizeTags(interests = []) {
  const tags = new Set();
  const text = interests.join(' ');
  if (/(코딩|개발|프로그래밍|it|tech|테크)/i.test(text)) { tags.add('dev'); tags.add('it'); }
  if (/(게임|롤|발로|콘솔|스팀)/i.test(text)) tags.add('game');
  if (/(스포츠|축구|야구|농구)/i.test(text)) tags.add('sports');
  if (/(연애|사랑|썸)/i.test(text)) tags.add('love');
  if (/(심리|상담|멘탈)/i.test(text)) tags.add('psych');
  if (/(경제|주식|코인|비트코인|부동산|환율)/i.test(text)) tags.add('finance');
  return Array.from(tags);
}

function roomMatches(roomSettings, userSettings) {
  if (roomSettings.roomSize !== userSettings.roomSize) return false;
  if (roomSettings.interests.length > 0 && userSettings.interests.length > 0) {
    const set = new Set(roomSettings.interests);
    const overlap = userSettings.interests.some((i) => set.has(i));
    return overlap;
  }
  return true;
}

function getPersonaName(personaId) {
  const p = getPersonaList().find((x) => x.id === personaId);
  return p?.profile?.displayName || '상대';
}

async function addAiToRoom(roomId, reason = 'wait') {
  const room = chatRooms.get(roomId);
  if (!room) return;
  if (room.humans.size + room.aiParticipants.length >= room.roomSize) return;
  const aiIndex = room.aiParticipants.length + 1;
  const tags = normalizeTags(room.settings.interests);
  const profile = { purpose: 'smalltalk', tags, ageGroup: room.settings.ageGroup, gender: room.settings.gender };
  const persona = selectPersona(profile, { exploreRate: aiIndex === 1 ? 0.2 : 0.6 });
  const aiKey = `${roomId}:ai${aiIndex}`;
  const aiSocketId = `ai_${roomId}_${aiIndex}`;

  room.aiParticipants.push({ id: aiIndex, key: aiKey, socketId: aiSocketId, personaId: persona.id, name: getPersonaName(persona.id) });

  // AI가 가볍게 인사(사람처럼 딜레이)
  setTimeout(async () => {
    if (!chatRooms.has(roomId)) return;
    const end = aiReplyLatencyMs.startTimer();
    const result = await replyToUser({
      roomId: aiKey,
      socketId: aiSocketId,
      userText: '들어왔어~'
    }).catch(() => ({ text: '들어왔어~', personaId: persona.id, provider: 'na', fallback: false }));
    end({ provider: result.provider || 'na', fallback: String(!!result.fallback) });
    aiRepliesTotal.inc({ persona: result.personaId || persona.id, provider: result.provider || 'na', fallback: String(!!result.fallback) });
    io.to(roomId).emit('chat_message', { senderType: 'ai', senderName: getPersonaName(result.personaId || persona.id), text: result.text });
  }, 1200 + Math.floor(Math.random() * 1200));

  io.to(roomId).emit('room_joined', buildRoomPayload(room));
  console.log(`[ChatRoom] AI joined (${reason}) ${roomId}`);
}

function buildRoomPayload(room) {
  return {
    roomId: room.roomId,
    roomSize: room.roomSize,
    humans: room.humans.size,
    ai: room.aiParticipants.length
  };
}

function clearWaveIdle(pairId) {
  const t = waveIdleTimers.get(pairId);
  if (t?.warn) clearTimeout(t.warn);
  if (t?.leave) clearTimeout(t.leave);
  waveIdleTimers.delete(pairId);
}

function setWaveIdle(pairId, socket) {
  clearWaveIdle(pairId);
  const warn = setTimeout(() => {
    socket.emit('message', { sender: 'partner', text: '뭐하냐 말 없으면 나갈게.' });
  }, 30000);
  const leave = setTimeout(async () => {
    socket.emit('message', { sender: 'partner', text: '인사하고 나간다~' });
    const pair = await waveRedis.deletePair(redisClient, pairId);
    if (pair) {
      const other = waveRedis.otherInPair(pair, socket.id);
      if (other && other !== 'ai') {
        io.to(other).emit('partner_ended', { pairId });
        await waveRedis.addReceiver(redisClient, other).catch(console.error);
      }
    }
    await waveRedis.addReceiver(redisClient, socket.id).catch(console.error);
    socket.emit('conversation_ended', { pairId });
    clearWaveIdle(pairId);
  }, 60000);
  waveIdleTimers.set(pairId, { warn, leave });
}

function clearChatIdleForRoom(roomId) {
  const roomTimers = chatIdleTimers.get(roomId);
  if (!roomTimers) return;
  for (const t of roomTimers.values()) {
    if (t?.warn) clearTimeout(t.warn);
    if (t?.leave) clearTimeout(t.leave);
  }
  chatIdleTimers.delete(roomId);
}

function setChatIdle(roomId, socket, leaveRoom) {
  let roomTimers = chatIdleTimers.get(roomId);
  if (!roomTimers) {
    roomTimers = new Map();
    chatIdleTimers.set(roomId, roomTimers);
  }
  const prev = roomTimers.get(socket.id);
  if (prev?.warn) clearTimeout(prev.warn);
  if (prev?.leave) clearTimeout(prev.leave);
  const warn = setTimeout(() => {
    socket.emit('chat_message', { senderType: 'system', senderName: '상대', text: '뭐하냐 말 없으면 나갈게.' });
  }, 30000);
  const leave = setTimeout(() => {
    socket.emit('chat_message', { senderType: 'system', senderName: '상대', text: '인사하고 나갈게~' });
    leaveRoom();
  }, 60000);
  roomTimers.set(socket.id, { warn, leave });
}

async function sendAiResponses(roomId, userText) {
  const room = chatRooms.get(roomId);
  if (!room || room.aiParticipants.length === 0) return;
  const tasks = room.aiParticipants.map(async (ai, idx) => {
    await new Promise((r) => setTimeout(r, 800 * idx));
    await humanDelay();
    if (!chatRooms.has(roomId)) return;
    const end = aiReplyLatencyMs.startTimer();
    const result = await replyToUser({
      roomId: ai.key,
      socketId: ai.socketId,
      userText
    }).catch(() => ({ text: '잠깐만 ㅠ', personaId: ai.personaId, provider: 'na', fallback: false }));
    end({ provider: result.provider || 'na', fallback: String(!!result.fallback) });
    aiRepliesTotal.inc({ persona: result.personaId || ai.personaId, provider: result.provider || 'na', fallback: String(!!result.fallback) });
    io.to(roomId).emit('chat_message', { senderType: 'ai', senderName: getPersonaName(result.personaId || ai.personaId), text: result.text });
  });
  await Promise.all(tasks);
  clearChatIdleForRoom(roomId);
}

// 사람처럼 보이기 위한 타이핑 딜레이 (2~5초 랜덤)
function humanDelay() {
  const ms = 2000 + Math.floor(Math.random() * 3000);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ HTTP: 도메인별 정적 서빙 ============
app.use((req, res, next) => {
  const host = (req.get('host') || '').toLowerCase();
  if (host.includes('wave.neworbit')) {
    return express.static('wave', { index: 'index.html' })(req, res, next);
  }
  if (host.includes('chat.neworbit')) {
    return express.static('chat', { index: 'index.html' })(req, res, next);
  }
  next();
});

// ============ HTTP 엔드포인트 ============
app.get('/', (req, res) => {
  res.send('Chat Server Running on chat.neworbit.co.kr');
});

// 헬스체크 엔드포인트
app.get('/health', async (req, res) => {
    const health = { status: 'ok', uptime: process.uptime(), timestamp: Date.now() };
    try {
        await redisClient.ping();
        health.redis = 'connected';
    } catch (e) {
        health.redis = 'disconnected';
        health.status = 'degraded';
    }
    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
});

// Prometheus 메트릭 엔드포인트
app.get('/metrics', async (req, res) => {
    // 대기열 길이를 실시간으로 갱신
    try {
        const qLen = await redisClient.lLen(WAITING_QUEUE);
        waitingQueueLength.set(qLen);
    } catch (e) {
        // Redis 연결 실패 시 무시
    }
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    activeConnections.inc();

    const host = (socket.handshake.headers.host || '').toLowerCase();
    const isWave = host.includes('wave.neworbit');

    if (isWave) {
        // ========== 전파(wave) 플로우 ==========
        const isTestMode = socket.handshake.query.test === '1';
        let testPersonaIndex = 0;

        waveRedis.addReceiver(redisClient, socket.id).catch(console.error);

        socket.on('disconnect', async () => {
            activeConnections.dec();
            await waveRedis.removeReceiver(redisClient, socket.id);
            const pairId = await waveRedis.getPairIdBySocket(redisClient, socket.id);
            if (pairId) {
                clearWaveIdle(pairId);
                const pair = await waveRedis.deletePair(redisClient, pairId);
                const other = waveRedis.otherInPair(pair, socket.id);
                if (other && other !== 'ai') io.to(other).emit('partner_ended', { pairId });
                if (other === 'ai') { /* no socket */ }
                if (other && other !== 'ai') waveRedis.addReceiver(redisClient, other).catch(console.error);
            }
        });

        socket.on('send_broadcast', async (data) => {
            const text = (data?.text || '').toString().trim().slice(0, 2000);
            if (!text) return socket.emit('broadcast_error', { message: '메시지를 입력해주세요.' });
            await waveRedis.removeReceiver(redisClient, socket.id);

            // 테스트 모드: 항상 AI 매칭 + 클라이언트가 선택한 페르소나
            let receiver;
            let forcePersonaId = null;
            if (isTestMode) {
                receiver = 'ai';
                const personas = getPersonaList();
                const idx = typeof data?.personaIndex === 'number' ? data.personaIndex : testPersonaIndex;
                forcePersonaId = personas[idx % personas.length]?.id || null;
                testPersonaIndex = idx + 1;
            } else {
                receiver = await waveRedis.getRandomReceiver(redisClient, socket.id);
                if (!receiver) receiver = 'ai';
            }

            const pairId = 'pair_' + Date.now() + '_' + socket.id;
            if (receiver === 'ai') {
                await waveRedis.createPair(redisClient, pairId, socket.id, 'ai');
                socket.emit('broadcast_delivered', { pairId });
                setWaveIdle(pairId, socket);
                await ensurePersonaForRoom(pairId, socket.id, forcePersonaId);
                const [delayDone, aiResult] = await Promise.all([
                    humanDelay(),
                    (async () => {
                        const end = aiReplyLatencyMs.startTimer();
                        const result = await replyToUser({
                            roomId: pairId,
                            socketId: socket.id,
                            userText: text
                        }).catch(() => ({ text: '잠시 뒤에 다시 보내줘 ㅠ', personaId: 'na', provider: 'na', fallback: false }));
                        end({ provider: result.provider || 'na', fallback: String(!!result.fallback) });
                        aiRepliesTotal.inc({ persona: result.personaId || 'na', provider: result.provider || 'na', fallback: String(!!result.fallback) });
                        return result;
                    })()
                ]);
                clearWaveIdle(pairId);
                socket.emit('message', { sender: 'partner', text: aiResult.text, ...(isTestMode ? { _personaId: aiResult.personaId } : {}) });
            } else {
                await waveRedis.removeReceiver(redisClient, receiver);
                await waveRedis.createPair(redisClient, pairId, socket.id, receiver);
                io.to(receiver).emit('broadcast_received', { pairId, text });
                socket.emit('broadcast_delivered', { pairId });
                setWaveIdle(pairId, socket);
            }
            messagesTotal.inc();
        });

        socket.on('wave_message', async (data) => {
            const { pairId, text } = data || {};
            const msg = (text || '').toString().trim().slice(0, 2000);
            if (!pairId || !msg) return;
            const pair = await waveRedis.getPair(redisClient, pairId);
            if (!pair) return socket.emit('error', { message: '대화가 종료되었어요.' });
            const other = waveRedis.otherInPair(pair, socket.id);
            if (!other) return;
            if (other === 'ai') {
                const [, aiResult] = await Promise.all([
                    humanDelay(),
                    (async () => {
                        const end = aiReplyLatencyMs.startTimer();
                        const result = await replyToUser({
                            roomId: pairId,
                            socketId: socket.id,
                            userText: msg
                        }).catch(() => ({ text: '잠시 뒤에 다시 보내줘 ㅠ', personaId: 'na', provider: 'na', fallback: false }));
                        end({ provider: result.provider || 'na', fallback: String(!!result.fallback) });
                        aiRepliesTotal.inc({ persona: result.personaId || 'na', provider: result.provider || 'na', fallback: String(!!result.fallback) });
                        return result;
                    })()
                ]);
                clearWaveIdle(pairId);
                socket.emit('message', { sender: 'partner', text: aiResult.text, ...(isTestMode ? { _personaId: aiResult.personaId } : {}) });
            } else {
                setWaveIdle(pairId, socket);
                io.to(other).emit('message', { sender: 'partner', text: msg });
            }
            messagesTotal.inc();
        });

        socket.on('end_conversation', async (data) => {
            const pairId = (data?.pairId || '').toString();
            if (!pairId) return;
            const pair = await waveRedis.deletePair(redisClient, pairId);
            if (!pair) return;
            const other = waveRedis.otherInPair(pair, socket.id);
            if (other && other !== 'ai') {
                io.to(other).emit('partner_ended', { pairId });
                await waveRedis.addReceiver(redisClient, other).catch(console.error);
            }
            await waveRedis.addReceiver(redisClient, socket.id).catch(console.error);
            socket.emit('conversation_ended', { pairId });
            clearWaveIdle(pairId);
        });

        return;
    }

    // ========== 채팅(chat) 플로우 ==========
    function leaveRoom() {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        const room = chatRooms.get(roomId);
        if (!room) return;
        room.sockets.delete(socket.id);
        room.humans.delete(socket.id);
        socket.leave(roomId);
        socket.data.roomId = null;
        if (room.humans.size === 0) {
            if (room.timers?.ai1) clearTimeout(room.timers.ai1);
            if (room.timers?.ai2) clearTimeout(room.timers.ai2);
            clearChatIdleForRoom(roomId);
            chatRooms.delete(roomId);
        } else {
            io.to(roomId).emit('room_joined', buildRoomPayload(room));
        }
    }

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        activeConnections.dec();
        leaveRoom();
    });

    socket.on('chat_leave', () => {
        leaveRoom();
    });

    // 방 만들기/접속 요청
    socket.on('chat_request', async (payload = {}) => {
        const mode = payload.mode === 'create' ? 'create' : 'existing';
        const settings = normalizeSettings(payload.settings || {});

        // 사용자 프로필 저장(간단)
        const tags = normalizeTags(settings.interests);
        await sessionMemory.setProfile(socket.id, { purpose: 'smalltalk', tags, ageGroup: settings.ageGroup, gender: settings.gender }, 3600).catch(() => {});

        // 기존 방 찾기
        let targetRoom = null;
        if (mode === 'existing') {
            for (const room of chatRooms.values()) {
                if (room.humans.size >= room.roomSize) continue;
                if (room.humans.size < 1) continue;
                if (roomMatches(room.settings, settings)) {
                    targetRoom = room;
                    break;
                }
            }
        }

        // 새 방 생성
        if (!targetRoom) {
            const roomId = `chat_${Date.now()}_${socket.id}`;
            targetRoom = {
                roomId,
                settings,
                roomSize: settings.roomSize,
                sockets: new Set(),
                humans: new Set(),
                aiParticipants: [],
                timers: {}
            };
            chatRooms.set(roomId, targetRoom);

            // 5초 대기 후 AI 1명 입장
            targetRoom.timers.ai1 = setTimeout(async () => {
                const room = chatRooms.get(roomId);
                if (!room) return;
                if (room.humans.size === 1 && room.aiParticipants.length === 0) {
                    await addAiToRoom(roomId, 'wait-5s');
                }
            }, 5000);

            // 60초 후에도 사람 미입장 시 AI 추가
            targetRoom.timers.ai2 = setTimeout(async () => {
                const room = chatRooms.get(roomId);
                if (!room) return;
                if (room.humans.size === 1 && room.aiParticipants.length === 1 && room.humans.size + room.aiParticipants.length < room.roomSize) {
                    await addAiToRoom(roomId, 'wait-60s');
                }
            }, 65000);
        }

        // 방 참여
        const roomId = targetRoom.roomId;
        socket.join(roomId);
        socket.data.roomId = roomId;
        targetRoom.sockets.add(socket.id);
        targetRoom.humans.add(socket.id);

        socket.emit('room_wait', { roomId, message: '대기 중이에요...' });
        io.to(roomId).emit('room_joined', buildRoomPayload(targetRoom));
        matchesTotal.inc({ type: 'human' });
    });

    // 메시지 전송
    socket.on('chat_message', async (data = {}) => {
        const roomId = data.roomId || socket.data.roomId;
        const room = chatRooms.get(roomId);
        const msg = String(data.text || '').trim().slice(0, 2000);
        if (!room || !msg) return;
        clearChatIdleForRoom(roomId);
        socket.to(roomId).emit('chat_message', { senderType: 'human', senderName: '상대', text: msg });
        messagesTotal.inc();
        setChatIdle(roomId, socket, leaveRoom);
        await sendAiResponses(roomId, msg);
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});