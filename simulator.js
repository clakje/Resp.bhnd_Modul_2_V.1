/**
 * simulator.js - Fysikkmotor for NIV Ventilatorsimulator
 * 
 * Løser bevegelsesligningen for lungemekanikk i sanntid:
 * Paw(t) + Pmus(t) = V(t) / C + Flow(t) * R
 */

class VentilatorSimulator {
    constructor() {
        // Respiratorinnstillinger
        this.settings = {
            ipap: 14,             // cmH2O (Inspiratory Positive Airway Pressure)
            epap: 5,              // cmH2O (Expiratory Positive Airway Pressure / PEEP)
            rr: 15,               // pust/minutt (Respirasjonsfrekvens)
            fio2: 30,             // % Oksygenfraksjon
            riseTime: 0.15,       // sekunder (Tid for å nå IPAP)
            cyclingPercent: 0.25, // 25% av toppflow avslutter innpust (E-Sense)
            leak: 0,              // L/min (Maskelekkasje)
            triggerType: 'flow',  // 'flow' eller 'pressure'
            triggerFlow: 3.0,     // L/min (Innstilt flow-trigger, standard 3 L/min)
            triggerPressure: -2.0 // cmH2O (Innstilt trykk-trigger, standard -2 cmH2O)
        };

        // Pasientfysiologi
        this.patient = {
            compliance: 50,       // ml / cmH2O (Lungenettverkets ettergivelighet)
            resistance: 5,        // cmH2O / (L/s) (Luftveismotstand)
            pmusMax: 2.5,         // cmH2O (Pasientens egen inspiratoriske muskelinnsats)
            preset: 'normal'      // 'normal', 'copd', 'restrictive', 'custom'
        };

        // Simulatortilstand
        this.state = {
            phase: 'expiration',   // 'inspiration', 'expiration', eller 'triggering'
            timeInPhase: 0,        // sekunder i gjeldende fase
            totalTime: 0,          // total simuleringstid
            paw: 5.0,              // cmH2O
            volume: 0,             // ml (relativt til FRC / EPAP-balanse)
            flow: 0,               // L/min
            pmus: 0,               // cmH2O
            peakFlowInPhase: 0,    // L/min (brukes til flow-cycling)
            breathStartTime: 0,
            justTriggered: false,
            isFlowTrigger: false,  // True under pasientens flow-trigger innsats
            isPawTrigger: false,   // True under pasientens trykk-trigger undertrykk
            
            // Kontinuerlige monitor-målinger
            measured: {
                vt: 450,           // ml
                mv: 6.75,          // L/min
                ppeak: 14.0,       // cmH2O
                rrTotal: 15,       // pust/min
                ti: 1.1,           // sekunder (faktisk inspirasjonstid)
                te: 2.9,           // sekunder (faktisk ekspirasjonstid)
                leak: 0            // L/min
            }
        };

        // Historikk for beregning av minuttvolum og snitt
        this.recentBreaths = [];
        this.isRunning = true;
        this.subSteps = 10; // Numerisk substeps per frame for høy stabilitet
    }

    // Sett klinisk pasientprofil (Preset)
    setPreset(presetName) {
        if (presetName === 'normal') {
            this.patient.compliance = 50;
            this.patient.resistance = 5;
            this.patient.pmusMax = 2.5;
            this.patient.preset = 'normal';
        } else if (presetName === 'copd') {
            // KOLS / Obstruktiv: Høy motstand, normal/høy compliance, lang utpust
            this.patient.compliance = 70;
            this.patient.resistance = 18;
            this.patient.pmusMax = 3.0;
            this.patient.preset = 'copd';
        } else if (presetName === 'restrictive') {
            // Pneumoni / Lungeødem / ARDS: Svært stiv lunge, lav compliance
            this.patient.compliance = 22;
            this.patient.resistance = 5;
            this.patient.pmusMax = 3.5;
            this.patient.preset = 'restrictive';
        } else {
            this.patient.preset = 'custom';
        }
    }

    // Oppdatering per frame (dt i sekunder, f.eks. 1/60s)
    step(dt) {
        if (!this.isRunning) return;

        const subDt = dt / this.subSteps;
        for (let s = 0; s < this.subSteps; s++) {
            this._singleStep(subDt);
        }
    }

