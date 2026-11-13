// Ordena paradas candidatas usando sólo Tu Bondi: el mismo coche aparece en varias paradas
// con distinta ETA; la parada donde el coche llega antes está antes en el recorrido.
import { arribos } from './tb.mjs';
const [, , paradasCsv, linea, rutaTxt] = process.argv;
const paradas = paradasCsv.split(',');
const etaMin = (a) => {
  if (/llegando/i.test(a.proximo)) return 0;
  const m = /(\d+)/.exec(a.proximo); return m ? +m[1] : null;
};
const tabla = {}; // coche -> {parada: min}
for (const p of paradas) {
  for (const a of await arribos(p)) {
    if (a.linea_nombre !== linea || !a.ruta_descripcion.toUpperCase().includes(rutaTxt.toUpperCase())) continue;
    (tabla[a.coche] ??= {})[p] = { min: etaMin(a), dist: a.dist_parada, hora: a.horaTeoricaAjustada };
  }
}
console.log(`Línea ${linea} → ${rutaTxt}\ncoche  | ` + paradas.map(p => p.padEnd(13)).join(''));
for (const [coche, fila] of Object.entries(tabla)) {
  console.log(coche.padEnd(6) + ' | ' + paradas.map(p => (fila[p] ? `${fila[p].min}′ ${fila[p].hora?.slice(0, 5)}` : '—').padEnd(13)).join(''));
}
// orden inferido: promedio de rango por coche que aparece en >= 2 paradas
const score = Object.fromEntries(paradas.map(p => [p, []]));
for (const fila of Object.values(tabla)) {
  const ps = Object.entries(fila).filter(([, v]) => v.min !== null);
  if (ps.length < 2) continue;
  for (const [p, v] of ps) score[p].push(v.hora || String(v.min).padStart(3, '0'));
}
const orden = paradas.filter(p => score[p].length).sort((a, b) => score[a].sort()[0].localeCompare(score[b].sort()[0]));
console.log('\nOrden inferido (primera → última):', orden.join(' → ') || '(sin datos suficientes)');
