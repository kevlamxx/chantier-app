import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =====================================================
   EXPRESS / STATIC
===================================================== */
const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

/* =====================================================
   <!-- === AJOUT PRIORITÉ (2026-02-10) === -->
   POWER APPS — JSON + CORS
===================================================== */
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
/* === FIN AJOUT PRIORITÉ === */

const server = http.createServer(app);
const io = new Server(server);

/* =====================================================
   SQLITE
===================================================== */
const db = await open({
  filename: "./state.db",
  driver: sqlite3.Database
});

/* ================= EXISTANT ================= */
await db.exec(`
CREATE TABLE IF NOT EXISTS engine_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
)
`);

/* <!-- === AJOUT PRIORITÉ (EVENTS HISTORIQUE) === --> */
await db.exec(`
CREATE TABLE IF NOT EXISTS events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  four TEXT NOT NULL,
  chambre INTEGER NOT NULL,
  zone TEXT NOT NULL,
  label TEXT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL
)
`);
/* <!-- === FIN AJOUT PRIORITÉ === --> */

console.log("🗄️ SQLite prêt");

/* =====================================================
   LOAD STATE (RAW STATE UNIQUEMENT)
===================================================== */
const row = await db.get(`SELECT json FROM engine_state WHERE id = 1`);
if (row) {
  globalThis.INIT_STATE = JSON.parse(row.json);
  console.log("🧠 INIT_STATE injecté dans ENGINE");
}

/* =====================================================
   LOAD ENGINE
===================================================== */
await import(new URL("../public/core/engine.js", import.meta.url).href);
const ENGINE = globalThis.ENGINE;

console.log("🧠 ENGINE chargé");

/* =====================================================
   PERSISTENCE SAFE (STATE INTERNE SEULEMENT)
===================================================== */
let saveInProgress = false;

/* <!-- === AJOUT PRIORITÉ (ANTI-REENTRANCE UI) === --> */
let blockSaveUntil = 0;
const UI_GRACE_MS = 3000;
/* <!-- === FIN AJOUT PRIORITÉ === --> */

/* <!-- === AJOUT PRIORITÉ (LOGGER EVENT) === --> */
async function logEvent({ type, key, label }) {
  try {
    const [four, chambre, zone] = key.split("/");
    await db.run(
      `INSERT INTO events_log
       (type, key, four, chambre, zone, label, ts, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      type,
      key,
      four,
      Number(chambre),
      zone,
      label || null,
      Date.now(),
      "engine"
    );
  } catch (e) {
    console.error("❌ logEvent error:", e.message);
  }
}
/* <!-- === FIN AJOUT PRIORITÉ === --> */

ENGINE.subscribe(async () => {

  if (Date.now() < blockSaveUntil) return;
  if (saveInProgress) return;
  saveInProgress = true;

  try {
    const state = ENGINE.getState();

    const RAW_STATE = {
      cycles: state.cycles,
      zones: state.zones.map(z => ({
        id: z.id,
        four: z.four,
        chambre: z.chambre,
        nextTs: z.nextTs
      })),
      cases: state.cases
    };

    await db.run(
      `INSERT OR REPLACE INTO engine_state (id, json) VALUES (1, ?)`,
      JSON.stringify(RAW_STATE)
    );

  } catch (err) {
    console.error("❌ SQLite write error:", err.message);
  } finally {
    saveInProgress = false;
  }

  io.emit("engine:viewState", ENGINE.getState());
});

/* =====================================================
   SOCKET.IO
===================================================== */
io.on("connection", socket => {

  socket.emit("engine:viewState", ENGINE.getState());

  socket.on("zone:update", d => {
    blockSaveUntil = Date.now() + UI_GRACE_MS;
    ENGINE.updateZone(d);
  });

  socket.on("cycle:update", d => ENGINE.updateCycle(d));

  socket.on("case:update", d => {

    if (d.selection === "infiltre") {
      logEvent({ type:"infiltration", key:d.key, label:d.manual });
    }
    else if (d.selection === "termine") {
      logEvent({ type:"termine", key:d.key, label:d.manual });
    }
    else {
      logEvent({ type:"work", key:d.key, label:d.manual });
    }

    ENGINE.updateCase(d);
  });
});

/* =====================================================
   API POWER APPS — PONT REST
===================================================== */

app.get("/api/state", (req, res) => {
  res.json(ENGINE.getState());
});

app.post("/api/case", (req, res) => {
  const { key, selection, manual } = req.body;
  ENGINE.updateCase({ key, selection, manual });
  res.json({ ok: true });
});

app.post("/api/zone", (req, res) => {
  ENGINE.updateZone(req.body);
  res.json({ ok: true });
});

app.post("/api/cycle", (req, res) => {
  ENGINE.updateCycle(req.body);
  res.json({ ok: true });
});

/* =====================================================
   API LECTURE HISTORIQUE
===================================================== */
app.get("/api/events", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT * FROM events_log ORDER BY ts DESC`
    );
    res.json({ ok:true, events: rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

/* =====================================================
   START SERVER (CLOUD READY)
===================================================== */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Serveur prêt → port ${PORT}`);
});