    _singleStep(dt) {
        this.state.totalTime += dt;
        this.state.timeInPhase += dt;

        const cycleTime = 60 / Math.max(5, this.settings.rr);
        const C_L = this.patient.compliance / 1000; // Omregnet til L / cmH2O
        const R = this.patient.resistance;          // cmH2O / (L/s)
        const V_L = this.state.volume / 1000;       // Volum i Liter

        // Pasienten initierer et innpust når syklustiden for forrige pust er passert
        const timeSinceBreathStart = this.state.totalTime - this.state.breathStartTime;
        if (this.state.phase === 'expiration' && timeSinceBreathStart >= cycleTime) {
            this.state.phase = 'triggering';
            this.state.timeInPhase = 0;
        }

        if (this.state.phase === 'triggering') {
            // Pasientens inspiratoriske muskelinnsats (Pmus)
            // Naturlig innsatsprofil over ca. 350 ms
            const effortDuration = 0.35;
            const effortProgress = Math.min(1.0, this.state.timeInPhase / effortDuration);
            const currentPmus = this.patient.pmusMax * Math.sin(Math.PI * effortProgress);
            this.state.pmus = currentPmus;

            if (this.settings.triggerType === 'flow') {
                // FLOW-TRIGGER:
                // Pasienten trekker inn luft med flow = Pmus / R
                const flow_L_s = currentPmus / R;
                const flow_L_min = flow_L_s * 60;

                this.state.flow = flow_L_min;
                this.state.paw = this.settings.epap;
                this.state.isFlowTrigger = true;
                this.state.isPawTrigger = false;

                // Trigges når pasientens flow oppnår innstilt flow-terskel (f.eks. 3 L/min)
                if (flow_L_min >= this.settings.triggerFlow) {
                    this._startInspiration();
                } else if (this.state.timeInPhase >= effortDuration) {
                    // Pasientens innsats var utilstrekkelig (uutløst trigger / missed effort)
                    this.state.phase = 'expiration';
                    this.state.timeInPhase = 0;
                    this.state.breathStartTime = this.state.totalTime;
                    this.state.pmus = 0;
                    this.state.flow = 0;
                    this.state.isFlowTrigger = false;
                    this.state.isPawTrigger = false;
                }
            } else {
                // TRYKK-TRIGGER:
                // Pasienten genererer et negativt undertrykk (deltaP = -Pmus) under EPAP/PEEP
                const deltaP = -currentPmus;
                const targetPaw = Math.max(0, this.settings.epap + deltaP);

                this.state.paw = targetPaw;
                this.state.flow = 0;
                this.state.isFlowTrigger = false;
                this.state.isPawTrigger = true;

                // Trigges når innstilt undertrykk (f.eks. -2 cmH2O under EPAP) oppnås
                // deltaP er negativ (f.eks. -2.5) og triggerPressure er negativ (f.eks. -2.0)
                if (deltaP <= this.settings.triggerPressure) {
                    this._startInspiration();
                } else if (this.state.timeInPhase >= effortDuration) {
                    // Pasientens undertrykk var utilstrekkelig (uutløst trykk-trigger / missed effort)
                    this.state.phase = 'expiration';
                    this.state.timeInPhase = 0;
                    this.state.breathStartTime = this.state.totalTime;
                    this.state.pmus = 0;
                    this.state.paw = this.settings.epap;
                    this.state.isFlowTrigger = false;
                    this.state.isPawTrigger = false;
                }
            }

        } else if (this.state.phase === 'inspiration') {
            this.state.isFlowTrigger = false;
            this.state.isPawTrigger = false;

            // --- INSPIRASJONSFASEN (Maskinstøtte levert til pasient) ---
            // 1. Trykkstigning mot IPAP (S-kurve basert på riseTime)
            const riseProgress = Math.min(1.0, this.state.timeInPhase / Math.max(0.05, this.settings.riseTime));
            const smoothRise = 0.5 * (1 - Math.cos(Math.PI * riseProgress));
            const targetPaw = this.settings.epap + (this.settings.ipap - this.settings.epap) * smoothRise;
            this.state.paw = targetPaw;

            // 2. Pasientens muskelinnsats under resten av innpustet
            const pmusDuration = Math.min(0.6, cycleTime * 0.25);
            if (this.state.timeInPhase < pmusDuration) {
                const pmusProgress = this.state.timeInPhase / pmusDuration;
                this.state.pmus = this.patient.pmusMax * Math.sin(Math.PI * pmusProgress);
            } else {
                this.state.pmus = 0;
            }

            // 3. Drivende trykk over lungemekanikken:
            // DeltaP = (Paw - EPAP) + Pmus - (V / C)
            // Flow (L/s) = DeltaP / R
            const deltaP = (this.state.paw - this.settings.epap) + this.state.pmus - (V_L / C_L);
            const flow_L_s = deltaP / R;
            
            // Konverter til L/min for klinisk visning
            let flow_L_min = flow_L_s * 60;
            
            // Maskelekkasje-komponent
            flow_L_min += (this.settings.leak * (this.state.paw / Math.max(1, this.settings.ipap)));
            this.state.flow = flow_L_min;

            // Integrer volum: dV = flow_L_s * dt (i liter -> ml)
            const dV_ml = (flow_L_s * dt) * 1000;
            this.state.volume = Math.max(0, this.state.volume + dV_ml);

            // Spor toppflow for inspiratorisk avslutning (cycling)
            if (this.state.flow > this.state.peakFlowInPhase) {
                this.state.peakFlowInPhase = this.state.flow;
            }

            // 4. Inspiratorisk avslutning (Cycling):
            // Avslutter innpust når flow faller under definert prosent av toppflow (f.eks. 25%)
            const cyclingThreshold = this.state.peakFlowInPhase * this.settings.cyclingPercent;
            const minInspirationTime = 0.20; // sekunder (for å unngå umiddelbar cycling under stigetid)
            const maxInspirationTime = Math.min(3.0, cycleTime * 0.65); // Sikkerhets-backup Ti,max

            if (this.state.timeInPhase > minInspirationTime) {
                if (this.state.flow <= cyclingThreshold || this.state.timeInPhase >= maxInspirationTime) {
                    this._startExpiration();
                }
            }

        } else {
            // --- EKSPIRASJONSFASEN ---
            this.state.isFlowTrigger = false;
            this.state.isPawTrigger = false;

            // 1. Trykk faller raskt tilbake til EPAP
            const dropProgress = Math.min(1.0, this.state.timeInPhase / 0.12);
            this.state.paw = this.settings.ipap - (this.settings.ipap - this.settings.epap) * dropProgress;
            this.state.pmus = 0;

            // 2. Passiv ekspirasjon drevet av lungeelastisitet (V/C) mot EPAP
            const elasticRecoil = V_L / C_L;
            const flow_L_s = - (elasticRecoil / R);
            let flow_L_min = flow_L_s * 60;
            this.state.flow = flow_L_min;

            // Volum tømmes passivt mot 0 (FRC)
            const dV_ml = (flow_L_s * dt) * 1000;
            this.state.volume = Math.max(0, this.state.volume + dV_ml);
        }
    }

