require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { createClient } = require("redis");
const aiHandler = require('./aiHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Redis 클라이언트 설정 (Docker 내부 통신용)
const redisClient = createClient({ url: 'redis://redis:6379' });
redisClient.connect().catch(console.error);

const WAITING_QUEUE = 'waiting_queue';

app.get('/', (req, res) => {
  res.send('Chat Server Running on chat.neworbit.co.kr');
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

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