/* =====================================================
   🧠 ENGINE — CERVEAU ABSOLU (ZONES CIRCULAIRES)
===================================================== */
(function () {

  const GLOBAL =
    typeof globalThis !== "undefined" ? globalThis :
    typeof window !== "undefined" ? window :
    typeof global !== "undefined" ? global : {};

  const CONFIG = {
    limits: { four1: 76, four2: 38 }
  };

  /* ================= ÉTAT ================= */
  const STATE = {
    now: Date.now(),

    cycles: { four1: 19, four2: 24 },

    zones: [
      { id: 1, four: "four1", chambre: 1, nextTs: 0 },
      { id: 2, four: "four1", chambre: 1, nextTs: 0 },
      { id: 3, four: "four1", chambre: 1, nextTs: 0 },
      { id: 4, four: "four1", chambre: 1, nextTs: 0 },
      { id: 5, four: "four2", chambre: 1, nextTs: 0 },
      { id: 6, four: "four2", chambre: 1, nextTs: 0 }
    ],

    cases: {}
  };

  const SUBS = [];

  /* =====================================================
     RESTORE INIT_STATE
  ===================================================== */
  if (GLOBAL.INIT_STATE) {
    if (GLOBAL.INIT_STATE.cycles) STATE.cycles = GLOBAL.INIT_STATE.cycles;
    if (Array.isArray(GLOBAL.INIT_STATE.zones)) STATE.zones = GLOBAL.INIT_STATE.zones;
    if (GLOBAL.INIT_STATE.cases) STATE.cases = GLOBAL.INIT_STATE.cases;
    console.log("🧠 ENGINE — INIT_STATE restauré");
  }

  Object.values(STATE.cases).forEach(c => {
    if (!Array.isArray(c.history)) c.history = [];
  });

  /* =====================================================
     RECONSTRUCTION MÉTIER CASES
  ===================================================== */
  Object.values(STATE.cases).forEach(c => {
    c.work = false;
    c.infiltre = false;

    if (c.doneTs) return;

    const last = c.history[c.history.length - 1];
    if (!last) return;

    if (last.action === "infiltre") {
      c.infiltre = true;
      return;
    }

    if (last.action !== "termine") {
      c.work = true;
    }
  });

  /* =====================================================
     ZONES TIMER
  ===================================================== */
  STATE.zones.forEach(z => {
    if (!z.nextTs || z.nextTs <= STATE.now) {
      z.nextTs = Date.now() + STATE.cycles[z.four] * 3600000;
    }
  });

  setInterval(() => {
    STATE.now = Date.now();
    tickZones();
    notify();
  }, 1000);

  function tickZones() {
    STATE.zones.forEach(z => {
      if (STATE.now < z.nextTs) return;
      z.chambre++;
      if (z.chambre > CONFIG.limits[z.four]) z.chambre = 1;
      z.nextTs = STATE.now + STATE.cycles[z.four] * 3600000;
    });
  }

  function computeAbsoluteNextTs(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(STATE.now);
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= STATE.now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  const ENGINE = {};

  /* =====================================================
     MENUS MÉTIER
  ===================================================== */
  ENGINE.getMenuDefinition = ({ key, intent }) => {
    const [, , zone] = key.split("/");
    const c = STATE.cases[key] || {};
    const isMur = zone.startsWith("M");

    const hasInfiltration =
      c.infiltre === true ||
      (Array.isArray(c.history) &&
       c.history.length &&
       c.history[c.history.length - 1].action === "infiltre");

    if (intent === "INFILTRATION") {
      if (!isMur) return [];
      return [
        { label:"💧 Infiltration", action:{ selection:"infiltre" } },
        { label:"✍ Infiltration (manuel)", action:{ selection:"infiltre", prompt:true } },
        ...(hasInfiltration
          ? [{ label:"❌ Retirer infiltration", action:{ selection:"remove_infiltre" } }]
          : [])
      ];
    }

    if (intent === "TRAVAUX") {
      return [
        { label:"Réparation", action:{ selection:"manuel", manual:"Réparation" } },
        { label:"Mono-bloc", action:{ selection:"manuel", manual:"Mono-bloc" } },
        { label:"Calage", action:{ selection:"manuel", manual:"Calage" } },
        { label:"✅ Terminé", action:{ selection:"termine" } },
        { label:"✍ Autre…", action:{ selection:"manuel", prompt:true } }
      ];
    }

    return [];
  };

  /* =====================================================
     PLAN DES FOURS — SOURCE UNIQUE DE VÉRITÉ
  ===================================================== */
  ENGINE.getPlanDefinition = (four) => {

    /* === AJOUT PRIORITÉ — RÈGLE MÉTIER POSITION NUMÉRO === */

    if (four === "four1") {
      return {
        numberSideRule: (chambre) => chambre >= 39 ? "left" : "right",

        sides: [
          { from: 76, to: 39, invert:false, side:"left" },
          { from: 1,  to: 38, invert:true,  side:"right" }
        ]
      };
    }

    if (four === "four2") {
      return {
        numberSideRule: (chambre) => chambre >= 20 ? "left" : "right",

        sides: [
          { from: 38, to: 20, invert:false, side:"left" },
          { from: 1,  to: 19, invert:true,  side:"right" }
        ]
      };
    }

    /* === FIN AJOUT PRIORITÉ === */

    return null;
  };

  /* =====================================================
     ÉTAT GLOBAL
  ===================================================== */
  ENGINE.getState = () => {
    const travaux = [];

    Object.entries(STATE.cases).forEach(([key,c]) => {
      if (!c.work) return;

      const [four, ch] = key.split("/");
      const chambre = Number(ch);

      let best = { delta: Infinity, nextTs: Infinity };

      STATE.zones.forEach(z => {
        if (z.four !== four) return;

        const delta =
          chambre >= z.chambre
            ? chambre - z.chambre
            : CONFIG.limits[four] - z.chambre + chambre;

        if (
          delta < best.delta ||
          (delta === best.delta && z.nextTs < best.nextTs)
        ) {
          best.delta = delta;
          best.nextTs = z.nextTs;
        }
      });

      let pr;
      if (best.delta >= 1 && best.delta <= 3) {
        pr = { lvl: 0, cls: "prio-urgent" };
      } else if (best.delta === 4) {
        pr = { lvl: 1, cls: "prio-orange" };
      } else {
        pr = { lvl: 2, cls: "prio-yellow" };
      }

      travaux.push({
        key,
        four,
        chambre,
        label: c.label || "Travail",
        priorityLevel: pr.lvl,
        priorityClass: pr.cls,
        _delta: best.delta,
        _nextTs: best.nextTs
      });
    });

    travaux.sort((a,b)=>{
      if (a._delta !== b._delta) return a._delta - b._delta;
      return a._nextTs - b._nextTs;
    });

    const chambresActives = {};
    const chambresNext = {};

    STATE.zones.forEach(z=>{
      const key = `${z.four}/${String(z.chambre).padStart(2,"0")}`;
      chambresActives[key] = true;
    });

    const nextByFour = {};
    STATE.zones.forEach(z=>{
      if(!nextByFour[z.four] || z.nextTs < nextByFour[z.four].nextTs){
        nextByFour[z.four] = z;
      }
    });

    Object.values(nextByFour).forEach(z=>{
      const key = `${z.four}/${String(z.chambre).padStart(2,"0")}`;
      chambresNext[key] = true;
    });

    const zonesUI = STATE.zones.map(z=>{
      const deltaMs = Math.max(0, z.nextTs - STATE.now);
      const totalMin = Math.floor(deltaMs / 60000);
      const hh = Math.floor(totalMin / 60);
      const mm = totalMin % 60;

      const d = new Date(z.nextTs);

      return {
        id: z.id,
        four: z.four,
        chambre: z.chambre,
        heureTransition:
          String(d.getHours()).padStart(2,"0") + ":" +
          String(d.getMinutes()).padStart(2,"0"),
        compteRebours:
          String(hh).padStart(2,"0") + ":" +
          String(mm).padStart(2,"0")
      };
    });

    /* =====================================================
       === AJOUT PRIORITÉ — TRAVAUX TERMINÉS (48h)
    ===================================================== */
    const travauxTermines = [];
    const LIMIT_48H = 48 * 3600000;

    Object.entries(STATE.cases).forEach(([key, c]) => {
      if (!c.doneTs) return;
      if (STATE.now - c.doneTs > LIMIT_48H) return;

      const [four, chambre, zone] = key.split("/");

      travauxTermines.push({
        key,
        four,
        chambre,
        zone,
        label: c.label || "Travail terminé",
        doneTs: c.doneTs
      });
    });
    /* === FIN AJOUT PRIORITÉ === */

    return {
      serverTime: STATE.now,
      cycles: STATE.cycles,
      zones: STATE.zones,
      zonesUI,
      travauxPriorises: travaux,
      travauxTermines,
      cases: STATE.cases,
      chambresActives,
      chambresNext
    };
  };

  /* =====================================================
     MUTATIONS
  ===================================================== */
  ENGINE.updateZone = ({ id, chambre, heure }) => {
    const z = STATE.zones.find(z => z.id === id);
    if (!z) return;

    ENGINE.beginHumanEdit();

    if (Number.isFinite(chambre)) {
      const max = CONFIG.limits[z.four];
      z.chambre = Math.min(Math.max(1, chambre), max);
    }

    if (heure) z.nextTs = computeAbsoluteNextTs(heure);
    notify();
  };

  ENGINE.updateCycle = ({ four, hours }) => {
    const oldCycle = STATE.cycles[four];
    if (!oldCycle || oldCycle === hours) return;

    const deltaH = hours - oldCycle;
    const deltaMs = deltaH * 3600000;
    const now = Date.now();

    STATE.zones.forEach(z => {
      if (z.four !== four) return;
      if (!z.nextTs) return;

      z.nextTs += deltaMs;
      if (z.nextTs <= now) {
        z.nextTs += hours * 3600000;
      }
    });

    STATE.cycles[four] = hours;
    notify();
  };

  ENGINE.updateCase = ({ key, selection, manual }) => {
    if (!STATE.cases[key]) {
      STATE.cases[key] = { work:false, infiltre:false, label:null, history:[] };
    }

    ENGINE.beginHumanEdit();

    const c = STATE.cases[key];
    c.history.push({ ts:Date.now(), action:selection, label:manual||null });

    if (selection === "termine") {
      c.work = false;
      c.doneTs = Date.now();
    }
    else if (selection === "infiltre") c.infiltre = true;
    else if (selection === "remove_infiltre") c.infiltre = false;
    else {
      c.work = true;
      c.label = manual || selection;
    }

    notify();
  };

  ENGINE.subscribe = fn => SUBS.push(fn);

  /* =====================================================
     MODE ÉDITION HUMAINE
  ===================================================== */
  let humanEditUntil = 0;

  ENGINE.beginHumanEdit = (ms = 5000) => {
    humanEditUntil = Date.now() + ms;
  };

  ENGINE.isHumanEditActive = () => Date.now() < humanEditUntil;

  function notify(){
    STATE.now = Date.now();
    if (ENGINE.isHumanEditActive()) return;
    SUBS.forEach(fn => fn(ENGINE.getState()));
  }

  GLOBAL.ENGINE = ENGINE;
  console.log("🧠 ENGINE — CHARGÉ ET OPÉRATIONNEL");

})();