    _startInspiration() {
        this.state.phase = 'inspiration';
        this.state.timeInPhase = 0;
        this.state.breathStartTime = this.state.totalTime;
        this.state.peakFlowInPhase = 0;
        this.state.volume = 0; // Nullstill tidalvolum for dette innpustet
        this.state.justTriggered = true; // Flagg for triggerindikator (▲) på monitoren
        this.state.isFlowTrigger = false;
        this.state.isPawTrigger = false;
    }

    _startExpiration() {
        this.state.phase = 'expiration';
        this.state.isFlowTrigger = false;
        this.state.isPawTrigger = false;
        const ti = this.state.timeInPhase;
        this.state.timeInPhase = 0;

        // Registrer målte verdier for avsluttet innpust
        const measuredVt = Math.round(this.state.volume);
        const measuredPpeak = parseFloat(this.state.paw.toFixed(1));
        
        this.state.measured.vt = measuredVt;
        this.state.measured.ppeak = measuredPpeak;
        this.state.measured.ti = parseFloat(ti.toFixed(2));
        
        // Beregn rullerende minuttvolum (MV)
        const currentRR = this.settings.rr;
        this.state.measured.rrTotal = currentRR;
        this.state.measured.mv = parseFloat(((measuredVt * currentRR) / 1000).toFixed(2));
        this.state.measured.te = parseFloat(((60 / currentRR) - ti).toFixed(2));

        // Lagre i historikk
        this.recentBreaths.push({
            time: this.state.totalTime,
            vt: measuredVt,
            ppeak: measuredPpeak,
            ti: ti
        });
        if (this.recentBreaths.length > 10) {
            this.recentBreaths.shift();
        }
    }

