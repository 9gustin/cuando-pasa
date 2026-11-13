// Aprendizaje de paradas previas (PLAN §6.2) y tareas programadas.
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { distanciaM, segundosDelDia } from '../tubondi/normalizar.js';
import { registrarParadas, purgarObservaciones } from './observar.js';
import { aprenderPrevias, estaCompleta } from './ordenar.js';

const RADIO_CANDIDATAS_M = 150;
const MAX_COCHES_POR_RUTA = 3;

/** Elige hasta `k` coches repartidos a lo largo de la lista (cerca, medio, lejos), ordenados por distancia. */
function repartidos(coches, k) {
  const ord = [...coches].sort((a, b) => (a.dist_m ?? 1e9) - (b.dist_m ?? 1e9));
  if (ord.length <= k) return ord;
  return Array.from({ length: k }, (_, i) => ord[Math.round((i * (ord.length - 1)) / (k - 1))]);
}

/**
 * Una pasada de aprendizaje para la parada `codigo`. Devuelve un resumen.
 * presupuesto: máximo de pedidos REALES a Tu Bondi (los servidos de caché no cuentan).
 */
export async function aprenderParada(codigo, { cliente, servicio, db, presupuesto = 15, n = 6, ahora = () => Date.now(), log = () => {} }) {
  let gastados = 0;
  const hayPresupuesto = () => gastados < presupuesto;
  const resumen = { parada: codigo, pedidos: 0, candidatas: 0, rutas: [] };

  const base = await servicio.arribos(codigo);
  if (!base.deCache) gastados++;
  const grupos = new Map();
  for (const c of base.coches) {
    const k = `${c.linea}|${c.ruta}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  const cuantasPrevias = (linea, ruta) => db.prepare(
    'SELECT COUNT(*) AS c FROM previa WHERE parada_destino = ? AND linea = ? AND ruta = ?').get(codigo, linea, ruta).c;

  // Primero las líneas con menos previas aprendidas; las completas se saltean (re-verificación semanal).
  const pendientes = [...grupos.entries()]
    .filter(([, cs]) => !estaCompleta(db, codigo, cs[0].linea, cs[0].ruta, { n, ahora: ahora() }))
    .sort((a, b) => cuantasPrevias(a[1][0].linea, a[1][0].ruta) - cuantasPrevias(b[1][0].linea, b[1][0].ruta));

  const consultadas = new Set([codigo]);
  for (const [, cs] of pendientes) {
    if (!hayPresupuesto()) break;
    const candidatas = new Map();
    for (const coche of repartidos(cs, MAX_COCHES_POR_RUTA)) {
      if (!hayPresupuesto()) break;
      let r;
      try { r = await cliente.paradasCercanas(coche.coche_lat, coche.coche_lon); } catch (e) { log({ evento: 'aprendizaje_aviso', parada: codigo, error: e?.message }); continue; }
      if (!r.deCache) gastados++;
      const cerca = r.datos
        .map((p) => ({ codigo: p.codigo, nombre: p.parada_nombre, lat: Number(p.lat), lon: Number(p.lon) }))
        .filter((p) => distanciaM(coche.coche_lat, coche.coche_lon, p.lat, p.lon) <= RADIO_CANDIDATAS_M);
      registrarParadas(db, cerca, ahora());
      for (const p of cerca) if (!consultadas.has(p.codigo)) candidatas.set(p.codigo, p);
    }
    for (const p of candidatas.values()) {
      if (!hayPresupuesto()) break;
      consultadas.add(p.codigo);
      try {
        const r = await servicio.arribos(p.codigo);
        if (!r.deCache) gastados++;
        resumen.candidatas++;
      } catch (e) { gastados++; log({ evento: 'aprendizaje_aviso', parada: p.codigo, error: e?.message }); }
    }
    const previas = aprenderPrevias(db, codigo, cs[0].linea, cs[0].ruta, { n, ahora: ahora() });
    resumen.rutas.push({ linea: cs[0].linea, ruta: cs[0].ruta, previas: previas.length });
  }
  resumen.pedidos = gastados;
  log({ evento: 'aprendizaje', ...resumen });
  return resumen;
}

/** Tareas programadas: aprendizaje cada 10 min (6–23 h), purga y copia diaria. */
export function iniciarTareas({
  db, cliente, servicio, rutaDb = null, intervaloMs = 10 * 60_000, ahora = () => Date.now(),
  log = (o) => console.log(JSON.stringify(o)),
}) {
  const enCurso = new Set();
  let diaMantenimiento = null;

  async function aprender(codigo) {
    if (enCurso.has(codigo)) return null;
    enCurso.add(codigo);
    try { return await aprenderParada(codigo, { cliente, servicio, db, ahora, log }); }
    catch (e) { log({ evento: 'aprendizaje_error', parada: codigo, error: e?.message }); return null; }
    finally { enCurso.delete(codigo); }
  }

  async function tick() {
    const hora = Math.floor(segundosDelDia(ahora()) / 3600);
    const dia = Math.floor((ahora() - 3 * 3_600_000) / 86_400_000);
    if (hora >= 3 && diaMantenimiento !== dia) {
      diaMantenimiento = dia;
      const borradas = purgarObservaciones(db, 30, ahora());
      db.prepare('DELETE FROM parada_activa WHERE ultimo_uso < ?').run(ahora() - 14 * 86_400_000);
      if (rutaDb && rutaDb !== ':memory:') {
        try { const copia = `${rutaDb}.bak`; if (existsSync(copia)) rmSync(copia); db.exec(`VACUUM INTO '${copia.replaceAll("'", "''")}'`); }
        catch (e) { log({ evento: 'backup_error', error: e?.message }); }
      }
      log({ evento: 'mantenimiento', observaciones_borradas: borradas });
    }
    if (hora < 6 || hora >= 23) return;
    const activas = db.prepare('SELECT parada FROM parada_activa WHERE ultimo_uso > ?').all(ahora() - 14 * 86_400_000);
    for (const { parada } of activas) await aprender(parada);
  }

  const timer = setInterval(() => { tick().catch((e) => log({ evento: 'tarea_error', error: e?.message })); }, intervaloMs);
  timer.unref?.();
  return { aprender, tick, detener: () => clearInterval(timer) };
}

/** Marca una parada como activa (se vigila y se aprende). */
export function marcarActiva(db, codigo, ts = Date.now()) {
  db.prepare(`INSERT INTO parada_activa (parada, ultimo_uso) VALUES (?, ?)
    ON CONFLICT(parada) DO UPDATE SET ultimo_uso = excluded.ultimo_uso`).run(codigo, ts);
}
