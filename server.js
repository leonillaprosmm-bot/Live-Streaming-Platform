const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const rooms = {};

io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    socket.on('join-room', (roomId) => {
        if (!rooms[roomId]) rooms[roomId] = [];
        if (rooms[roomId].length >= 2) {
            socket.emit('room-full', roomId);
            return;
        }
        rooms[roomId].push(socket.id);
        socket.join(roomId);
        socket.roomId = roomId;
        if (rooms[roomId].length === 2) {
            io.to(roomId).emit('ready', roomId);
            console.log(`✅ Room ${roomId} ready`);
        } else {
            socket.emit('waiting', roomId);
        }
    });

    socket.on('signal', ({ roomId, data }) => {
        socket.to(roomId).emit('signal', data);
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
            if (rooms[roomId].length === 0) delete rooms[roomId];
            else io.to(roomId).emit('peer-disconnected');
        }
    });
});

app.get('/', (req, res) => res.send('✅ ProStream Signaling Server works'));
app.get('/health', (req, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
