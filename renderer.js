/**
 * renderer.js - HTML5 Canvas 2D Medisinsk Ventilator Monitor (Hamilton-stil)
 * 
 * Egenskaper:
 * - Tydelige forholdstall og Y-akser på VENSTRE side for alle spor
 * - Paw (Trykk): Tydelig 0 cmH2O bunnlinje og PEEP-nivå [Gul/Orange]
 * - Flow (V̇ / Débit): Tydelig 0-linje i midten med arealvisning (+/-) [Hamilton Rosa/Magenta]
 * - Volum (V): Tydelig 0 ml grunnlinje og dynamisk fylling [Grønn]
 * - Sekundmarkører (1..6s) og trigger-indikatorer (▲) ved pustestart
 * - Jevn 60 FPS Sweep-bar med gradient erase-sone
 */

class WaveformRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Fargepalett i tråd med medisinsk standard (Hamilton Medical)
        this.colors = {
            bg: '#080d1a',
            grid: '#131e33',
            gridSubtle: '#0f1728',
            axisLine: '#2a3b5c',
            sweepBar: '#ffffff',
            
            // Kurvefarger
            pressure: '#fbbf24',       // Gul/Amber (Paw)
            pressureFill: 'rgba(251, 191, 36, 0.08)',
            
            flow: '#22c55e',           // Klinisk Grønn (Flow)
            flowTrigger: '#d946ef',    // Lilla / Magenta triggerfarge (Servo-standard)
            flowFillPos: 'rgba(34, 197, 94, 0.16)', // Innpust areal (over 0-linje)
            flowFillNeg: 'rgba(34, 197, 94, 0.10)', // Utpust areal (under 0-linje)
            flowFillTrigger: 'rgba(217, 70, 239, 0.20)', // Areal under lilla trigger
            
            volume: '#06b6d4',         // Cyan / Lys blå (Volum)
            volumeFill: 'rgba(6, 182, 212, 0.10)',
            
            zeroLine: 'rgba(255, 255, 255, 0.65)',   // Knivskarp 0-linje
            peepLine: 'rgba(251, 191, 36, 0.35)',   // PEEP/EPAP referanselinje
            
            text: '#8295b5',
            textDim: '#4f6485',
            textBright: '#ffffff',
            triggerMark: '#d946ef'     // Triggermarkør ▲
        };

        // Layout & Marger for kurvefeltet
        this.leftMargin = 64;   // Dedikert aksemarg på venstre side for forholdstall
        this.rightMargin = 16;  // Luft på høyre side
        
        // Sweep innstillinger
        this.sweepDuration = 6.0; // sekunder for ett helt sveip over skjermen
        this.sweepTime = 0;
        this.sweepX = 0;          // Relativ pikselposisjon (0..activeWidth)
        this.eraseWidth = 24;     // Piksler foran sveipelinjen

        // Databuffere
        this.bufferWidth = 0;
        this.pressureData = [];
        this.volumeData = [];
        this.flowData = [];
        this.flowTriggerData = []; // Lagrer triggerstatus per pikselposisjon på flowkurven
        this.triggerData = [];    // Lagrer trigger-trekanter per pikselposisjon

        // Skalaer (Min / Maks grenser)
        this.scales = {
            pawMax: 25,    // cmH2O
            pawMin: 0,
            volMax: 800,   // ml
            volMin: 0,
            flowMax: 60,   // L/min
            flowMin: -60   // L/min
        };

        this.currentEpap = 5;

        this.initCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    initCanvas() {
        this.sweepTime = 0;
        this.sweepX = 0;
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

        // Aktiv bredde for selve kurvefeltet (mellom venstre aksemarg og høyre kant)
        this.activeWidth = Math.max(100, width - this.leftMargin - this.rightMargin);
        this.bufferWidth = this.activeWidth;

        this.pressureData = new Array(this.activeWidth).fill(null);
        this.volumeData = new Array(this.activeWidth).fill(null);
        this.flowData = new Array(this.activeWidth).fill(null);
        this.flowTriggerData = new Array(this.activeWidth).fill(false);
        this.triggerData = new Array(this.activeWidth).fill(false);
    }

    // Legg til nye dataprøver fra simulatoren og oppdater sweep
    addSample(dt, paw, volume, flow, isTriggered = false, epap = 5, isTriggerPhase = false) {
        if (!this.activeWidth || this.activeWidth <= 0) return;

        this.currentEpap = epap;
        this.sweepTime += dt;
        if (this.sweepTime >= this.sweepDuration) {
            this.sweepTime = 0;
        }

        const prevX = this.sweepX;
        this.sweepX = (this.sweepTime / this.sweepDuration) * this.activeWidth;
        const currentPx = Math.floor(this.sweepX);

        // Dynamisk tilpasning av skalaer dersom verdiene overskrider
        if (paw > this.scales.pawMax - 2) {
            this.scales.pawMax = Math.min(50, Math.ceil(paw / 5) * 5 + 5);
        }
        if (volume > this.scales.volMax - 50) {
            this.scales.volMax = Math.min(1500, Math.ceil(volume / 100) * 100 + 100);
        }
        if (Math.abs(flow) > this.scales.flowMax - 5) {
            const newMax = Math.min(150, Math.ceil(Math.abs(flow) / 20) * 20 + 20);
            this.scales.flowMax = newMax;
            this.scales.flowMin = -newMax;
        }

        // Fyll inn i buffer
        const startX = Math.floor(prevX);
        const endX = currentPx;

        if (endX >= startX) {
            for (let x = startX; x <= endX && x < this.activeWidth; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
                this.flowTriggerData[x] = isTriggerPhase;
                this.triggerData[x] = (x === startX && isTriggered);
            }
        } else {
            // Skjerm vendt rundt (wrap-around)
            for (let x = startX; x < this.activeWidth; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
                this.flowTriggerData[x] = isTriggerPhase;
                this.triggerData[x] = (x === startX && isTriggered);
            }
            for (let x = 0; x <= endX; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
                this.flowTriggerData[x] = isTriggerPhase;
                this.triggerData[x] = (x === 0 && isTriggered);
            }
        }
    }

    // Hovedtegne-loop
    render() {
        const w = this.logicalWidth;
        const h = this.logicalHeight;
        if (!w || !h || !this.activeWidth) return;

        const ctx = this.ctx;
        const leftM = this.leftMargin;
        const activeW = this.activeWidth;

        // 1. Tøm bakgrunn
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        // Tre like store spor (Tracks): Paw øverst, Flow i midten, Volum nederst
        const trackHeight = h / 3;
        const tracks = [
            { id: 'paw', label: 'Paw', unit: 'cmH₂O', color: this.colors.pressure, top: 0, height: trackHeight },
            { id: 'flow', label: 'Flow', unit: 'L/min', color: this.colors.flow, top: trackHeight, height: trackHeight },
            { id: 'vol', label: 'V', unit: 'ml', color: this.colors.volume, top: trackHeight * 2, height: trackHeight }
        ];

        // 2. Rutenett, sekundmarkører og tidsakse
        this._drawGridAndTimeAxis(ctx, w, h, tracks, leftM, activeW);

        // 3. Tegn kurvene, bunnlinjer, 0-linjer og arealvisning for hvert spor
        this._drawPressureTrack(ctx, tracks[0], leftM, activeW);
        this._drawFlowTrack(ctx, tracks[1], leftM, activeW);
        this._drawVolumeTrack(ctx, tracks[2], leftM, activeW);

        // 4. Tegn Sweep Bar og Erase Zone
        this._drawSweepBar(ctx, h, leftM, activeW);

        // 5. Tegn Y-akser og forholdstall på venstre side
        this._drawLeftYAxes(ctx, tracks, leftM, activeW);
    }

    _drawGridAndTimeAxis(ctx, w, h, tracks, leftM, activeW) {
        ctx.save();

        // Bakgrunnsrutenett (Sekundstreker)
        const seconds = this.sweepDuration;
        for (let s = 0; s <= seconds; s++) {
            const x = leftM + Math.round((s / seconds) * activeW);
            
            // Vertikal sekundlinje
            ctx.strokeStyle = this.colors.grid;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            // Sekundtall langs aksen mellom Paw og Flow (som på Hamilton)
            if (s > 0 && s < seconds) {
                ctx.fillStyle = this.colors.textDim;
                ctx.font = '500 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`${s}s`, x, tracks[1].top - 3);
            }
        }

        // Spor-oppdeling (Horisontale skillelinjer)
        tracks.forEach((track, index) => {
            if (index > 0) {
                ctx.strokeStyle = this.colors.axisLine;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(leftM - 6, track.top);
                ctx.lineTo(leftM + activeW, track.top);
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    _drawLeftYAxes(ctx, tracks, leftM, activeW) {
        ctx.save();

        // Vertikal Y-akselinje ved start av kurvefeltet
        ctx.strokeStyle = this.colors.axisLine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(leftM, 0);
        ctx.lineTo(leftM, this.logicalHeight);
        ctx.stroke();

        // 1. Paw Akse (Øverst)
        const pTrack = tracks[0];
        const pPadding = 12;
        const pTopY = pTrack.top + 34;
        const pBottomY = pTrack.top + pTrack.height - pPadding;
        const pUsableH = pBottomY - pTopY;

        // Tittel & Enhet øverst til venstre
        ctx.fillStyle = pTrack.color;
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Paw', 8, pTrack.top + 14);
        ctx.fillStyle = this.colors.text;
        ctx.font = '500 10px monospace';
        ctx.fillText('cmH₂O', 8, pTrack.top + 26);

        // Skalaverdier (forholdstall) for Paw
        const pawTicks = this._calculateTicks(0, this.scales.pawMax, 4);
        pawTicks.forEach(val => {
            const ratio = (val - this.scales.pawMin) / (this.scales.pawMax - this.scales.pawMin);
            const y = pBottomY - ratio * pUsableH;
            
            // Tikk-merke
            ctx.strokeStyle = this.colors.axisLine;
            ctx.beginPath();
            ctx.moveTo(leftM - 5, y);
            ctx.lineTo(leftM, y);
            ctx.stroke();

            // Tall
            ctx.fillStyle = (val === 0) ? this.colors.textBright : this.colors.text;
            ctx.font = (val === 0) ? 'bold 11px monospace' : '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${val}`, leftM - 8, y + 3.5);
        });

        // 2. Flow Akse (I midten)
        const fTrack = tracks[1];
        const fPadding = 12;
        const fTopY = fTrack.top + 34;
        const fBottomY = fTrack.top + fTrack.height - fPadding;
        const fZeroY = fTopY + (fBottomY - fTopY) / 2;
        const fHalfH = (fBottomY - fTopY) / 2;

        // Tittel & Enhet
        ctx.fillStyle = fTrack.color;
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Flow', 8, fTrack.top + 14);
        ctx.fillStyle = this.colors.text;
        ctx.font = '500 10px monospace';
        ctx.fillText('L/min', 8, fTrack.top + 26);

        // Skalaverdier for Flow (+Max, +Mid, 0, -Mid, -Max)
        const fMax = this.scales.flowMax;
        const fMid = Math.round(fMax / 2);
        const flowTicks = [fMax, fMid, 0, -fMid, -fMax];

        flowTicks.forEach(val => {
            const ratio = val / fMax; // -1 til +1
            const y = fZeroY - ratio * fHalfH;

            // Tikk-merke
            ctx.strokeStyle = (val === 0) ? this.colors.zeroLine : this.colors.axisLine;
            ctx.beginPath();
            ctx.moveTo(leftM - 6, y);
            ctx.lineTo(leftM, y);
            ctx.stroke();

            // Tall
            ctx.fillStyle = (val === 0) ? this.colors.textBright : this.colors.text;
            ctx.font = (val === 0) ? 'bold 11px monospace' : '10px monospace';
            ctx.textAlign = 'right';
            const prefix = (val > 0) ? '+' : '';
            ctx.fillText(`${prefix}${val}`, leftM - 8, y + 3.5);
        });

        // 3. Volum Akse (Nederst)
        const vTrack = tracks[2];
        const vPadding = 12;
        const vTopY = vTrack.top + 34;
        const vBottomY = vTrack.top + vTrack.height - vPadding;
        const vUsableH = vBottomY - vTopY;

        // Tittel & Enhet
        ctx.fillStyle = vTrack.color;
        ctx.font = 'bold 13px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('V', 8, vTrack.top + 14);
        ctx.fillStyle = this.colors.text;
        ctx.font = '500 10px monospace';
        ctx.fillText('ml', 8, vTrack.top + 26);

        // Skalaverdier for Volum
        const volTicks = this._calculateTicks(0, this.scales.volMax, 4);
        volTicks.forEach(val => {
            const ratio = (val - this.scales.volMin) / (this.scales.volMax - this.scales.volMin);
            const y = vBottomY - ratio * vUsableH;

            // Tikk-merke
            ctx.strokeStyle = this.colors.axisLine;
            ctx.beginPath();
            ctx.moveTo(leftM - 5, y);
            ctx.lineTo(leftM, y);
            ctx.stroke();

            // Tall
            ctx.fillStyle = (val === 0) ? this.colors.textBright : this.colors.text;
            ctx.font = (val === 0) ? 'bold 11px monospace' : '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(`${val}`, leftM - 8, y + 3.5);
        });

        ctx.restore();
    }

    _drawPressureTrack(ctx, track, leftM, activeW) {
        const pPadding = 12;
        const bottomY = track.top + track.height - pPadding;
        const topY = track.top + 34;
        const usableH = bottomY - topY;
        const rightEdge = leftM + activeW;

        // 1. Tydelig bunnlinje (0 cmH2O)
        ctx.save();
        ctx.strokeStyle = this.colors.zeroLine;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(leftM, bottomY);
        ctx.lineTo(rightEdge, bottomY);
        ctx.stroke();

        // 2. PEEP / EPAP referanselinje (subtil stiplet linje som viser grunntrykket)
        if (this.currentEpap > 0) {
            const epapRatio = (this.currentEpap - this.scales.pawMin) / (this.scales.pawMax - this.scales.pawMin);
            const epapY = bottomY - epapRatio * usableH;
            ctx.strokeStyle = this.colors.peepLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(leftM, epapY);
            ctx.lineTo(rightEdge, epapY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();

        // 3. Paw kurve
        const toY = (paw) => {
            const clamped = Math.max(this.scales.pawMin, Math.min(this.scales.pawMax, paw));
            const ratio = (clamped - this.scales.pawMin) / (this.scales.pawMax - this.scales.pawMin);
            return bottomY - ratio * usableH;
        };

        this._renderWaveform(ctx, this.pressureData, toY, this.colors.pressure, this.colors.pressureFill, bottomY, leftM, activeW);

        // 4. Tegn Triggermarkører (▲) langs sekundlinjen ved pustestart
        this._renderTriggerMarks(ctx, track.top + track.height - 2, leftM);
    }

    _drawFlowTrack(ctx, track, leftM, activeW) {
        const fPadding = 12;
        const topY = track.top + 34;
        const bottomY = track.top + track.height - fPadding;
        const zeroY = topY + (bottomY - topY) / 2;
        const halfH = (bottomY - topY) / 2;
        const rightEdge = leftM + activeW;

        // Tydelig, markant og forsterket 0-linje for Flow (skille mellom innpust og utpust)
        ctx.save();
        ctx.strokeStyle = this.colors.zeroLine;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(leftM, zeroY);
        ctx.lineTo(rightEdge, zeroY);
        ctx.stroke();
        ctx.restore();

        const toY = (flow) => {
            const clamped = Math.max(this.scales.flowMin, Math.min(this.scales.flowMax, flow));
            const ratio = clamped / this.scales.flowMax; // -1 til +1
            return zeroY - ratio * halfH;
        };

        // Tegn Flow-kurven med areal-fylling og lilla trigger-markering
        this._renderFlowWaveformWithArea(ctx, this.flowData, this.flowTriggerData, toY, zeroY, leftM, activeW);
    }

    _drawVolumeTrack(ctx, track, leftM, activeW) {
        const vPadding = 12;
        const bottomY = track.top + track.height - vPadding;
        const topY = track.top + 32;
        const usableH = bottomY - topY;
        const rightEdge = leftM + activeW;

        // Tydelig bunnlinje (0 ml)
        ctx.save();
        ctx.strokeStyle = this.colors.zeroLine;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(leftM, bottomY);
        ctx.lineTo(rightEdge, bottomY);
        ctx.stroke();
        ctx.restore();

        const toY = (vol) => {
            const clamped = Math.max(this.scales.volMin, Math.min(this.scales.volMax, vol));
            const ratio = (clamped - this.scales.volMin) / (this.scales.volMax - this.scales.volMin);
            return bottomY - ratio * usableH;
        };

        this._renderWaveform(ctx, this.volumeData, toY, this.colors.volume, this.colors.volumeFill, bottomY, leftM, activeW);
    }

    // Tegner standard kurve (Paw eller Volum) med ren linje og valgfri subtil fylling
    _renderWaveform(ctx, data, toYFn, strokeColor, fillColor, baselineY, leftM, activeW) {
        const sweepX = this.sweepX;
        const eraseStart = sweepX;
        const eraseEnd = (sweepX + this.eraseWidth) % activeW;

        ctx.save();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = strokeColor;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const drawSegment = (fromX, toX) => {
            if (fromX >= toX) return;
            let drawing = false;

            // Tegn kurvelinje
            ctx.beginPath();
            for (let x = fromX; x <= toX; x++) {
                const val = data[x];
                if (val !== null && val !== undefined) {
                    const screenX = leftM + x;
                    const screenY = toYFn(val);
                    if (!drawing) {
                        ctx.moveTo(screenX, screenY);
                        drawing = true;
                    } else {
                        ctx.lineTo(screenX, screenY);
                    }
                } else {
                    drawing = false;
                }
            }
            ctx.stroke();

            // Tegn subtil fylling mot grunnlinjen
            if (fillColor && drawing) {
                ctx.save();
                ctx.fillStyle = fillColor;
                ctx.beginPath();
                let started = false;
                for (let x = fromX; x <= toX; x++) {
                    const val = data[x];
                    if (val !== null && val !== undefined) {
                        const screenX = leftM + x;
                        const screenY = toYFn(val);
                        if (!started) {
                            ctx.moveTo(screenX, baselineY);
                            ctx.lineTo(screenX, screenY);
                            started = true;
                        } else {
                            ctx.lineTo(screenX, screenY);
                        }
                    }
                }
                if (started) {
                    ctx.lineTo(leftM + toX, baselineY);
                    ctx.closePath();
                    ctx.fill();
                }
                ctx.restore();
            }
        };

        if (eraseStart + this.eraseWidth < activeW) {
            drawSegment(0, Math.floor(sweepX));
            drawSegment(Math.floor(sweepX + this.eraseWidth), activeW - 1);
        } else {
            drawSegment(Math.floor(eraseEnd), Math.floor(sweepX));
        }

        ctx.restore();
    }

    // Tegner Flow-kurve med distinkt areal-fylling over og under 0-linjen og lilla trigger-markering
    _renderFlowWaveformWithArea(ctx, data, triggerData, toYFn, zeroY, leftM, activeW) {
        const sweepX = this.sweepX;
        const eraseEnd = (sweepX + this.eraseWidth) % activeW;

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const drawSegment = (fromX, toX) => {
            if (fromX >= toX) return;

            // 1. Tegn areal-fylling (Inspirasjon over 0-linje og Ekspirasjon under 0-linje)
            for (let x = fromX; x <= toX; x++) {
                const val = data[x];
                if (val !== null && val !== undefined && Math.abs(val) > 0.5) {
                    const screenX = leftM + x;
                    const screenY = toYFn(val);
                    const isTrig = !!triggerData[x];

                    if (val > 0) {
                        ctx.fillStyle = isTrig ? this.colors.flowFillTrigger : this.colors.flowFillPos;
                    } else {
                        ctx.fillStyle = this.colors.flowFillNeg;
                    }
                    ctx.fillRect(screenX, Math.min(zeroY, screenY), 1.2, Math.abs(screenY - zeroY));
                }
            }

            // 2. Tegn selve kurvelinjen med fargeskifte til lilla under triggerfasen
            let currentIsTrig = null;
            let pathStarted = false;

            for (let x = fromX; x <= toX; x++) {
                const val = data[x];
                if (val === null || val === undefined) {
                    if (pathStarted) {
                        ctx.stroke();
                        pathStarted = false;
                        currentIsTrig = null;
                    }
                    continue;
                }

                const isTrig = !!triggerData[x];
                const screenX = leftM + x;
                const screenY = toYFn(val);

                if (!pathStarted) {
                    ctx.beginPath();
                    ctx.strokeStyle = isTrig ? this.colors.flowTrigger : this.colors.flow;
                    ctx.lineWidth = isTrig ? 2.6 : 2.2;
                    ctx.moveTo(screenX, screenY);
                    pathStarted = true;
                    currentIsTrig = isTrig;
                } else if (isTrig !== currentIsTrig) {
                    // Sømløs overgang: trekk nåværende fargelinje helt fram til dette punktet
                    ctx.lineTo(screenX, screenY);
                    ctx.stroke();

                    // Start ny linje med ny farge fra nøyaktig samme punkt
                    ctx.beginPath();
                    ctx.strokeStyle = isTrig ? this.colors.flowTrigger : this.colors.flow;
                    ctx.lineWidth = isTrig ? 2.6 : 2.2;
                    ctx.moveTo(screenX, screenY);
                    currentIsTrig = isTrig;
                } else {
                    ctx.lineTo(screenX, screenY);
                }
            }
            if (pathStarted) {
                ctx.stroke();
            }
        };

        if (sweepX + this.eraseWidth < activeW) {
            drawSegment(0, Math.floor(sweepX));
            drawSegment(Math.floor(sweepX + this.eraseWidth), activeW - 1);
        } else {
            drawSegment(Math.floor(eraseEnd), Math.floor(sweepX));
        }

        ctx.restore();
    }

    // Tegner små Hamilton-stil triggermarkører (▲) ved pustestart
    _renderTriggerMarks(ctx, yPos, leftM) {
        ctx.save();
        ctx.fillStyle = this.colors.triggerMark;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';

        for (let x = 0; x < this.activeWidth; x++) {
            if (this.triggerData[x]) {
                const screenX = leftM + x;
                ctx.fillText('▲', screenX, yPos);
            }
        }
        ctx.restore();
    }

    // Tegner Sweep Bar med glidende slettesone
    _drawSweepBar(ctx, h, leftM, activeW) {
        const sx = leftM + this.sweepX;

        ctx.save();
        
        // 1. Slett-sone foran sveipelinjen
        const gradient = ctx.createLinearGradient(sx, 0, sx + this.eraseWidth, 0);
        gradient.addColorStop(0, 'rgba(8, 13, 26, 0.98)');
        gradient.addColorStop(1, 'rgba(8, 13, 26, 0.0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(sx, 0, Math.min(this.eraseWidth, (leftM + activeW) - sx), h);

        // 2. Lysende Sweep-linje
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 5;
        ctx.strokeStyle = this.colors.sweepBar;
        ctx.lineWidth = 1.8;

        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();

        ctx.restore();
    }

    // Hjelpefunksjon for å generere pene aksetall
    _calculateTicks(min, max, targetCount) {
        const step = Math.ceil((max - min) / targetCount / 5) * 5 || 5;
        const ticks = [];
        for (let v = max; v >= min; v -= step) {
            ticks.push(v);
        }
        if (ticks[ticks.length - 1] !== min) {
            ticks.push(min);
        }
        return ticks;
    }
}

// Gjør tilgjengelig globalt
window.WaveformRenderer = WaveformRenderer;
