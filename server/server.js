import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* <!-- === AJOUT PRIORITÉ (SUPABASE CLOUD BACKUP) === --> */
import { createClient } from "@supabase/supabase-js";
/* <!-- === FIN AJOUT PRIORITÉ === --> */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =====================================================
   EXPRESS / STATIC
===================================================== */
const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));

/* =====================================================
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

const server = http.createServer(app);
const io = new Server(server);

/* =====================================================
   SQLITE
===================================================== */
const db = await open({
  filename: "./state.db",
  driver: sqlite3.Database
});

await db.exec(`
CREATE TABLE IF NOT EXISTS engine_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
)
`);

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

console.log("🗄️ SQLite prêt");

/* =====================================================
   SUPABASE INIT
===================================================== */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("☁️ Supabase connecté");
} else {
  console.log("⚠️ Supabase non configuré (env manquantes)");
}

/* =====================================================
   ADMIN CONFIG
===================================================== */

const ADMIN_NAME = process.env.ADMIN_NAME || "kevin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

/* =====================================================
   LOAD STATE LOCAL
===================================================== */
let row = await db.get(`SELECT json FROM engine_state WHERE id = 1`);
if (row) {
  globalThis.INIT_STATE = JSON.parse(row.json);
  console.log("🧠 INIT_STATE injecté dans ENGINE");
}

/* =====================================================
   LOAD STATE SUPABASE SI LOCAL VIDE
===================================================== */
if (!row && supabase) {
  try {
    const { data } = await supabase
      .from("engine_state")
      .select("json")
      .eq("id", 1)
      .single();

    if (data?.json) {
      globalThis.INIT_STATE = data.json;
      console.log("☁️ INIT_STATE chargé depuis Supabase");
    }
  } catch (err) {
    console.error("❌ Supabase boot error:", err.message);
  }
}

/* =====================================================
   LOAD ENGINE
===================================================== */
await import(new URL("../public/core/engine.js", import.meta.url).href);
const ENGINE = globalThis.ENGINE;

console.log("🧠 ENGINE chargé");

/* =====================================================
   LOGIN ADMIN
===================================================== */

app.post("/api/login-admin", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_NAME && password === ADMIN_PASSWORD) {
    return res.json({ ok:true, role:"admin" });
  }

  return res.status(401).json({ ok:false });
});

/* =====================================================
   === AJOUT PRIORITÉ (API EVENTS RESTORE) ===
===================================================== */

app.get("/api/events", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT * FROM events_log ORDER BY ts DESC`
    );

    res.json({
      ok: true,
      events: rows
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* === FIN AJOUT PRIORITÉ === */

/* =====================================================
   PERSISTENCE SAFE
===================================================== */
let saveInProgress = false;
let blockSaveUntil = 0;
const UI_GRACE_MS = 3000;

/* =====================================================
   LOGGER EVENT AVEC USER
===================================================== */
async function logEvent({ type, key, label, user }) {
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
      user || "unknown"
    );

    if (supabase) {
      await supabase.from("events_log").insert([{
        type,
        key,
        four,
        chambre: Number(chambre),
        zone,
        label: label || null,
        ts: Date.now(),
        source: user || "unknown"
      }]);
    }

  } catch (e) {
    console.error("❌ logEvent error:", e.message);
  }
}

/* =====================================================
   ENGINE SUBSCRIBE
===================================================== */
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

    if (supabase) {
      await supabase.from("engine_state").upsert([{
        id: 1,
        json: RAW_STATE
      }]);
    }

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
    if (d.role !== "admin") return;
    blockSaveUntil = Date.now() + UI_GRACE_MS;
    ENGINE.updateZone(d);
  });

  socket.on("cycle:update", d => {
    if (d.role !== "admin") return;
    ENGINE.updateCycle(d);
  });

  socket.on("case:update", d => {

    if (!d.user) return;

    const user = d.user;

    if (d.selection === "infiltre") {
      logEvent({ type:"infiltration", key:d.key, label:d.manual, user });
    }
    else if (d.selection === "termine") {
      logEvent({ type:"termine", key:d.key, label:d.manual, user });
    }
    else {
      logEvent({ type:"work", key:d.key, label:d.manual, user });
    }

    ENGINE.updateCase(d);
  });
});

/* =====================================================
   START SERVER
===================================================== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Serveur prêt → port ${PORT}`);
});
