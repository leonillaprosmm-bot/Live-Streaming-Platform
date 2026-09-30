const express = require('express');
const cors = require('cors');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// Проверка что переменные окружения заданы
if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    console.error('❌ ОШИБКА: Не заданы переменные окружения LIVEKIT_*');
}

// Health check (для cron-job.org)
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'ProStream LiveKit Token Server',
        livekit_url: LIVEKIT_URL
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', ts: Date.now() });
});

// Генерация токена для подключения к LiveKit
app.post('/token', async (req, res) => {
    try {
        const { roomName, participantName } = req.body;

        if (!roomName || !participantName) {
            return res.status(400).json({
                error: 'roomName и participantName обязательны'
            });
        }

        // Создаём токен с правами на вход в комнату
        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: participantName,
            ttl: '6h' // токен живёт 6 часов
        });

        at.addGrant({
            room: roomName,
            roomJoin: true,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true
        });

        const token = await at.toJwt();

        res.json({
            token,
            url: LIVEKIT_URL
        });

    } catch (err) {
        console.error('❌ Ошибка генерации токена:', err);
        res.status(500).json({ error: 'Ошибка генерации токена' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 LiveKit Token Server on port ${PORT}`);
    console.log(`🔗 LiveKit URL: ${LIVEKIT_URL}`);
});
