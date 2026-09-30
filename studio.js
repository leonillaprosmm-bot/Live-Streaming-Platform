// ============================================================
// STUDIO.JS — Обработчик одного видео (1920x1080 FullHD)
// ============================================================

export class Studio {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        // FullHD по умолчанию
        this.canvas.width = 1920;
        this.canvas.height = 1080;

        this.videoEl = document.createElement('video');
        this.videoEl.autoplay = true;
        this.videoEl.playsInline = true;
        this.videoEl.muted = true;

        this.ownStream = null;
        this.currentSourceStream = null;
        this.outputStream = null;
        this.running = false;
        this.rafId = null;

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
            orientation: 'horizontal', // horizontal | vertical
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
            const mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
            const SelfieSegmentation = window.SelfieSegmentation || mod.SelfieSegmentation;
            if (!SelfieSegmentation) {
                console.warn('MediaPipe SDK не загрузился');
                return;
            }

            this.selfieSegmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
            });
            // modelSelection: 1 — landscape (лучше для 16:9)
            this.selfieSegmentation.setOptions({ modelSelection: 1 });
            this.selfieSegmentation.onResults((results) => {
                this.state.lastResults = results;
                this.state.mediaPipeReady = true;
            });

            // Прогреваем модель
            console.log('✅ MediaPipe Selfie Segmentation инициализирован');
        } catch (e) {
            console.warn('MediaPipe не загрузился:', e);
        }
    }

    async start() {
        this.ownStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: true
        });

        this.currentSourceStream = this.ownStream;
        this.videoEl.srcObject = this.ownStream;
        await this.videoEl.play();

        // Выходной поток — FullHD, 30 fps
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
        this.currentSourceStream = null;
    }

    // ============ СМЕНА ИСТОЧНИКА ============
    async setSource(stream, label) {
        if (!stream) {
            console.warn('setSource: пустой стрим');
            return;
        }
        console.log('🎬 Студия переключается на:', label, 'треки:', stream.getTracks().length);
        this.currentSourceStream = stream;
        this.videoEl.srcObject = stream;
        try {
            await this.videoEl.play();
            this.state.sourceLabel = label || 'Источник';
            this.state.lastResults = null; // сброс маски
        } catch (e) {
            console.warn('Ошибка play:', e);
        }
    }

    async _loop() {
        if (!this.running) return;
        if (this.videoEl.readyState >= 2) {
            const useMask = this.state.background === 'blur' || this.state.background === 'green' || this.state.background === 'image';
            if (this.selfieSegmentation && useMask) {
                try {
                    await this.selfieSegmentation.send({ image: this.videoEl });
                } catch (e) {}
            }
            this._draw();
        }
        this.rafId = requestAnimationFrame(() => this._loop());
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const video = this.videoEl;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        // 1. ФОН
        if (this.state.background === 'image' && this.state.backgroundImage) {
            ctx.drawImage(this.state.backgroundImage, 0, 0, w, h);
        } else if (this.state.background === 'green') {
            ctx.fillStyle = '#00b140';
            ctx.fillRect(0, 0, w, h);
        } else if (this.state.background === 'blur') {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, w, h);
        }

        // 2. ВИДЕО
        const results = this.state.lastResults;
        const useMask = (this.state.background === 'blur' || this.state.background === 'green' || this.state.background === 'image') && results;
        const scale = this.state.videoScale;
        const offsetY = this.state.videoY;

        if (useMask) {
            // По маске (с учётом scale)
            ctx.save();
            ctx.filter = 'blur(2px)';
            ctx.drawImage(results.segmentationMask, 0, offsetY, w * scale, h * scale);
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(results.image, 0, offsetY, w * scale, h * scale);
            ctx.restore();
        } else {
            // Обычное видео
            const vr = video.videoWidth / video.videoHeight || 16/9;
            const cr = w / h;
            let dw, dh, dx, dy;
            if (vr > cr) { dh = h * scale; dw = dh * vr; dx = (w - dw) / 2; dy = offsetY; }
            else { dw = w * scale; dh = dw / vr; dx = (w - dw) / 2; dy = (h - dh) / 2 + offsetY; }
            ctx.globalAlpha = this.state.opacity;
            ctx.drawImage(video, dx, dy, dw, dh);
            ctx.globalAlpha = 1;
        }

        // 3. ЭФФЕКТЫ
        if (this.state.videoEffect !== 'original') {
            this._applyVideoEffect();
        }

        // 4. ТЕКСТ
        if (this.state.showText && this.state.textFront) {
            this._drawText();
        }

        ctx.restore();
    }

    _applyVideoEffect() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const intensity = this.state.intensity;

        switch (this.state.videoEffect) {
            case 'glitch': {
                const shift = Math.floor(5 + Math.random() * 15 * intensity);
                try {
                    const imageData = ctx.getImageData(0, 0, w, h);
                    ctx.putImageData(imageData, shift, 0);
                } catch (e) {}
                break;
            }
            case 'pixel': {
                const size = Math.max(6, Math.floor(24 / intensity));
                try {
                    const imageData = ctx.getImageData(0, 0, w, h);
                    const data = imageData.data;
                    for (let y = 0; y < h; y += size) {
                        for (let x = 0; x < w; x += size) {
                            const i = (y * w + x) * 4;
                            ctx.fillStyle = `rgb(${data[i]},${data[i+1]},${data[i+2]})`;
                            ctx.fillRect(x, y, size, size);
                        }
                    }
                } catch (e) {}
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
            case 'noise': {
                try {
                    const imageData = ctx.getImageData(0, 0, w, h);
                    const data = imageData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const noise = (Math.random() - 0.5) * 100 * intensity;
                        data[i] = Math.min(255, Math.max(0, data[i] + noise));
                        data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise));
                        data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise));
                    }
                    ctx.putImageData(imageData, 0, 0);
                } catch (e) {}
                break;
            }
            case 'blur': {
                const tmp = document.createElement('canvas');
                tmp.width = w; tmp.height = h;
                tmp.getContext('2d').drawImage(this.canvas, 0, 0);
                ctx.filter = `blur(${Math.max(1, 8 * intensity)}px)`;
                ctx.drawImage(tmp, 0, 0);
                ctx.filter = 'none';
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

    // ============ ПУБЛИЧНЫЕ МЕТОДЫ ============
    setBackground(type, imageUrl) {
        this.state.background = type;
        if (type === 'image' && imageUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { this.state.backgroundImage = img; };
            img.src = imageUrl;
        }
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

    // Формат: 16:9 (1920x1080) или 9:16 (1080x1920)
    setOrientation(orientation) {
        this.state.orientation = orientation;
        if (orientation === 'vertical') {
            this.canvas.width = 1080;
            this.canvas.height = 1920;
        } else {
            this.canvas.width = 1920;
            this.canvas.height = 1080;
        }
        console.log('🎬 Формат:', orientation, this.canvas.width + 'x' + this.canvas.height);
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
