/**
 * renderer.js - HTML5 Canvas 2D Medisinsk Ventilator Monitor
 * 
 * Tegner tre synkroniserte kurver med "Sweep Bar"-effekt:
 * 1. Trykk (Paw) [Gul/Orange]
 * 2. Tidalvolum (V) [Grønn]
 * 3. Flow (V') [Blå]
 */

class WaveformRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Farger
        this.colors = {
            bg: '#0a0e17',
            grid: '#151f30',
            gridBold: '#1e2d47',
            sweepBar: '#ffffff',
            pressure: '#f59e0b', // Gul/Oransje
            pressureFill: 'rgba(245, 158, 11, 0.08)',
            volume: '#10b981',   // Grønn
            volumeFill: 'rgba(16, 185, 129, 0.08)',
            flow: '#0ea5e9',     // Blå
            flowFill: 'rgba(14, 165, 233, 0.08)',
            zeroLine: 'rgba(255, 255, 255, 0.2)',
            text: '#94a3b8',
            textBright: '#e2e8f0'
        };

        // Sweep innstillinger
        this.sweepDuration = 6.0; // sekunder for ett helt sveip over skjermen
        this.sweepTime = 0;
        this.sweepX = 0;
        this.eraseWidth = 25; // Piksler foran sveipelinjen som slettes for "refresh"-effekt

        // Databuffer for kurver (lagrer koordinater per horisontal piksel)
        this.bufferWidth = 0;
        this.pressureData = [];
        this.volumeData = [];
        this.flowData = [];

        // Skalaer (Min / Maks grenser)
        this.scales = {
            pawMax: 30,    // cmH2O
            pawMin: 0,
            volMax: 800,   // ml
            volMin: 0,
            flowMax: 60,   // L/min
            flowMin: -60   // L/min
        };

        this.initCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    initCanvas() {
        this.resizeCanvas();
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        
        const width = Math.floor(rect.width);
        const height = Math.max(380, Math.floor(rect.height));

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.logicalWidth = width;
        this.logicalHeight = height;

        // Nullstill databuffere til ny bredde
        this.bufferWidth = width;
        this.pressureData = new Array(width).fill(null);
        this.volumeData = new Array(width).fill(null);
        this.flowData = new Array(width).fill(null);
    }

    // Legg til nye dataprøver fra simulatoren og oppdater sweep
    addSample(dt, paw, volume, flow) {
        if (!this.logicalWidth) return;

        this.sweepTime += dt;
        if (this.sweepTime >= this.sweepDuration) {
            this.sweepTime = 0;
        }

        const prevX = this.sweepX;
        this.sweepX = (this.sweepTime / this.sweepDuration) * this.logicalWidth;
        const currentPx = Math.floor(this.sweepX);

        // Dynamisk skalering hvis trykket overstiger skalaen
        if (paw > this.scales.pawMax - 2) {
            this.scales.pawMax = Math.min(45, Math.ceil(paw / 5) * 5 + 5);
        }
        if (volume > this.scales.volMax - 50) {
            this.scales.volMax = Math.min(1500, Math.ceil(volume / 100) * 100 + 100);
        }

        // Fyll inn i buffer (håndter eventuelle hopp over flere piksler på høye framerates/lags)
        const startX = Math.floor(prevX);
        const endX = currentPx;

        if (endX >= startX) {
            for (let x = startX; x <= endX && x < this.logicalWidth; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
            }
        } else {
            // Skjerm vendt rundt (wrap-around)
            for (let x = startX; x < this.logicalWidth; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
            }
            for (let x = 0; x <= endX; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
            }
        }
    }

    // Hovedtegne-loop
    render() {
        const w = this.logicalWidth;
        const h = this.logicalHeight;
        if (!w || !h) return;

        const ctx = this.ctx;

        // 1. Tøm bakgrunn
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        // Tre spor (Tracks): Trykk øverst, Volum i midten, Flow nederst
        const trackHeight = h / 3;
        const tracks = [
            { id: 'paw', label: 'TRYKK (Paw)', unit: 'cmH₂O', color: this.colors.pressure, top: 0, height: trackHeight },
            { id: 'vol', label: 'TIDALVOLUM (V)', unit: 'ml', color: this.colors.volume, top: trackHeight, height: trackHeight },
            { id: 'flow', label: 'FLOW (V̇)', unit: 'L/min', color: this.colors.flow, top: trackHeight * 2, height: trackHeight }
        ];

        // 2. Tegn rutenett og seksjonsdelere
        this._drawGrid(ctx, w, h, tracks);

        // 3. Tegn kurvene for hvert spor
        this._drawPressureTrack(ctx, tracks[0], w);
        this._drawVolumeTrack(ctx, tracks[1], w);
        this._drawFlowTrack(ctx, tracks[2], w);

        // 4. Tegn Sweep Bar og Erase Zone
        this._drawSweepBar(ctx, w, h);
    }

    _drawGrid(ctx, w, h, tracks) {
        ctx.save();
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;

        // Vertikale rutenettlinjer (sekundlinjer)
        const numCols = 12;
        for (let c = 1; c < numCols; c++) {
            const x = Math.round((c / numCols) * w);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Spor-oppdeling og etiketter
        tracks.forEach((track, index) => {
            // Skillelinje mellom spor
            if (index > 0) {
                ctx.strokeStyle = this.colors.gridBold;
                ctx.beginPath();
                ctx.moveTo(0, track.top);
                ctx.lineTo(w, track.top);
                ctx.stroke();
            }

            // Horisontale subtile linjer i sporet
            ctx.strokeStyle = this.colors.grid;
            const midY = track.top + track.height / 2;
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(w, midY);
            ctx.stroke();

            // Etikett øverst i venstre hjørne av sporet
            ctx.fillStyle = track.color;
            ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
            ctx.fillText(`${track.label}`, 12, track.top + 18);

            ctx.fillStyle = this.colors.text;
            ctx.font = '500 10px monospace';
            ctx.fillText(`[${track.unit}]`, 12 + ctx.measureText(`${track.label} `).width, track.top + 18);
        });

        ctx.restore();
    }

    _drawPressureTrack(ctx, track, w) {
        const pPadding = 12;
        const bottomY = track.top + track.height - pPadding;
        const topY = track.top + 28;
        const usableH = bottomY - topY;

        // Skalaverdier
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${this.scales.pawMax}`, w - 10, topY + 4);
        ctx.fillText('0', w - 10, bottomY);

        // Tegn Paw-kurve
        const toY = (paw) => {
            const clamped = Math.max(this.scales.pawMin, Math.min(this.scales.pawMax, paw));
            const ratio = (clamped - this.scales.pawMin) / (this.scales.pawMax - this.scales.pawMin);
            return bottomY - ratio * usableH;
        };

        this._renderWaveform(ctx, this.pressureData, toY, this.colors.pressure, this.colors.pressureFill, bottomY);
    }

    _drawVolumeTrack(ctx, track, w) {
        const vPadding = 12;
        const bottomY = track.top + track.height - vPadding;
        const topY = track.top + 28;
        const usableH = bottomY - topY;

        // Skalaverdier
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${this.scales.volMax}`, w - 10, topY + 4);
        ctx.fillText('0', w - 10, bottomY);

        const toY = (vol) => {
            const clamped = Math.max(this.scales.volMin, Math.min(this.scales.volMax, vol));
            const ratio = (clamped - this.scales.volMin) / (this.scales.volMax - this.scales.volMin);
            return bottomY - ratio * usableH;
        };

        this._renderWaveform(ctx, this.volumeData, toY, this.colors.volume, this.colors.volumeFill, bottomY);
    }

    _drawFlowTrack(ctx, track, w) {
        const fPadding = 12;
        const zeroY = track.top + track.height / 2 + 6;
        const topY = track.top + 28;
        const bottomY = track.top + track.height - fPadding;
        const halfH = (bottomY - topY) / 2;

        // 0-linje
        ctx.save();
        ctx.strokeStyle = this.colors.zeroLine;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(w, zeroY);
        ctx.stroke();
        ctx.restore();

        // Skalaverdier
        ctx.fillStyle = this.colors.text;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`+${this.scales.flowMax}`, w - 10, topY + 4);
        ctx.fillText('0', w - 10, zeroY + 3);
        ctx.fillText(`${this.scales.flowMin}`, w - 10, bottomY);

        const toY = (flow) => {
            const clamped = Math.max(this.scales.flowMin, Math.min(this.scales.flowMax, flow));
            const ratio = clamped / this.scales.flowMax; // -1 til +1
            return zeroY - ratio * halfH;
        };

        this._renderWaveform(ctx, this.flowData, toY, this.colors.flow, this.colors.flowFill, zeroY);
    }

    _renderWaveform(ctx, data, toYFn, strokeColor, fillColor, baselineY) {
        const sweepX = this.sweepX;
        const w = this.logicalWidth;
        const eraseStart = sweepX;
        const eraseEnd = (sweepX + this.eraseWidth) % w;

        ctx.save();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = strokeColor;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Tegn to segmenter for å unngå strek over erase-sonen
        // Segment 1: fra (sweepX + eraseWidth) -> slutten av skjermen (eldre data)
        // Segment 2: fra 0 -> sweepX (nyeste data)

        const drawSegment = (fromX, toX) => {
            if (fromX >= toX) return;
            let drawing = false;

            ctx.beginPath();
            for (let x = fromX; x <= toX; x++) {
                const val = data[x];
                if (val !== null && val !== undefined) {
                    const y = toYFn(val);
                    if (!drawing) {
                        ctx.moveTo(x, y);
                        drawing = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                } else {
                    drawing = false;
                }
            }
            ctx.stroke();
        };

        if (eraseStart + this.eraseWidth < w) {
            // Normal tilstand
            drawSegment(0, Math.floor(sweepX));
            drawSegment(Math.floor(sweepX + this.eraseWidth), w - 1);
        } else {
            // Wrap-around tilstand
            drawSegment(Math.floor(eraseEnd), Math.floor(sweepX));
        }

        ctx.restore();
    }

    _drawSweepBar(ctx, w, h) {
        const sx = this.sweepX;

        ctx.save();
        
        // 1. Slett-sone foran sveipelinjen med gradient fade
        const gradient = ctx.createLinearGradient(sx, 0, sx + this.eraseWidth, 0);
        gradient.addColorStop(0, 'rgba(10, 14, 23, 0.95)');
        gradient.addColorStop(1, 'rgba(10, 14, 23, 0.0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(sx, 0, this.eraseWidth, h);

        // 2. Lysende Sweep-linje
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = this.colors.sweepBar;
        ctx.lineWidth = 1.8;

        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();

        ctx.restore();
    }
}

// Gjør tilgjengelig globalt
window.WaveformRenderer = WaveformRenderer;