    // Hent pedagogisk analyse, tidskonstant og trigger-samkjøring
    getPhysiologicalInsights() {
        const C = this.patient.compliance;
        const R = this.patient.resistance;
        const tau = (C * R) / 1000; // Tidskonstant i sekunder: Tau = C * R
        const drivingPressure = this.settings.ipap - this.settings.epap;
        const theoreticalVt = Math.round(C * drivingPressure);
        const timeFor95Expiration = (3 * tau).toFixed(2); // 3 * Tau gir 95% tømming

        // Trigger-evaluering og samkjøring
        let isTriggerable = true;
        let triggerMargin = 0;
        let triggerType = this.settings.triggerType;
        let triggerRequired = 0;
        let patientGenerated = 0;

        if (triggerType === 'pressure') {
            triggerRequired = Math.abs(this.settings.triggerPressure);
            patientGenerated = this.patient.pmusMax;
            triggerMargin = parseFloat((patientGenerated - triggerRequired).toFixed(1));
            isTriggerable = patientGenerated >= triggerRequired;
        } else {
            triggerRequired = this.settings.triggerFlow;
            patientGenerated = parseFloat(((this.patient.pmusMax / R) * 60).toFixed(1));
            triggerMargin = parseFloat((patientGenerated - triggerRequired).toFixed(1));
            isTriggerable = patientGenerated >= triggerRequired;
        }

        let triggerNote = "";
        if (!isTriggerable) {
            if (triggerType === 'pressure') {
                triggerNote = `<div style="margin-top:6px; color:#f87171;">⚠️ <strong>Pasient-ventilator asynkroni (Uutløst trigger):</strong> Innstilt trykk-trigger krever et undertrykk på <strong>${triggerRequired.toFixed(1)} cmH₂O</strong>, men pasientinnsatsen (Pmus) er kun <strong>${patientGenerated.toFixed(1)} cmH₂O</strong>. Maskinen utløses ikke! Gjør triggeren mer sensitiv (f.eks. -1.0 cmH₂O) eller øk pasientinnsatsen.</div>`;
            } else {
                triggerNote = `<div style="margin-top:6px; color:#f87171;">⚠️ <strong>Pasient-ventilator asynkroni (Uutløst flow-trigger):</strong> Innstilt flow-trigger krever <strong>${triggerRequired.toFixed(1)} L/min</strong>, men pasienten genererer kun <strong>${patientGenerated.toFixed(1)} L/min</strong> (Pmus/R). Maskinen utløses ikke!</div>`;
            }
        }

        let clinicalNote = "";
        if (this.patient.preset === 'copd' || R >= 12) {
            clinicalNote = `⚠️ <strong>Obstruktiv mekanikk (KOLS):</strong> Høy motstand (R = ${R} cmH2O/(L/s)) gir en lang tidskonstant (τ = ${tau.toFixed(2)}s). Det tar minst ${timeFor95Expiration}s å tømme 95% av luften. Legg merke til den forlengede flow-halen i ekspirasjonen.${triggerNote}`;
        } else if (this.patient.preset === 'restrictive' || C <= 30) {
            clinicalNote = `⚠️ <strong>Restriktiv mekanikk (Lungeødem / Pneumoni):</strong> Stive lunger med lav ettergivelighet (C = ${C} ml/cmH2O) gir kort tidskonstant (τ = ${tau.toFixed(2)}s) og rask trykkutjevning, men gir lave tidalvolumer (forventet ca. ${theoreticalVt} ml). Øk IPAP for å kompensere.${triggerNote}`;
        } else {
            clinicalNote = `✅ <strong>Normal lungemekanikk:</strong> Normal ettergivelighet og motstand (τ = ${tau.toFixed(2)}s). Lungene tømmes uanstrengt på ca. ${timeFor95Expiration}s.${triggerNote}`;
        }

        return {
            tau: tau.toFixed(2),
            theoreticalVt,
            timeFor95Expiration,
            drivingPressure,
            isTriggerable,
            triggerMargin,
            triggerRequired,
            patientGenerated,
            triggerType,
            clinicalNote
        };
    }
}

// Gjør tilgjengelig globalt
window.VentilatorSimulator = VentilatorSimulator;
