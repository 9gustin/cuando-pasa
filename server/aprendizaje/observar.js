// Guarda lo que se ve en cada proximos_arribos: la materia prima del aprendizaje (PLAN §6.1 paso 4).
import { enTransaccion } from '../db.js';

const MIN_ENTRE_OBS_MS = 60_000; // el mismo coche en la misma parada no se anota más de una vez por minuto
const recientes = new WeakMap(); // db -> Map(clave -> ts)

/**
 * @param coches resultado de normalizarArribos(...) de la parada `codigo`
 * @param infoParada { nombre, lat, lon } (de la respuesta); lat/lon se toman del primer coche si faltan
 */
export function registrarObservaciones(db, codigo, coches, infoParada = {}, ts = Date.now()) {
  if (!recientes.has(db)) recientes.set(db, new Map());
  const memo = recientes.get(db);
  const lat = infoParada.lat ?? coches[0]?.parada_lat ?? null;
  const lon = infoParada.lon ?? coches[0]?.parada_lon ?? null;

  const upParada = db.prepare(`INSERT INTO parada (codigo, nombre, lat, lon, sentido, actualizado) VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(codigo) DO UPDATE SET nombre = COALESCE(excluded.nombre, nombre), lat = COALESCE(excluded.lat, lat),
      lon = COALESCE(excluded.lon, lon), actualizado = excluded.actualizado`);
  const upLinea = db.prepare(`INSERT INTO linea_en_parada (parada, linea, ruta, destino, color, visto) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(parada, linea, ruta) DO UPDATE SET destino = excluded.destino, color = COALESCE(excluded.color, color), visto = excluded.visto`);
  const insObs = db.prepare(`INSERT INTO observacion (ts, parada, linea, ruta, coche, hora_estimada, lat_coche, lon_coche)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  let nuevas = 0;
  enTransaccion(db, () => {
    upParada.run(codigo, infoParada.nombre ?? null, lat, lon, ts);
    for (const c of coches) {
      upLinea.run(codigo, c.linea, c.ruta, c.destino, c.color, ts);
      const clave = `${codigo}|${c.linea}|${c.ruta}|${c.coche}`;
      if (ts - (memo.get(clave) ?? -Infinity) < MIN_ENTRE_OBS_MS) continue;
      memo.set(clave, ts);
      insObs.run(ts, codigo, c.linea, c.ruta, c.coche, c.instante, c.coche_lat, c.coche_lon);
      nuevas++;
    }
  });
  if (memo.size > 20_000) for (const [k, t] of memo) if (ts - t > MIN_ENTRE_OBS_MS) memo.delete(k);
  return nuevas;
}

/** Guarda paradas candidatas (de paradas_cercanas) sin pisar el sentido ya calculado. */
export function registrarParadas(db, paradas, ts = Date.now()) {
  const st = db.prepare(`INSERT INTO parada (codigo, nombre, lat, lon, sentido, actualizado) VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre, lat = excluded.lat, lon = excluded.lon`);
  enTransaccion(db, () => { for (const p of paradas) st.run(p.codigo, p.nombre, p.lat, p.lon, ts); });
}

/** Borra observaciones de más de `dias` días. */
export function purgarObservaciones(db, dias = 30, ahora = Date.now()) {
  return db.prepare('DELETE FROM observacion WHERE ts < ?').run(ahora - dias * 86_400_000).changes;
}
