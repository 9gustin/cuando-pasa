// "Paradas que faltan" para un coche (PLAN §6.1 paso 3).
// Convención: faltan = cuántas paradas le quedan hasta llegar a la tuya, contando la tuya.
// Un coche justo después de la parada anterior a la tuya → "falta 1 parada".
import { distanciaM } from '../tubondi/normalizar.js';

const MAX_DIST_AL_TRAMO_M = 350; // más lejos que esto, el GPS no coincide con el recorrido aprendido (desvío): no se usa
const TOLERANCIA_MIN = 5;        // el GPS solo vale si es coherente con los minutos de Tu Bondi (±5 min): evita coches de la vereda de enfrente
const TOLERANCIA_PUNTA_M = 120;  // coche antes de la primera previa aprendida: solo se acepta si está muy cerca de ella

/** Proyecta (en plano local, metros) el punto p sobre el segmento a→b. Devuelve { t (sin acotar), dist }. */
function proyectar(p, a, b) {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const X = (q) => ({ x: (q.lon - a.lon) * 111_320 * k, y: (q.lat - a.lat) * 110_540 });
  const B = X(b), P = X(p);
  const len2 = B.x * B.x + B.y * B.y;
  const t = len2 === 0 ? 0 : (P.x * B.x + P.y * B.y) / len2;
  const tc = Math.max(0, Math.min(1, t));
  return { t, dist: Math.hypot(P.x - B.x * tc, P.y - B.y * tc) };
}

/**
 * @param coche { coche_lat, coche_lon, minutos }
 * @param previas [{ orden, lat, lon, min_tipicos }] ordenadas por orden ascendente (1 = la anterior a P)
 * @param destino { lat, lon } la parada del usuario
 * @returns { faltan: number|null, fuente: 'gps'|'minutos'|null }
 */
export function calcularFaltan(coche, previas, destino) {
  if (!previas.length) return { faltan: null, fuente: null };
  const n = previas.length;

  // 1) GPS: secuencia pts[0..n] = previa n, …, previa 1, P. Segmento i va de pts[i] a pts[i+1]:
  //    el coche ya pasó la previa de orden (n - i) → faltan n - i.
  const conCoordenadas = previas.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) && Number.isFinite(destino?.lat);
  if (conCoordenadas && Number.isFinite(coche.coche_lat)) {
    const pts = [...previas].sort((a, b) => b.orden - a.orden).map((p) => ({ lat: p.lat, lon: p.lon }));
    pts.push({ lat: destino.lat, lon: destino.lon });
    const c = { lat: coche.coche_lat, lon: coche.coche_lon };
    let mejor = null;
    for (let i = 0; i < n; i++) {
      const r = proyectar(c, pts[i], pts[i + 1]);
      if (!mejor || r.dist < mejor.dist) mejor = { i, ...r };
    }
    if (mejor.dist <= MAX_DIST_AL_TRAMO_M) {
      const antesDeLaPrimera = mejor.i === 0 && mejor.t < 0 &&
        distanciaM(c.lat, c.lon, pts[0].lat, pts[0].lon) > TOLERANCIA_PUNTA_M;
      if (antesDeLaPrimera) return { faltan: null, fuente: null }; // más lejos de lo aprendido: todavía no sabemos cuántas
      // ¿Coherente con el tiempo? El coche pasó la previa de orden k y le falta la de orden k-1: debería estar entre sus tiempos típicos.
      const k = n - mejor.i;
      const tk = previas.find((p) => p.orden === k)?.min_tipicos;
      const tk1 = k > 1 ? previas.find((p) => p.orden === k - 1)?.min_tipicos : 0;
      const coherente = !Number.isFinite(tk) || !Number.isFinite(coche.minutos) ||
        (coche.minutos <= tk + TOLERANCIA_MIN && coche.minutos >= (tk1 ?? 0) - TOLERANCIA_MIN);
      if (coherente) return { faltan: k, fuente: 'gps' };
    }
  }

  // 2) Minutos: previas cuyo tiempo típico hasta P es menor que lo que le falta al coche.
  const tipicos = previas.map((p) => p.min_tipicos).filter(Number.isFinite);
  if (tipicos.length && coche.minutos <= Math.max(...tipicos) + 1) {
    return { faltan: tipicos.filter((t) => t < coche.minutos).length + 1, fuente: 'minutos' };
  }
  // 3) Sin dato.
  return { faltan: null, fuente: null };
}
