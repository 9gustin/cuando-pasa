// Aprende las paradas previas a P para cada línea, usando solo Tu Bondi.
// 1) coches que se acercan a P (GPS)  2) candidatas: paradas cerca de puntos entre coche y P
// 3) filtra por las que listan misma línea+ruta  4) ordena por hora del mismo coche.
import { arribos, paradasCercanas, hav } from './tb.mjs';
const [, , P, lineasCsv, maxCoches = '3'] = process.argv;
const lineas = lineasCsv.split(',');

const base = await arribos(P);
const pLat = +base[0]?.a[0], pLon = +base[0]?.a[1];
for (const linea of lineas) {
  const items = base.filter(a => a.linea_nombre === linea);
  if (!items.length) { console.log(`\nLínea ${linea}: sin coches con GPS ahora`); continue; }
  const ruta = items[0].ruta, desc = items[0].ruta_descripcion;
  const coches = [...new Map(items.filter(a => a.ruta === ruta).map(a => [a.coche, a])).values()]
    .sort((a, b) => a.dist_parada - b.dist_parada).slice(0, +maxCoches);
  // puntos semilla: cada ~300 m entre P y el coche más lejano elegido
  const lejos = coches.at(-1); const [cLat, cLon] = [lejos.a[2], lejos.a[3]];
  const n = Math.max(1, Math.ceil(hav(pLat, pLon, cLat, cLon) / 300));
  const cand = new Map();
  for (const c of coches) cand.set('gps' + c.coche, null);
  for (let i = 0; i <= n; i++) {
    const lat = pLat + (cLat - pLat) * i / n, lon = pLon + (cLon - pLon) * i / n;
    for (const p of await paradasCercanas(lat, lon)) {
      if (hav(lat, lon, +p.lat, +p.lon) < 200 && p.codigo !== P) cand.set(p.codigo, p);
    }
  }
  // verificar candidatas y registrar hora del mismo coche
  const filas = [];
  for (const [cod, p] of cand) {
    if (!p) continue;
    const arr = (await arribos(cod)).filter(a => a.linea_nombre === linea && a.ruta === ruta);
    if (!arr.length) continue;
    const horas = {};
    for (const a of arr) horas[a.coche] = a.horaTeoricaAjustada;
    filas.push({ cod, nombre: p.parada_nombre, horas });
  }
  const horaP = Object.fromEntries(coches.map(c => [c.coche, c.horaTeoricaAjustada]));
  // una parada es "previa" si algún coche llega antes ahí que a P; se ordena por la hora mínima relativa
  const previas = filas.map(f => {
    const difs = Object.entries(f.horas).filter(([c]) => horaP[c]).map(([c, h]) => (toS(horaP[c]) - toS(h)) / 60);
    return { ...f, antes: difs.length ? Math.max(...difs) : null };
  }).filter(f => f.antes !== null && f.antes > 0).sort((a, b) => b.antes - a.antes);
  console.log(`\nLínea ${linea} → ${desc} (ruta ${ruta}) · coches: ${coches.map(c => `${c.coche} (${c.proximo})`).join(', ')}`);
  console.log(`candidatas: ${cand.size - coches.length} · con esta línea: ${filas.length} · previas: ${previas.length}`);
  for (const f of previas) console.log(`  ${f.cod.padEnd(6)} ${f.nombre.padEnd(36)} ~${f.antes.toFixed(0)} min antes`);
  console.log(`  ${P}  ← TU PARADA`);
}
function toS(h) { const [a, b, c] = h.split(':').map(Number); return a * 3600 + b * 60 + (c || 0); }
