require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createClient } = require("redis");
const aiHandler = require('./aiHandler');
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

// ============ Redis 클라이언트 설정 ============
const redisClient = createClient({ url: 'redis://redis:6379' });
redisClient.connect().catch(console.error);

const WAITING_QUEUE = 'waiting_queue';

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

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        activeConnections.dec();
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
                    
                    // AI가 먼저 인사
                    setTimeout(async () => {
                         const hello = await aiHandler.getResponse([], "안녕? 반가워 ㅋㅋ");
                         socket.emit('message', { sender: 'partner', text: hello });
                    }, 1000);
                }
            }, 15000);
        }
    });

    // 메시지 전송
    socket.on('message', async (data) => {
        const { roomId, message, partnerType, chatHistory } = data;
        socket.to(roomId).emit('message', { sender: 'partner', text: message });
        messagesTotal.inc();

        // 상대가 AI면 답변 생성
        if (partnerType === 'ai') {
            const aiReply = await aiHandler.getResponse(chatHistory || [], message);
            io.to(roomId).emit('message', { sender: 'partner', text: aiReply });
        }
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});