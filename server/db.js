// SQLite con node:sqlite + migraciones simples (PRAGMA user_version).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRACIONES = [
  // 1: modelo de PLAN §5
  `
  CREATE TABLE parada (
    codigo TEXT PRIMARY KEY, nombre TEXT, lat REAL, lon REAL,
    sentido TEXT CHECK (sentido IN ('centro','afuera','?')), actualizado INTEGER);
  CREATE TABLE linea_en_parada (
    parada TEXT, linea TEXT, ruta TEXT, destino TEXT, color TEXT, visto INTEGER,
    PRIMARY KEY (parada, linea, ruta));
  CREATE TABLE observacion (
    ts INTEGER, parada TEXT, linea TEXT, ruta TEXT, coche TEXT, hora_estimada INTEGER,
    lat_coche REAL, lon_coche REAL);
  CREATE INDEX obs_coche ON observacion (linea, ruta, coche, ts);
  CREATE INDEX obs_ts ON observacion (ts);
  CREATE TABLE previa (
    parada_destino TEXT, linea TEXT, ruta TEXT, orden INTEGER, parada TEXT,
    min_tipicos REAL, confianza REAL, actualizado INTEGER,
    PRIMARY KEY (parada_destino, linea, ruta, orden));
  CREATE TABLE parada_activa (parada TEXT PRIMARY KEY, ultimo_uso INTEGER);
  `,
  // 2: suscripciones push (Etapa 7); la tabla queda creada pero sin uso hasta entonces
  `
  CREATE TABLE suscripcion (id TEXT PRIMARY KEY, parada TEXT, lineas TEXT, n_paradas INTEGER,
    dias TEXT, desde TEXT, hasta TEXT, endpoint TEXT, p256dh TEXT, auth TEXT);
  `,
];

/** Abre (y migra) la base. ruta ':memory:' para tests. */
export function abrirDb(ruta = ':memory:') {
  if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  if (ruta !== ':memory:') { try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* sistemas de archivos sin WAL */ } }
  db.exec('PRAGMA busy_timeout = 5000');
  const actual = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = actual; v < MIGRACIONES.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRACIONES[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return db;
}

/** Transacción simple. */
export function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
