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

// 사람처럼 보이기 위한 타이핑 딜레이 (2~5초 랜덤)
function humanDelay() {
  const ms = 2000 + Math.floor(Math.random() * 3000);
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ HTTP: wave.neworbit.co.kr 이면 전파 앱 정적 서빙 ============
app.use((req, res, next) => {
  const host = (req.get('host') || '').toLowerCase();
  if (host.includes('wave.neworbit')) {
    return express.static('wave', { index: 'index.html' })(req, res, next);
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
                socket.emit('message', { sender: 'partner', text: aiResult.text, ...(isTestMode ? { _personaId: aiResult.personaId } : {}) });
            } else {
                await waveRedis.removeReceiver(redisClient, receiver);
                await waveRedis.createPair(redisClient, pairId, socket.id, receiver);
                io.to(receiver).emit('broadcast_received', { pairId, text });
                socket.emit('broadcast_delivered', { pairId });
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
                socket.emit('message', { sender: 'partner', text: aiResult.text, ...(isTestMode ? { _personaId: aiResult.personaId } : {}) });
            } else {
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
        });

        return;
    }

    // ========== 기존 채팅(chat) 플로우 ==========
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        activeConnections.dec();
    });

    // 초기 프로필 설정 (목적/관심사/옵션 연령/성별)
    // 예: socket.emit('set_profile', { purpose: 'smalltalk', tags: ['game','music'], ageGroup: '20s', gender: 'na' })
    socket.on('set_profile', async (profile) => {
        try {
            await sessionMemory.setProfile(socket.id, profile, 3600);
            socket.emit('profile_saved', { ok: true });
        } catch (e) {
            console.error('set_profile error:', e);
            socket.emit('profile_saved', { ok: false });
        }
    });

    // 대기열 참가
    socket.on('join_queue', async () => {
        const queueLength = await redisClient.lLen(WAITING_QUEUE);

        if (queueLength > 0) {
            // 대기자가 있으면 즉시 매칭
            const partnerId = await redisClient.rPop(WAITING_QUEUE);
            const roomId = "room_" + socket.id + "_" + partnerId;
            
            socket.join(roomId);
            io.to(partnerId).socketsJoin(roomId);
            
            io.to(roomId).emit('match_success', { roomId, partner: 'human' });
            matchesTotal.inc({ type: 'human' });
            
        } else {
            // 대기자가 없으면 대기열 등록
            await redisClient.lPush(WAITING_QUEUE, socket.id);
            
            // 15초 뒤 AI 매칭 (Fallback)
            setTimeout(async () => {
                const stillWaiting = await redisClient.lRem(WAITING_QUEUE, 0, socket.id);
                if (stillWaiting > 0) {
                    const roomId = "ai_room_" + socket.id;
                    socket.join(roomId);
                    socket.emit('match_success', { roomId, partner: 'ai' });
                    matchesTotal.inc({ type: 'ai' });
                    // 페르소나 고정(방 단위)
                    await ensurePersonaForRoom(roomId, socket.id);
                    
                    // AI가 먼저 인사
                    setTimeout(async () => {
                         const { text, personaId, provider, fallback } = await replyToUser({
                            roomId,
                            socketId: socket.id,
                            userText: "안녕? 반가워 ㅋㅋ"
                         });
                         aiRepliesTotal.inc({ persona: personaId, provider: provider || 'na', fallback: String(!!fallback) });
                         socket.emit('message', { sender: 'partner', text });
                    }, 1000);
                }
            }, 15000);
        }
    });

    // 메시지 전송
    socket.on('message', async (data) => {
        const { roomId, message, partnerType } = data;
        socket.to(roomId).emit('message', { sender: 'partner', text: message });
        messagesTotal.inc();

        // 상대가 AI면 답변 생성
        if (partnerType === 'ai') {
            const end = aiReplyLatencyMs.startTimer();
            const { text, personaId, provider, fallback } = await replyToUser({
                roomId,
                socketId: socket.id,
                userText: message
            });
            aiRepliesTotal.inc({ persona: personaId, provider: provider || 'na', fallback: String(!!fallback) });
            end({ provider: provider || 'na', fallback: String(!!fallback) });
            io.to(roomId).emit('message', { sender: 'partner', text });
        }
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});