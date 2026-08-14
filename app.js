/**
 * app.js - Hovedapplikasjon og kontrollerkobling for NIV Simulatoren
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialiser kjernekomponenter
    const simulator = new VentilatorSimulator();
    const renderer = new WaveformRenderer('waveformCanvas');

    let isPaused = false;
    let lastTimestamp = performance.now();

    // 2. DOM Referanser
    // Måleverdier
    const valPpeak = document.getElementById('valPpeak');
    const valVt = document.getElementById('valVt');
    const valMv = document.getElementById('valMv');
    const valRR = document.getElementById('valRR');

    // Innstilte visningsbokser
    const dispIpap = document.getElementById('dispIpap');
    const dispEpap = document.getElementById('dispEpap');
    const dispFio2 = document.getElementById('dispFio2');

    // Slidere og Badges
    const sliders = {
        ipap: document.getElementById('sliderIpap'),
        epap: document.getElementById('sliderEpap'),
        rr: document.getElementById('sliderRR'),
        fio2: document.getElementById('sliderFio2'),
        trigger: document.getElementById('sliderTrigger'),
        compliance: document.getElementById('sliderCompliance'),
        resistance: document.getElementById('sliderResistance'),
        pmus: document.getElementById('sliderPmus'),
        cycling: document.getElementById('sliderCycling'),
        riseTime: document.getElementById('sliderRiseTime'),
        leak: document.getElementById('sliderLeak')
    };

    const badges = {
        ipap: document.getElementById('badgeIpap'),
        epap: document.getElementById('badgeEpap'),
        rr: document.getElementById('badgeRR'),
        fio2: document.getElementById('badgeFio2'),
        trigger: document.getElementById('badgeTrigger'),
        compliance: document.getElementById('badgeCompliance'),
        resistance: document.getElementById('badgeResistance'),
        pmus: document.getElementById('badgePmus'),
        cycling: document.getElementById('badgeCycling'),
        riseTime: document.getElementById('badgeRiseTime'),
        leak: document.getElementById('badgeLeak')
    };

    // Trigger Type Knapper & Tekster
    const btnTrigFlow = document.getElementById('btnTrigFlow');
    const btnTrigPressure = document.getElementById('btnTrigPressure');
    const triggerSublabel = document.getElementById('triggerSublabel');
    const triggerLimitMin = document.getElementById('triggerLimitMin');
    const triggerLimitMax = document.getElementById('triggerLimitMax');
    const btnTrigStepDown = document.getElementById('btnTrigStepDown');
    const btnTrigStepUp = document.getElementById('btnTrigStepUp');

    // Trigger-samkjøringsfelter (UI/UX)
    const triggerSyncBox = document.getElementById('triggerSyncBox');
    const triggerSyncBadge = document.getElementById('triggerSyncBadge');
    const syncTriggerReq = document.getElementById('syncTriggerReq');
    const syncPatientEffort = document.getElementById('syncPatientEffort');
    const triggerGaugeFill = document.getElementById('triggerGaugeFill');
    const triggerGaugeThreshold = document.getElementById('triggerGaugeThreshold');
    const triggerSyncMessage = document.getElementById('triggerSyncMessage');

    const pmusSyncBox = document.getElementById('pmusSyncBox');
    const pmusSyncBadge = document.getElementById('pmusSyncBadge');
    const pmusSyncMessage = document.getElementById('pmusSyncMessage');

    // Knapper
    const btnPause = document.getElementById('btnPause');
    const pauseIcon = document.getElementById('pauseIcon');
    const pauseText = document.getElementById('pauseText');
    const btnReset = document.getElementById('btnReset');

    // Presets
    const presetBtns = {
        normal: document.getElementById('presetNormal'),
        copd: document.getElementById('presetCopd'),
        restrictive: document.getElementById('presetRestrictive')
    };

    // Innsiktspanel
    const insightTau = document.getElementById('insightTau');
    const insightDeltaP = document.getElementById('insightDeltaP');
    const insightTheoVt = document.getElementById('insightTheoVt');
    const insightText = document.getElementById('insightText');

    // Funksjon for sanntids samkjøring av pasientinnsats og triggerfølsomhet
    function updateTriggerSyncUI() {
        const triggerType = simulator.settings.triggerType;
        const pmus = simulator.patient.pmusMax;
        const R = simulator.patient.resistance;

        if (triggerType === 'pressure') {
            const triggerReq = Math.abs(simulator.settings.triggerPressure);
            const isTriggerable = pmus >= triggerReq;
            const margin = parseFloat((pmus - triggerReq).toFixed(1));

            if (syncTriggerReq) syncTriggerReq.textContent = `${triggerReq.toFixed(1)} cmH₂O`;
            if (syncPatientEffort) syncPatientEffort.textContent = `${pmus.toFixed(1)} cmH₂O`;

            // Beregn skala for sammenligningsmåler
            const maxVal = Math.max(6, triggerReq * 1.4, pmus * 1.2);
            const threshPct = Math.min(95, Math.max(5, (triggerReq / maxVal) * 100));
            const effortPct = Math.min(100, Math.max(0, (pmus / maxVal) * 100));

            if (triggerGaugeThreshold) triggerGaugeThreshold.style.left = `${threshPct}%`;
            if (triggerGaugeFill) triggerGaugeFill.style.width = `${effortPct}%`;

            if (isTriggerable) {
                if (triggerSyncBox) triggerSyncBox.classList.remove('warning-state');
                if (pmusSyncBox) pmusSyncBox.classList.remove('warning-state');
                if (triggerGaugeFill) triggerGaugeFill.classList.remove('warning-fill');

                if (triggerSyncBadge) {
                    triggerSyncBadge.className = 'trigger-sync-status-badge status-ok';
                    triggerSyncBadge.textContent = '✅ Utløses';
                }
                if (pmusSyncBadge) {
                    pmusSyncBadge.className = 'trigger-sync-status-badge status-ok';
                    pmusSyncBadge.textContent = '✅ Nok kraft';
                }

                badges.trigger.classList.remove('badge-warning-pill');
                badges.pmus.classList.remove('badge-warning-pill');

                if (triggerSyncMessage) {
                    triggerSyncMessage.innerHTML = `Pasientinnsats (<strong>${pmus.toFixed(1)} cmH₂O</strong>) overgår triggerkravet (<strong>${triggerReq.toFixed(1)} cmH₂O</strong>). <strong>Margin: +${margin} cmH₂O</strong>.`;
                }
                if (pmusSyncMessage) {
                    pmusSyncMessage.innerHTML = `Innstilt trykk-trigger krever <strong>${triggerReq.toFixed(1)} cmH₂O</strong>. Pasienten yter <strong>${pmus.toFixed(1)} cmH₂O</strong> og utløser innpust (margin +${margin} cmH₂O).`;
                }
            } else {
                if (triggerSyncBox) triggerSyncBox.classList.add('warning-state');
                if (pmusSyncBox) pmusSyncBox.classList.add('warning-state');
                if (triggerGaugeFill) triggerGaugeFill.classList.add('warning-fill');

                if (triggerSyncBadge) {
                    triggerSyncBadge.className = 'trigger-sync-status-badge status-warning';
                    triggerSyncBadge.textContent = '⚠️ Uutløst';
                }
                if (pmusSyncBadge) {
                    pmusSyncBadge.className = 'trigger-sync-status-badge status-warning';
                    pmusSyncBadge.textContent = '⚠️ For svak';
                }

                badges.trigger.classList.add('badge-warning-pill');
                badges.pmus.classList.add('badge-warning-pill');

                const diff = Math.abs(margin).toFixed(1);
                if (triggerSyncMessage) {
                    triggerSyncMessage.innerHTML = `⚠️ <strong>For tung trigger!</strong> Krever <strong>${triggerReq.toFixed(1)} cmH₂O</strong> undertrykk, men pasienten yter kun <strong>${pmus.toFixed(1)} cmH₂O</strong> (mangler ${diff} cmH₂O). Innpust utløses IKKE!`;
                }
                if (pmusSyncMessage) {
                    pmusSyncMessage.innerHTML = `⚠️ Pasientinnsats (<strong>${pmus.toFixed(1)} cmH₂O</strong>) er for svak for innstilt trigger (<strong>${triggerReq.toFixed(1)} cmH₂O</strong>). Øk Pmus eller gjør trigger lettere.`;
                }
            }
        } else {
            // Flow-trigger samkjøring
            const triggerReq = simulator.settings.triggerFlow;
            const patientFlow = parseFloat(((pmus / R) * 60).toFixed(1));
            const isTriggerable = patientFlow >= triggerReq;
            const margin = parseFloat((patientFlow - triggerReq).toFixed(1));

            if (syncTriggerReq) syncTriggerReq.textContent = `${triggerReq.toFixed(1)} L/min`;
            if (syncPatientEffort) syncPatientEffort.textContent = `${patientFlow.toFixed(1)} L/min`;

            const maxVal = Math.max(10, triggerReq * 1.4, patientFlow * 1.2);
            const threshPct = Math.min(95, Math.max(5, (triggerReq / maxVal) * 100));
            const effortPct = Math.min(100, Math.max(0, (patientFlow / maxVal) * 100));

            if (triggerGaugeThreshold) triggerGaugeThreshold.style.left = `${threshPct}%`;
            if (triggerGaugeFill) triggerGaugeFill.style.width = `${effortPct}%`;

            if (isTriggerable) {
                if (triggerSyncBox) triggerSyncBox.classList.remove('warning-state');
                if (pmusSyncBox) pmusSyncBox.classList.remove('warning-state');
                if (triggerGaugeFill) triggerGaugeFill.classList.remove('warning-fill');

                if (triggerSyncBadge) {
                    triggerSyncBadge.className = 'trigger-sync-status-badge status-ok';
                    triggerSyncBadge.textContent = '✅ Utløses';
                }
                if (pmusSyncBadge) {
                    pmusSyncBadge.className = 'trigger-sync-status-badge status-ok';
                    pmusSyncBadge.textContent = '✅ Nok flow';
                }

                badges.trigger.classList.remove('badge-warning-pill');
                badges.pmus.classList.remove('badge-warning-pill');

                if (triggerSyncMessage) {
                    triggerSyncMessage.innerHTML = `Pasientens flow (<strong>${patientFlow.toFixed(1)} L/min</strong>) overgår triggerkravet (<strong>${triggerReq.toFixed(1)} L/min</strong>). <strong>Margin: +${margin} L/min</strong>.`;
                }
                if (pmusSyncMessage) {
                    pmusSyncMessage.innerHTML = `Pasienten genererer <strong>${patientFlow.toFixed(1)} L/min</strong> flow (Pmus/R) og overvinner flow-triggeren på <strong>${triggerReq.toFixed(1)} L/min</strong>.`;
                }
            } else {
                if (triggerSyncBox) triggerSyncBox.classList.add('warning-state');
                if (pmusSyncBox) pmusSyncBox.classList.add('warning-state');
                if (triggerGaugeFill) triggerGaugeFill.classList.add('warning-fill');

                if (triggerSyncBadge) {
                    triggerSyncBadge.className = 'trigger-sync-status-badge status-warning';
                    triggerSyncBadge.textContent = '⚠️ Uutløst';
                }
                if (pmusSyncBadge) {
                    pmusSyncBadge.className = 'trigger-sync-status-badge status-warning';
                    pmusSyncBadge.textContent = '⚠️ For lav flow';
                }

                badges.trigger.classList.add('badge-warning-pill');
                badges.pmus.classList.add('badge-warning-pill');

                const diff = Math.abs(margin).toFixed(1);
                if (triggerSyncMessage) {
                    triggerSyncMessage.innerHTML = `⚠️ <strong>Uutløst flow-trigger!</strong> Pasienten genererer kun <strong>${patientFlow.toFixed(1)} L/min</strong> flow (terskel <strong>${triggerReq.toFixed(1)} L/min</strong>, mangler ${diff} L/min). Innpust utløses IKKE!`;
                }
                if (pmusSyncMessage) {
                    pmusSyncMessage.innerHTML = `⚠️ Pasientens flow (<strong>${patientFlow.toFixed(1)} L/min</strong>) når ikke flow-triggeren (<strong>${triggerReq.toFixed(1)} L/min</strong>). Øk Pmus eller senk flow-trigger.`;
                }
            }
        }
    }

    // Funksjon for å bytte trigger-type (Flow vs Trykk)
    function setTriggerType(type) {
        simulator.settings.triggerType = type;
        if (type === 'flow') {
            btnTrigFlow.classList.add('active');
            btnTrigPressure.classList.remove('active');

            triggerSublabel.textContent = 'Flow-trigger (1–5 L/min)';
            triggerLimitMin.textContent = '1.0 L/min (Mest sensitiv)';
            triggerLimitMax.textContent = '5.0 L/min (Mindre sensitiv)';

            sliders.trigger.min = '1';
            sliders.trigger.max = '5';
            sliders.trigger.step = '0.5';
            sliders.trigger.value = simulator.settings.triggerFlow || 3.0;

            btnTrigStepDown.setAttribute('data-step', '-0.5');
            btnTrigStepUp.setAttribute('data-step', '0.5');

            badges.trigger.textContent = `${simulator.settings.triggerFlow.toFixed(1)} L/min`;
        } else {
            btnTrigPressure.classList.add('active');
            btnTrigFlow.classList.remove('active');

            triggerSublabel.textContent = 'Trykk-trigger (-1 til -5 cmH₂O)';
            triggerLimitMin.textContent = '-1.0 cmH₂O (Mest sensitiv)';
            triggerLimitMax.textContent = '-5.0 cmH₂O (Tungt arbeid)';

            sliders.trigger.min = '-5';
            sliders.trigger.max = '-1';
            sliders.trigger.step = '0.5';
            sliders.trigger.value = simulator.settings.triggerPressure || -2.0;

            btnTrigStepDown.setAttribute('data-step', '-0.5');
            btnTrigStepUp.setAttribute('data-step', '0.5');

            badges.trigger.textContent = `${simulator.settings.triggerPressure.toFixed(1)} cmH₂O`;
        }
        updateTriggerSyncUI();
        updateInsights();
    }

    if (btnTrigFlow && btnTrigPressure) {
        btnTrigFlow.addEventListener('click', () => setTriggerType('flow'));
        btnTrigPressure.addEventListener('click', () => setTriggerType('pressure'));
    }

    // 3. Koble til Sliders
    function updateSimulatorFromUI() {
        // Hent verdier
        const ipap = parseFloat(sliders.ipap.value);
        let epap = parseFloat(sliders.epap.value);

        // Sikre at IPAP alltid er minst 2 cmH2O høyere enn EPAP
        if (epap >= ipap) {
            epap = ipap - 2;
            sliders.epap.value = epap;
        }

        const rr = parseInt(sliders.rr.value, 10);
        const fio2 = parseInt(sliders.fio2.value, 10);
        const compliance = parseFloat(sliders.compliance.value);
        const resistance = parseFloat(sliders.resistance.value);
        const pmus = parseFloat(sliders.pmus.value);
        const cycling = parseFloat(sliders.cycling.value) / 100;
        const riseTime = parseFloat(sliders.riseTime.value) / 1000;
        const leak = parseFloat(sliders.leak.value);

        // Oppdater trigger
        if (simulator.settings.triggerType === 'flow') {
            const trigVal = parseFloat(sliders.trigger.value);
            simulator.settings.triggerFlow = trigVal;
            badges.trigger.textContent = `${trigVal.toFixed(1)} L/min`;
        } else {
            const trigVal = parseFloat(sliders.trigger.value);
            simulator.settings.triggerPressure = trigVal;
            badges.trigger.textContent = `${trigVal.toFixed(1)} cmH₂O`;
        }

        // Oppdater simulatoren
        simulator.settings.ipap = ipap;
        simulator.settings.epap = epap;
        simulator.settings.rr = rr;
        simulator.settings.fio2 = fio2;
        simulator.settings.riseTime = riseTime;
        simulator.settings.cyclingPercent = cycling;
        simulator.settings.leak = leak;

        simulator.patient.compliance = compliance;
        simulator.patient.resistance = resistance;
        simulator.patient.pmusMax = pmus;

        // Oppdater tekstmerker
        badges.ipap.textContent = `${ipap} cmH₂O`;
        badges.epap.textContent = `${epap} cmH₂O`;
        badges.rr.textContent = `${rr} /min`;
        badges.fio2.textContent = `${fio2} %`;
        badges.compliance.textContent = `${compliance} ml/cmH₂O`;
        badges.resistance.textContent = `${resistance} cmH₂O/(L/s)`;
        badges.pmus.textContent = `${pmus} cmH₂O`;
        badges.cycling.textContent = `${Math.round(cycling * 100)} %`;
        badges.riseTime.textContent = `${Math.round(riseTime * 1000)} ms`;
        badges.leak.textContent = `${leak} L/min`;

        // Oppdater innstilte visninger i målepanelet
        dispIpap.textContent = ipap;
        dispEpap.textContent = epap;
        dispFio2.textContent = `${fio2}%`;

        updateTriggerSyncUI();
        updateInsights();
    }

    // Lytt på slider-endringer
    Object.values(sliders).forEach(slider => {
        slider.addEventListener('input', () => {
            // Hvis bruker justerer compliance eller resistance manuelt, sett preset til custom
            if (slider === sliders.compliance || slider === sliders.resistance) {
                setActivePresetButton(null);
                simulator.patient.preset = 'custom';
            }
            updateSimulatorFromUI();
        });
    });

    // Trinnknapper (+ / -)
    document.querySelectorAll('.step-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute('data-target');
            const step = parseFloat(btn.getAttribute('data-step'));
            const targetSlider = document.getElementById(targetId);
            if (targetSlider) {
                let currentVal = parseFloat(targetSlider.value);
                let min = parseFloat(targetSlider.min);
                let max = parseFloat(targetSlider.max);
                let newVal = Math.min(max, Math.max(min, currentVal + step));
                targetSlider.value = newVal;
                targetSlider.dispatchEvent(new Event('input'));
            }
        });
    });

    // 4. Presets (Pasientcaser)
    function setActivePresetButton(activeKey) {
        Object.entries(presetBtns).forEach(([key, btn]) => {
            if (key === activeKey) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function applyPreset(presetKey) {
        simulator.setPreset(presetKey);
        setActivePresetButton(presetKey);

        // Synkroniser slidere med den nye preset-tilstanden
        sliders.compliance.value = simulator.patient.compliance;
        sliders.resistance.value = simulator.patient.resistance;
        sliders.pmus.value = simulator.patient.pmusMax;

        // Spesifikke forslag til IPAP/EPAP for klinisk relevans
        if (presetKey === 'copd') {
            sliders.ipap.value = 16;
            sliders.epap.value = 5;
            sliders.rr.value = 16;
        } else if (presetKey === 'restrictive') {
            sliders.ipap.value = 18;
            sliders.epap.value = 8;
            sliders.rr.value = 20;
        } else if (presetKey === 'normal') {
            sliders.ipap.value = 14;
            sliders.epap.value = 5;
            sliders.rr.value = 15;
        }

        updateSimulatorFromUI();
    }

    Object.entries(presetBtns).forEach(([key, btn]) => {
        btn.addEventListener('click', () => applyPreset(key));
    });

    // 5. Fane-veksling
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.style.display = 'none');

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.style.display = 'block';
            }
        });
    });

    // 6. Pause & Reset knapper
    btnPause.addEventListener('click', () => {
        isPaused = !isPaused;
        simulator.isRunning = !isPaused;

        if (isPaused) {
            pauseIcon.textContent = '▶';
            pauseText.textContent = 'Fortsett';
            btnPause.classList.add('active');
        } else {
            pauseIcon.textContent = '⏸';
            pauseText.textContent = 'Pause';
            btnPause.classList.remove('active');
            lastTimestamp = performance.now();
        }
    });

    btnReset.addEventListener('click', () => {
        applyPreset('normal');
        setTriggerType('flow');
        sliders.trigger.value = 3;
        renderer.initCanvas();
    });

    // 7. Oppdater pedagogisk innsikt
    function updateInsights() {
        const insights = simulator.getPhysiologicalInsights();
        insightTau.textContent = `${insights.tau} s`;
        insightDeltaP.textContent = `${insights.drivingPressure} cmH₂O`;
        insightTheoVt.textContent = `${insights.theoreticalVt} ml`;
        insightText.innerHTML = insights.clinicalNote;
    }

    // 8. Oppdater målte pasientverdier i displayet
    let readoutUpdateTimer = 0;
    function updateReadouts(dt) {
        readoutUpdateTimer += dt;
        // Oppdater tallene jevnlig (ca 4 ganger i sekundet for behagelig lesbarhet)
        if (readoutUpdateTimer >= 0.25) {
            readoutUpdateTimer = 0;
            const m = simulator.state.measured;
            valPpeak.textContent = m.ppeak.toFixed(1);
            valVt.textContent = m.vt;
            valMv.textContent = m.mv.toFixed(1);
            valRR.textContent = m.rrTotal;
        }
    }

    // 9. Hoved-animasjonsloop (60 FPS)
    function loop(currentTimestamp) {
        const elapsedSec = Math.min(0.1, (currentTimestamp - lastTimestamp) / 1000);
        lastTimestamp = currentTimestamp;

        if (!isPaused && elapsedSec > 0) {
            // 1. Simuler fysiologi
            simulator.step(elapsedSec);

            // 2. Send sample til grafisk monitor
            const wasTriggered = simulator.state.justTriggered;
            const isFlowTrigger = simulator.state.isFlowTrigger;
            const isPawTrigger = simulator.state.isPawTrigger;
            simulator.state.justTriggered = false;

            renderer.addSample(
                elapsedSec,
                simulator.state.paw,
                simulator.state.volume,
                simulator.state.flow,
                wasTriggered,
                simulator.settings.epap,
                isFlowTrigger,
                isPawTrigger
            );

            // 3. Oppdater måletall
            updateReadouts(elapsedSec);
        }

        // 4. Tegn kurver
        renderer.render();

        requestAnimationFrame(loop);
    }

    // Start opp med default-verdier
    updateSimulatorFromUI();
    requestAnimationFrame(loop);
});
