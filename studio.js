// ============================================================
// STUDIO.JS — Обработчик одного видео (1920x1080) + рабочий MediaPipe
// ============================================================

export class Studio {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.canvas.width = 1920;
        this.canvas.height = 1080;

        this.videoEl = document.createElement('video');
        this.videoEl.autoplay = true;
        this.videoEl.playsInline = true;
        this.videoEl.muted = true;
        this.videoEl.style.display = 'none';
        document.body.appendChild(this.videoEl);

        this.ownStream = null;
        this.currentSourceStream = null;
        this.outputStream = null;
        this.running = false;
        this.rafId = null;
        this._sending = false; // защита от наложения send()

        this.state = {
            background: 'none',
            backgroundImage: null,
            videoEffect: 'original',
            intensity: 1.0,
            opacity: 1.0,
            videoScale: 1.0,
            videoY: 0,
            textFront: '',
            textFrontColor: '#ff3366',
            textSize: 80,
            showText: false,
            orientation: 'horizontal',
            sourceLabel: 'Своя камера',
            selfieSegmentation: null,
            lastResults: null,
            mediaPipeReady: false
        };

        this.selfieSegmentation = null;
        this._initMediaPipe();
    }

    async _initMediaPipe() {
        try {
            // Ждём пока window.SelfieSegmentation появится (грузится в HTML)
            let waited = 0;
            while (!window.SelfieSegmentation && waited < 10000) {
                await new Promise(r => setTimeout(r, 200));
                waited += 200;
            }

            if (!window.SelfieSegmentation) {
                console.error('❌ window.SelfieSegmentation не найден. Добавь <script> в <head>');
                return;
            }

            this.selfieSegmentation = new window.SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
            });

            this.selfieSegmentation.setOptions({ modelSelection: 1 });

            this.selfieSegmentation.onResults((results) => {
                this.state.lastResults = results;
                if (!this.state.mediaPipeReady) {
                    this.state.mediaPipeReady = true;
                    console.log('✅ MediaPipe Selfie Segmentation ГОТОВ');
                }
            });

            console.log('✅ MediaPipe инициализирован');
        } catch (e) {
            console.error('❌ Ошибка MediaPipe:', e);
        }
    }

    async start() {
        this.ownStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

        this.currentSourceStream = this.ownStream;
        this.videoEl.srcObject = this.ownStream;
        await this.videoEl.play();

        this.outputStream = this.canvas.captureStream(30);

        const audioTrack = this.ownStream.getAudioTracks()[0];
        if (audioTrack) this.outputStream.addTrack(audioTrack);

        this.running = true;
        this._loop();
        return this.outputStream;
    }

    stop() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.ownStream) this.ownStream.getTracks().forEach(t => t.stop());
        if (this.outputStream) this.outputStream.getTracks().forEach(t => t.stop());
        this.ownStream = null;
        this.outputStream = null;
    }

    async setSource(stream, label) {
        if (!stream) return;
        console.log('🎬 Источник:', label);
        this.currentSourceStream = stream;
        this.videoEl.srcObject = stream;
        try { await this.videoEl.play(); } catch (e) {}
        this.state.sourceLabel = label || 'Источник';
        this.state.lastResults = null;
    }

    // ============ ЦИКЛ: рисуем ВСЕГДА, маску шлём параллельно ============
    _loop() {
        if (!this.running) return;

        if (this.videoEl.readyState >= 2) {
            const needsMask = this.state.background === 'blur'
                           || this.state.background === 'green'
                           || this.state.background === 'image';

            // Отправляем в MediaPipe ТОЛЬКО если не занят (не блокируем цикл)
            if (this.selfieSegmentation && this.state.mediaPipeReady && needsMask && !this._sending) {
                this._sending = true;
                this.selfieSegmentation.send({ image: this.videoEl })
                    .catch(() => {})
                    .finally(() => { this._sending = false; });
            }

            // Рисуем КАЖДЫЙ кадр — с последней готовой маской (или без неё)
            this._draw();
        }

        this.rafId = requestAnimationFrame(() => this._loop());
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';

        ctx.clearRect(0, 0, w, h);

        const results = this.state.lastResults;
        const useMask = (this.state.background === 'blur'
                      || this.state.background === 'green'
                      || this.state.background === 'image') && results;

        // === 1. ФОН ===
        if (useMask) {
            if (this.state.background === 'image' && this.state.backgroundImage) {
                ctx.drawImage(this.state.backgroundImage, 0, 0, w, h);
            } else if (this.state.background === 'green') {
                ctx.fillStyle = '#00b140';
                ctx.fillRect(0, 0, w, h);
            } else if (this.state.background === 'blur') {
                ctx.save();
                ctx.filter = 'blur(20px)';
                ctx.drawImage(results.image, 0, 0, w, h);
                ctx.restore();
            }

            // === 2. ЧЕЛОВЕК ПО МАСКЕ ===
            ctx.save();
            ctx.filter = 'blur(4px)';
            ctx.drawImage(results.segmentationMask, 0, 0, w, h);
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(results.image, 0, 0, w, h);
            ctx.restore();
        } else {
            // Без фона — просто видео
            const vr = this.videoEl.videoWidth / this.videoEl.videoHeight || 16/9;
            const cr = w / h;
            let dw, dh, dx, dy;
            if (vr > cr) { dh = h; dw = h * vr; dx = (w - dw) / 2; dy = 0; }
            else { dw = w; dh = w / vr; dx = 0; dy = (h - dh) / 2; }
            ctx.drawImage(this.videoEl, dx, dy, dw, dh);
        }

        // === 3. ЭФФЕКТЫ ===
        if (this.state.videoEffect !== 'original') {
            this._applyVideoEffect();
        }

        // === 4. ТЕКСТ ===
        if (this.state.showText && this.state.textFront) {
            this._drawText();
        }
    }

    _applyVideoEffect() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const intensity = this.state.intensity;

        switch (this.state.videoEffect) {
            case 'invert': {
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, w, h);
                ctx.globalCompositeOperation = 'source-over';
                break;
            }
            case 'sepia': {
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = `rgba(255, 240, 200, ${0.4 * intensity})`;
                ctx.fillRect(0, 0, w, h);
                ctx.globalCompositeOperation = 'source-over';
                break;
            }
            case 'vhs': {
                for (let i = 0; i < 40 * intensity; i++) {
                    const y = Math.random() * h;
                    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
                    ctx.fillRect(0, y, w, 3);
                }
                break;
            }
        }
    }

    _drawText() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const size = this.state.textSize;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${size}px Arial, sans-serif`;
        ctx.lineWidth = size * 0.06;
        ctx.strokeStyle = '#000';
        ctx.strokeText(this.state.textFront, w / 2, h - 100);
        ctx.fillStyle = this.state.textFrontColor;
        ctx.fillText(this.state.textFront, w / 2, h - 100);
        ctx.restore();
    }

    setBackground(type, imageUrl) {
        this.state.background = type;
        if (type === 'image' && imageUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { this.state.backgroundImage = img; };
            img.src = imageUrl;
        }
        console.log('🎨 Фон:', type);
    }

    setVideoEffect(effect) { this.state.videoEffect = effect; }
    setIntensity(val) { this.state.intensity = val; }
    setOpacity(val) { this.state.opacity = val; }
    setVideoScale(val) { this.state.videoScale = val; }
    setVideoY(val) { this.state.videoY = val; }

    setText(text, color) {
        this.state.textFront = text;
        this.state.textFrontColor = color || '#ff3366';
        this.state.showText = !!text;
    }
    setTextSize(size) { this.state.textSize = size; }

    setOrientation(orientation) {
        this.state.orientation = orientation;
        if (orientation === 'vertical') {
            this.canvas.width = 1080;
            this.canvas.height = 1920;
        } else {
            this.canvas.width = 1920;
            this.canvas.height = 1080;
        }
    }

    setMicEnabled(enabled) {
        if (this.ownStream) {
            const audioTrack = this.ownStream.getAudioTracks()[0];
            if (audioTrack) audioTrack.enabled = enabled;
        }
    }

    getInputStream() { return this.ownStream; }
    getOutputStream() { return this.outputStream; }
    getAudioTrack() {
        return this.outputStream ? this.outputStream.getAudioTracks()[0] : null;
    }
    getVideoTrack() {
        return this.outputStream ? this.outputStream.getVideoTracks()[0] : null;
    }
    getSourceLabel() { return this.state.sourceLabel; }
    isMediaPipeReady() { return this.state.mediaPipeReady; }
}
