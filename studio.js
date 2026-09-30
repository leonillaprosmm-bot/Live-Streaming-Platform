// ============================================================
// STUDIO.JS — Эффекты, фон, текст, виртуальная камера
// ============================================================

export class Studio {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.canvas.width = 1280;
        this.canvas.height = 720;

        this.videoEl = document.createElement('video');
        this.videoEl.autoplay = true;
        this.videoEl.playsInline = true;
        this.videoEl.muted = true;

        this.stream = null;
        this.outputStream = null;
        this.running = false;
        this.rafId = null;

        // Состояние эффектов
        this.state = {
            background: 'none',      // none | blur | green | image
            backgroundImage: null,   // HTMLImageElement
            videoEffect: 'original', // original | glitch | pixel | blur | vhs | invert | sepia | thermal | noise
            intensity: 1.0,
            textFront: '',
            textFrontColor: '#ff3366',
            textBack: '',
            textBackColor: '#00ff88',
            textSize: 60,
            showText: false,
            segmenter: null,
            segmentationMask: null,
            lastResults: null
        };

        // MediaPipe Selfie Segmentation для фона
        this.selfieSegmentation = null;
        this._initMediaPipe();
    }

    async _initMediaPipe() {
        try {
            const mod = await import('https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js');
            const SelfieSegmentation = window.SelfieSegmentation || mod.SelfieSegmentation;
            if (!SelfieSegmentation) return;

            this.selfieSegmentation = new SelfieSegmentation({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`
            });
            this.selfieSegmentation.setOptions({ modelSelection: 1 });
            this.selfieSegmentation.onResults((results) => {
                this.state.lastResults = results;
            });
        } catch (e) {
            console.warn('MediaPipe не загрузился:', e);
        }
    }

    // Запуск: получаем камеру, стартуем цикл
    async start() {
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720 },
            audio: true
        });
        this.videoEl.srcObject = this.stream;
        await this.videoEl.play();

        // Создаём выходной поток из canvas
        this.outputStream = this.canvas.captureStream(30);

        // Подмешиваем аудио из камеры
        const audioTrack = this.stream.getAudioTracks()[0];
        if (audioTrack) this.outputStream.addTrack(audioTrack);

        this.running = true;
        this._loop();
        return this.outputStream;
    }

    stop() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        if (this.outputStream) this.outputStream.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.outputStream = null;
    }

    async _loop() {
        if (!this.running) return;

        if (this.videoEl.readyState >= 2) {
            // Отправляем кадр в MediaPipe (если фон включён)
            if (this.selfieSegmentation && (this.state.background === 'blur' || this.state.background === 'green' || this.state.background === 'image')) {
                try { await this.selfieSegmentation.send({ image: this.videoEl }); } catch (e) {}
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

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        // === 1. ФОН ===
        if (this.state.background === 'image' && this.state.backgroundImage) {
            ctx.drawImage(this.state.backgroundImage, 0, 0, w, h);
        } else if (this.state.background === 'green') {
            ctx.fillStyle = '#00b140';
            ctx.fillRect(0, 0, w, h);
        } else if (this.state.background === 'blur') {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, w, h);
        }

        // === 2. ВИДЕО (с маской или без) ===
        const results = this.state.lastResults;
        const useMask = (this.state.background === 'blur' || this.state.background === 'green' || this.state.background === 'image') && results;

        if (useMask) {
            // Рисуем по маске
            ctx.save();
            ctx.filter = 'blur(3px)';
            ctx.drawImage(results.segmentationMask, 0, 0, w, h);
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'source-in';
            ctx.drawImage(results.image, 0, 0, w, h);
            ctx.restore();
        } else {
            // Просто видео на весь кадр (object-fit: cover)
            const vr = video.videoWidth / video.videoHeight;
            const cr = w / h;
            let dw, dh, dx, dy;
            if (vr > cr) { dh = h; dw = h * vr; dx = (w - dw) / 2; dy = 0; }
            else { dw = w; dh = w / vr; dx = 0; dy = (h - dh) / 2; }
            ctx.drawImage(video, dx, dy, dw, dh);
        }

        // === 3. ВИДЕО-ЭФФЕКТЫ ===
        if (this.state.videoEffect !== 'original') {
            this._applyVideoEffect();
        }

        // === 4. ТЕКСТ ===
        if (this.state.showText && this.state.textFront) {
            this._drawText();
        }

        ctx.restore();
    }

    _applyVideoEffect() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        switch (this.state.videoEffect) {
            case 'glitch': {
                const shift = 5 + Math.random() * 15 * this.state.intensity;
                const frame = ctx.getImageData(0, 0, w, h);
                ctx.putImageData(frame, shift, 0);
                break;
            }
            case 'pixel': {
                const size = Math.max(4, Math.floor(15 / this.state.intensity));
                const imageData = ctx.getImageData(0, 0, w, h);
                const data = imageData.data;
                for (let y = 0; y < h; y += size) {
                    for (let x = 0; x < w; x += size) {
                        const i = (y * w + x) * 4;
                        const r = data[i], g = data[i+1], b = data[i+2];
                        ctx.fillStyle = `rgb(${r},${g},${b})`;
                        ctx.fillRect(x, y, size, size);
                    }
                }
                break;
            }
            case 'blur':
                ctx.filter = `blur(${Math.max(1, 5 * this.state.intensity)}px)`;
                ctx.drawImage(this.canvas, 0, 0);
                ctx.filter = 'none';
                break;
            case 'vhs': {
                for (let i = 0; i < 30 * this.state.intensity; i++) {
                    const y = Math.random() * h;
                    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.1})`;
                    ctx.fillRect(0, y, w, 1);
                }
                break;
            }
            case 'invert':
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, w, h);
                ctx.globalCompositeOperation = 'source-over';
                break;
            case 'sepia':
                ctx.globalCompositeOperation = 'multiply';
                ctx.fillStyle = 'rgba(255, 240, 200, ' + (0.3 * this.state.intensity) + ')';
                ctx.fillRect(0, 0, w, h);
                ctx.globalCompositeOperation = 'source-over';
                break;
            case 'thermal':
                ctx.globalCompositeOperation = 'hue-rotate';
                ctx.filter = `hue-rotate(180deg) saturate(3)`;
                ctx.drawImage(this.canvas, 0, 0);
                ctx.filter = 'none';
                break;
            case 'noise': {
                const imageData = ctx.getImageData(0, 0, w, h);
                const data = imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    const noise = (Math.random() - 0.5) * 100 * this.state.intensity;
                    data[i] = Math.min(255, Math.max(0, data[i] + noise));
                    data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise));
                    data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise));
                }
                ctx.putImageData(imageData, 0, 0);
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
        ctx.strokeText(this.state.textFront, w / 2, h - 80);
        ctx.fillStyle = this.state.textFrontColor;
        ctx.fillText(this.state.textFront, w / 2, h - 80);
        ctx.restore();
    }

    // Публичные методы для управления
    setBackground(type, imageUrl) {
        this.state.background = type;
        if (type === 'image' && imageUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => { this.state.backgroundImage = img; };
            img.src = imageUrl;
        }
    }

    setVideoEffect(effect) {
        this.state.videoEffect = effect;
    }

    setIntensity(val) {
        this.state.intensity = val;
    }

    setText(text, color) {
        this.state.textFront = text;
        this.state.textFrontColor = color || '#ff3366';
        this.state.showText = !!text;
    }

    setTextSize(size) {
        this.state.textSize = size;
    }

    getInputStream() { return this.stream; }
    getOutputStream() { return this.outputStream; }
}
