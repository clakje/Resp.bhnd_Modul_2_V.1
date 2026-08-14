/**
 * renderer.js - HTML5 Canvas 2D Medisinsk Ventilator Monitor (Hamilton-stil)
 * 
 * Egenskaper:
 * - Dynamisk Y-aksetilpasning for Paw, Flow og Volum: Skalering justeres automatisk
 *   både opp og ned etter synlige toppverdier, slik at kurvetoppen ALDRI kuttes bort.
 * - Tydelige forholdstall og Y-akser på VENSTRE side for alle 3 spor
 * - Paw (Trykk): Tydelig 0 cmH2O bunnlinje og PEEP-nivå [Gul/Orange]
 * - Flow (V̇ / Débit): Tydelig 0-linje i midten med arealvisning (+/-) [Hamilton Rosa/Magenta]
 * - Volum (V): Tydelig 0 ml grunnlinje og dynamisk fylling [Cyan]
 * - Sekundmarkører (5s intervaller / 1s grid på 15s sveip) og trigger-indikatorer (▲) ved pustestart
 * - Jevn 60 FPS Sweep-bar med gradient erase-sone
 */

class WaveformRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Fargepalett i tråd med medisinsk standard (Hamilton Medical / Servo-u)
        this.colors = {
            bg: '#080d1a',
            grid: '#131e33',
            gridSubtle: '#0f1728',
            gridTickLine: 'rgba(255, 255, 255, 0.045)', // Subtil referanselinje for Y-aksetikk
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
        this.sweepDuration = 15.0; // sekunder for ett helt sveip over skjermen (15 sekunder)
        this.sweepTime = 0;
        this.sweepX = 0;          // Relativ pikselposisjon (0..activeWidth)
        this.eraseWidth = 24;     // Piksler foran sveipelinjen

        // Databuffere
        this.bufferWidth = 0;
        this.pressureData = [];
        this.volumeData = [];
        this.flowData = [];
        this.flowTriggerData = []; // Lagrer flow-trigger status per pikselposisjon
        this.pawTriggerData = [];  // Lagrer trykk-trigger status per pikselposisjon (undertrykk)
        this.triggerData = [];     // Lagrer trigger-trekanter per pikselposisjon

        // Dynamiske skalaer (Min / Maks grenser)
        this.scales = {
            pawMax: 25,    // cmH2O
            pawMin: 0,
            volMax: 600,   // ml
            volMin: 0,
            flowMax: 40,   // L/min
            flowMin: -40   // L/min
        };

        // Standard kliniske skalanivåer for dynamisk tilpasning
        this.scaleTiers = {
            paw: [15, 20, 25, 30, 35, 40, 50, 60, 80, 100],
            flow: [20, 30, 40, 60, 80, 100, 120, 150, 200, 250, 300],
            vol: [300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000]
        };

        // Holdetid før skala trappes ned (unngår flimring/uro)
        this.scaleHold = {
            paw: 0,
            flow: 0,
            vol: 0
        };

        this.currentEpap = 5;

        this.initCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    initCanvas() {
        this.sweepTime = 0;
        this.sweepX = 0;
        this.scales.pawMax = 25;
        this.scales.volMax = 600;
        this.scales.flowMax = 40;
        this.scales.flowMin = -40;
        this.scaleHold.paw = 0;
        this.scaleHold.flow = 0;
        this.scaleHold.vol = 0;
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
        this.pawTriggerData = new Array(this.activeWidth).fill(false);
        this.triggerData = new Array(this.activeWidth).fill(false);
    }

    // Automatisk og kontinuerlig dynamisk Y-skalering for alle tre spor
    _updateDynamicScales(dt, currentPaw, currentVol, currentFlow) {
        if (!this.activeWidth || this.activeWidth <= 0) return;

        // Finn maksimumsverdier i synlig skjermbuffer + nåværende prøve
        let maxPaw = (currentPaw !== undefined && currentPaw !== null) ? currentPaw : 0;
        let maxFlow = (currentFlow !== undefined && currentFlow !== null) ? Math.abs(currentFlow) : 0;
        let maxVol = (currentVol !== undefined && currentVol !== null) ? currentVol : 0;

        for (let x = 0; x < this.activeWidth; x++) {
            const p = this.pressureData[x];
            if (p !== null && p !== undefined && p > maxPaw) maxPaw = p;

            const f = this.flowData[x];
            if (f !== null && f !== undefined) {
                const absF = Math.abs(f);
                if (absF > maxFlow) maxFlow = absF;
            }

            const v = this.volumeData[x];
            if (v !== null && v !== undefined && v > maxVol) maxVol = v;
        }

        // Beregn ønsket skalanivå med 15% headroom slik at kurvetoppen aldri berører taket eller kuttes
        const headroomRatio = 0.85;

        // 1. Paw (Trykk)
        const targetPaw = this._findTargetTier(maxPaw / headroomRatio, this.scaleTiers.paw, 15);
        if (targetPaw > this.scales.pawMax) {
            // Umiddelbar oppskalering for å unngå kutting
            this.scales.pawMax = targetPaw;
            this.scaleHold.paw = 0;
        } else if (targetPaw < this.scales.pawMax) {
            this.scaleHold.paw += dt;
            if (this.scaleHold.paw >= 1.5) { // Vent 1.5 sek etter at alle høye topper er ute av skjermen
                this.scales.pawMax = targetPaw;
                this.scaleHold.paw = 0;
            }
        } else {
            this.scaleHold.paw = 0;
        }

        // 2. Flow
        const targetFlow = this._findTargetTier(maxFlow / headroomRatio, this.scaleTiers.flow, 20);
        if (targetFlow > this.scales.flowMax) {
            this.scales.flowMax = targetFlow;
            this.scales.flowMin = -targetFlow;
            this.scaleHold.flow = 0;
        } else if (targetFlow < this.scales.flowMax) {
            this.scaleHold.flow += dt;
            if (this.scaleHold.flow >= 1.5) {
                this.scales.flowMax = targetFlow;
                this.scales.flowMin = -targetFlow;
                this.scaleHold.flow = 0;
            }
        } else {
            this.scaleHold.flow = 0;
        }

        // 3. Volum
        const targetVol = this._findTargetTier(maxVol / headroomRatio, this.scaleTiers.vol, 300);
        if (targetVol > this.scales.volMax) {
            this.scales.volMax = targetVol;
            this.scaleHold.vol = 0;
        } else if (targetVol < this.scales.volMax) {
            this.scaleHold.vol += dt;
            if (this.scaleHold.vol >= 1.5) {
                this.scales.volMax = targetVol;
                this.scaleHold.vol = 0;
            }
        } else {
            this.scaleHold.vol = 0;
        }
    }

    _findTargetTier(val, tiers, defaultMin) {
        for (let i = 0; i < tiers.length; i++) {
            if (tiers[i] >= val) {
                return tiers[i];
            }
        }
        // Dersom verdien overskrider definerte tiers, rund av pent oppover til nærmeste 10/100
        return Math.ceil(val / 10) * 10;
    }

    // Legg til nye dataprøver fra simulatoren og oppdater sweep
    addSample(dt, paw, volume, flow, isTriggered = false, epap = 5, isFlowTrigger = false, isPawTrigger = false) {
        if (!this.activeWidth || this.activeWidth <= 0) return;

        this.currentEpap = epap;
        this.sweepTime += dt;
        if (this.sweepTime >= this.sweepDuration) {
            this.sweepTime = 0;
        }

        const prevX = this.sweepX;
        this.sweepX = (this.sweepTime / this.sweepDuration) * this.activeWidth;
        const currentPx = Math.floor(this.sweepX);

        // Oppdater dynamiske Y-akser
        this._updateDynamicScales(dt, paw, volume, flow);

        // Fyll inn i buffer
        const startX = Math.floor(prevX);
        const endX = currentPx;

        if (endX >= startX) {
            for (let x = startX; x <= endX && x < this.activeWidth; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
                this.flowTriggerData[x] = isFlowTrigger;
                this.pawTriggerData[x] = isPawTrigger;
                this.triggerData[x] = (x === startX && isTriggered);
            }
        } else {
            // Skjerm vendt rundt (wrap-around)
            for (let x = startX; x < this.activeWidth; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
                this.flowTriggerData[x] = isFlowTrigger;
                this.pawTriggerData[x] = isPawTrigger;
                this.triggerData[x] = (x === startX && isTriggered);
            }
            for (let x = 0; x <= endX; x++) {
                this.pressureData[x] = paw;
                this.volumeData[x] = volume;
                this.flowData[x] = flow;
                this.flowTriggerData[x] = isFlowTrigger;
                this.pawTriggerData[x] = isPawTrigger;
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

        // 5. Tegn Y-akser, dynamiske skalaer og forholdstall på venstre side
        this._drawLeftYAxes(ctx, tracks, leftM, activeW);
    }

    _drawGridAndTimeAxis(ctx, w, h, tracks, leftM, activeW) {
        ctx.save();

        // Bakgrunnsrutenett (Sekundstreker)
        const seconds = this.sweepDuration;
        const labelInterval = (seconds > 12) ? 5 : 1; // Vis tekstetikett hvert 5. sekund for lange sveip (15s/25s), eller 1s for korte

        for (let s = 0; s <= seconds; s++) {
            const x = leftM + Math.round((s / seconds) * activeW);
            const isMajor = (s % labelInterval === 0);
            
            // Vertikal sekundlinje (litt tydeligere for hovedsekunder, subtilt for 1-sekunds grid)
            ctx.strokeStyle = isMajor ? this.colors.grid : this.colors.gridSubtle;
            ctx.lineWidth = isMajor ? 1 : 0.75;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            // Sekundtall langs aksen mellom Paw og Flow (som på Hamilton/Servo)
            if (s > 0 && s < seconds && isMajor) {
                ctx.fillStyle = this.colors.textDim;
                ctx.font = '500 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`${s}s`, x, tracks[1].top - 3);
            }
        }

        // Spor-oppdeling (Horisontale skillelinjer mellom de tre sporene)
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

    // Genererer pene, logiske og klinisk gjenkjennelige tikk-verdier for valgt skala
    _getTicksForScale(type, maxVal) {
        if (type === 'paw') {
            if (maxVal <= 15) return [15, 10, 5, 0];
            if (maxVal <= 20) return [20, 15, 10, 5, 0];
            if (maxVal <= 25) return [25, 20, 15, 10, 5, 0];
            if (maxVal <= 30) return [30, 20, 10, 0];
            if (maxVal <= 35) return [35, 25, 15, 5, 0];
            if (maxVal <= 40) return [40, 30, 20, 10, 0];
            if (maxVal <= 50) return [50, 40, 30, 20, 10, 0];
            if (maxVal <= 60) return [60, 40, 20, 0];
            if (maxVal <= 80) return [80, 60, 40, 20, 0];
            if (maxVal <= 100) return [100, 75, 50, 25, 0];
            return this._calculateTicks(0, maxVal, 4);
        } else if (type === 'flow') {
            const mid = Math.round(maxVal / 2);
            return [maxVal, mid, 0, -mid, -maxVal];
        } else if (type === 'vol') {
            if (maxVal <= 300) return [300, 200, 100, 0];
            if (maxVal <= 400) return [400, 300, 200, 100, 0];
            if (maxVal <= 500) return [500, 400, 300, 200, 100, 0];
            if (maxVal <= 600) return [600, 400, 200, 0];
            if (maxVal <= 800) return [800, 600, 400, 200, 0];
            if (maxVal <= 1000) return [1000, 750, 500, 250, 0];
            if (maxVal <= 1200) return [1200, 900, 600, 300, 0];
            if (maxVal <= 1500) return [1500, 1000, 500, 0];
            if (maxVal <= 2000) return [2000, 1500, 1000, 500, 0];
            if (maxVal <= 2500) return [2500, 2000, 1500, 1000, 500, 0];
            if (maxVal <= 3000) return [3000, 2000, 1000, 0];
            return this._calculateTicks(0, maxVal, 4);
        }
        return this._calculateTicks(0, maxVal, 4);
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

        const paddingBottom = 12;
        const paddingTop = 28;

        // 1. Paw Akse (Øverst)
        const pTrack = tracks[0];
        const pTopY = pTrack.top + paddingTop;
        const pBottomY = pTrack.top + pTrack.height - paddingBottom;
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
        const pawTicks = this._getTicksForScale('paw', this.scales.pawMax);
        pawTicks.forEach(val => {
            const ratio = val / this.scales.pawMax;
            const y = pBottomY - ratio * pUsableH;
            
            // Subtil horisontal referanselinje over kurvefeltet (som på Servo/Hamilton)
            if (val > 0 && val < this.scales.pawMax) {
                ctx.strokeStyle = this.colors.gridTickLine;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(leftM, y);
                ctx.lineTo(leftM + activeW, y);
                ctx.stroke();
            }

            // Tikk-merke
            ctx.strokeStyle = this.colors.axisLine;
            ctx.lineWidth = 1;
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
        const fTopY = fTrack.top + paddingTop;
        const fBottomY = fTrack.top + fTrack.height - paddingBottom;
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
        const flowTicks = this._getTicksForScale('flow', fMax);

        flowTicks.forEach(val => {
            const ratio = val / fMax; // -1 til +1
            const y = fZeroY - ratio * fHalfH;

            // Subtil referanselinje
            if (Math.abs(val) > 0 && Math.abs(val) < fMax) {
                ctx.strokeStyle = this.colors.gridTickLine;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(leftM, y);
                ctx.lineTo(leftM + activeW, y);
                ctx.stroke();
            }

            // Tikk-merke
            ctx.strokeStyle = (val === 0) ? this.colors.zeroLine : this.colors.axisLine;
            ctx.lineWidth = (val === 0) ? 1.5 : 1;
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
        const vTopY = vTrack.top + paddingTop;
        const vBottomY = vTrack.top + vTrack.height - paddingBottom;
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
        const volTicks = this._getTicksForScale('vol', this.scales.volMax);
        volTicks.forEach(val => {
            const ratio = val / this.scales.volMax;
            const y = vBottomY - ratio * vUsableH;

            // Subtil referanselinje
            if (val > 0 && val < this.scales.volMax) {
                ctx.strokeStyle = this.colors.gridTickLine;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(leftM, y);
                ctx.lineTo(leftM + activeW, y);
                ctx.stroke();
            }

            // Tikk-merke
            ctx.strokeStyle = this.colors.axisLine;
            ctx.lineWidth = 1;
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
        const paddingBottom = 12;
        const paddingTop = 28;
        const bottomY = track.top + track.height - paddingBottom;
        const topY = track.top + paddingTop;
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
            const epapRatio = this.currentEpap / this.scales.pawMax;
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

        // 3. Paw kurve med støtte for lilla trykk-trigger markering
        const toY = (paw) => {
            const clamped = Math.max(0, Math.min(this.scales.pawMax, paw));
            const ratio = clamped / this.scales.pawMax;
            return bottomY - ratio * usableH;
        };

        this._renderPressureWaveform(ctx, this.pressureData, this.pawTriggerData, toY, bottomY, leftM, activeW);

        // 4. Tegn Triggermarkører (▲) langs sekundlinjen ved pustestart
        this._renderTriggerMarks(ctx, track.top + track.height - 2, leftM);
    }

    _drawFlowTrack(ctx, track, leftM, activeW) {
        const paddingBottom = 12;
        const paddingTop = 28;
        const topY = track.top + paddingTop;
        const bottomY = track.top + track.height - paddingBottom;
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
        const paddingBottom = 12;
        const paddingTop = 28;
        const bottomY = track.top + track.height - paddingBottom;
        const topY = track.top + paddingTop;
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
            const clamped = Math.max(0, Math.min(this.scales.volMax, vol));
            const ratio = clamped / this.scales.volMax;
            return bottomY - ratio * usableH;
        };

        this._renderWaveform(ctx, this.volumeData, toY, this.colors.volume, this.colors.volumeFill, bottomY, leftM, activeW);
    }

    // Tegner Paw-kurve med støtte for lilla markering ved trykk-trigger (undertrykk under EPAP)
    _renderPressureWaveform(ctx, data, triggerData, toYFn, baselineY, leftM, activeW) {
        const sweepX = this.sweepX;
        const eraseEnd = (sweepX + this.eraseWidth) % activeW;

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const drawSegment = (fromX, toX) => {
            if (fromX >= toX) return;

            // 1. Gul/Amber fylling mot bunnlinjen
            ctx.save();
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
                ctx.fillStyle = this.colors.pressureFill;
                ctx.fill();
            }
            ctx.restore();

            // 2. Tegn Paw kurvelinje med fargeskifte til lilla ved trykk-trigger
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
                    ctx.strokeStyle = isTrig ? this.colors.flowTrigger : this.colors.pressure;
                    ctx.lineWidth = isTrig ? 2.6 : 2.2;
                    ctx.moveTo(screenX, screenY);
                    pathStarted = true;
                    currentIsTrig = isTrig;
                } else if (isTrig !== currentIsTrig) {
                    ctx.lineTo(screenX, screenY);
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.strokeStyle = isTrig ? this.colors.flowTrigger : this.colors.pressure;
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
