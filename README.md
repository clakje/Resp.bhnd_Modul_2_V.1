# Mekanisk Ventilator Simulator (NIV) - Sandkasse

En interaktiv, sanntids webapplikasjon bygget for sykepleiere og helsepersonell for opplæring i **Non-Invasiv Ventilasjon (NIV)** og trykkstøtteventilasjon (PSV).

---

## 🌟 Funksjoner

- **Realistisk Fysikkmotor:** Løser bevegelsesligningen for lungemekanikk ($P_{aw} + P_{mus} = \frac{V}{C} + \dot{V} \cdot R$) i sanntid.
- **Medisinsk Monitor med Sweep-bar:** 60 FPS HTML5 Canvas 2D-kurver med sweep-slettelinje og rutenett.
  - **Trykk ($P_{aw}$):** Gul/Oransje
  - **Flow ($\dot{V}$):** Blå
  - **Tidalvolum ($V$):** Grønn
- **Kliniske Pasientcaser (Presets):**
  - **Normal Lunge:** $C = 50\text{ ml/cmH}_2\text{O}, R = 5\text{ cmH}_2\text{O}/(\text{L/s})$
  - **KOLS (Obstruktiv):** $C = 70, R = 18$ (forlenget ekspirasjon og flow-hale)
  - **Pneumoni / Lungeødem (Restriktiv):** $C = 22, R = 5$ (stive lunger, lavt tidalvolum)
- **Sanntids Måleverdier:** Kontinuerlig avlesning av $P_{\text{peak}}$, $V_t$, $MV$ og $RR_{\text{tot}}$.
- **Pedagogisk Innsiktsboks:** Forklarer tidskonstanten ($\tau = R \times C$), trykkstøtte ($\Delta P$) og fysiologisk dynamikk i sanntid.

---

## 🚀 Kjøre lokalt

Applikasjonen er bygget med ren HTML5, CSS3 og Vanilla JavaScript. Ingen byggeverktøy eller biblioteker kreves.

1. Klon repoet:
   ```bash
   git clone https://github.com/kokkos88/Resp.bhnd_Modul_2_V.1.git
   ```
2. Åpne `index.html` direkte i en valgfri nettleser, eller start en lokal webserver:
   ```bash
   python -m http.server 8080
   ```
3. Åpne `http://localhost:8080` i nettleseren.
