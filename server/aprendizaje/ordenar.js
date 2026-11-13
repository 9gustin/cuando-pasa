// Deduce las paradas previas a P (PLAN §6.2 paso 4-5).
// Idea: el MISMO coche aparece en varias paradas con distinta hora estimada. Donde llega antes, está antes.
import { enTransaccion } from '../db.js';

const VENTANA_TS_MS = 3 * 60_000;   // dos observaciones del mismo coche se comparan si se tomaron con < 3 min de diferencia
const MAX_DIF_MIN = 45;             // más lejos que esto no es una "previa" útil
const MAX_SALTO_MIN = 5;            // si entre dos previas consecutivas hay más que esto, faltan paradas en el medio: se corta ahí
const MIN_DIF_MIN = 0.1;            // diferencias <= 6 s no distinguen paradas
export const UMBRAL_CONFIANZA = 0.67;

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param obs observaciones de UNA línea+ruta: [{ts, parada, coche, hora_estimada(ms)}]
 * @returns [{ orden, parada, min_tipicos, confianza }] — orden 1 = la inmediatamente anterior a `destino`
 */
export function deducirPrevias(obs, destino, { n = 6 } = {}) {
  const porCoche = new Map();
  for (const o of obs) {
    if (!porCoche.has(o.coche)) porCoche.set(o.coche, []);
    porCoche.get(o.coche).push(o);
  }
  const muestras = new Map(); // parada -> { difs: [], coches: Set }
  for (const [coche, lista] of porCoche) {
    const enDestino = lista.filter((o) => o.parada === destino);
    if (!enDestino.length) continue;
    for (const d of enDestino) {
      for (const s of lista) {
        if (s.parada === destino || Math.abs(s.ts - d.ts) > VENTANA_TS_MS) continue;
        const dif = (d.hora_estimada - s.hora_estimada) / 60_000;
        if (dif < MIN_DIF_MIN || dif > MAX_DIF_MIN) continue;
        if (!muestras.has(s.parada)) muestras.set(s.parada, { difs: [], coches: new Set() });
        const m = muestras.get(s.parada);
        m.difs.push(dif);
        m.coches.add(coche);
      }
    }
  }
  const ordenadas = [...muestras.entries()]
    .map(([parada, m]) => ({ parada, min_tipicos: mediana(m.difs), confianza: Math.min(1, m.coches.size / 3) }))
    .sort((a, b) => a.min_tipicos - b.min_tipicos);
  // Solo el tramo contiguo desde P hacia atrás: con un salto grande faltan paradas intermedias y la cuenta saldría mal.
  let corte = 0;
  while (corte < ordenadas.length && ordenadas[corte].min_tipicos - (corte ? ordenadas[corte - 1].min_tipicos : 0) <= MAX_SALTO_MIN) corte++;
  return ordenadas.slice(0, corte)
    .slice(0, n)
    .map((p, i) => ({ orden: i + 1, ...p }));
}

/** Lee observaciones de la base, deduce y guarda en `previa` (reemplaza lo anterior de esa línea+ruta). */
export function aprenderPrevias(db, destino, linea, ruta, { n = 6, ahora = Date.now(), diasAtras = 14 } = {}) {
  const obs = db.prepare(`SELECT ts, parada, coche, hora_estimada FROM observacion
    WHERE linea = ? AND ruta = ? AND ts > ? ORDER BY ts`).all(linea, ruta, ahora - diasAtras * 86_400_000);
  const previas = deducirPrevias(obs, destino, { n });
  enTransaccion(db, () => {
    db.prepare('DELETE FROM previa WHERE parada_destino = ? AND linea = ? AND ruta = ?').run(destino, linea, ruta);
    const ins = db.prepare('INSERT INTO previa (parada_destino, linea, ruta, orden, parada, min_tipicos, confianza, actualizado) VALUES (?,?,?,?,?,?,?,?)');
    for (const p of previas) ins.run(destino, linea, ruta, p.orden, p.parada, p.min_tipicos, p.confianza, ahora);
  });
  return previas;
}

/** ¿Esa línea+ruta ya tiene n previas con confianza alta y actualizadas hace menos de `diasFrescas`? */
export function estaCompleta(db, destino, linea, ruta, { n = 6, diasFrescas = 7, ahora = Date.now() } = {}) {
  const f = db.prepare(`SELECT COUNT(*) AS c, MIN(confianza) AS minc, MIN(actualizado) AS act FROM previa
    WHERE parada_destino = ? AND linea = ? AND ruta = ?`).get(destino, linea, ruta);
  return f.c >= n && f.minc >= UMBRAL_CONFIANZA && ahora - f.act < diasFrescas * 86_400_000;
}
