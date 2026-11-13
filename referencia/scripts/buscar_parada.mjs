// Lista paradas de Tu Bondi sobre una calle, cerca de varios puntos, y qué líneas/sentidos pasan.
import { paradasCercanas, arribos, hav } from './tb.mjs';
const calle = (process.argv[2] || 'castro').toLowerCase();
const puntos = JSON.parse(process.argv[3]); // [[lat,lon],...]
const vistas = new Map();
for (const [lat, lon] of puntos) {
  for (const p of await paradasCercanas(lat, lon)) {
    if (!p.parada_nombre.toLowerCase().includes(calle)) continue;
    if (hav(lat, lon, +p.lat, +p.lon) > 400) continue;
    vistas.set(p.codigo, p);
  }
}
const lista = [...vistas.values()].sort((a, b) => +a.lat - +b.lat);
for (const p of lista) {
  const arr = await arribos(p.codigo);
  const lineas = [...new Set(arr.map(a => `${a.linea_nombre}→${a.ruta_descripcion}`))];
  console.log(`${p.codigo.padEnd(6)} ${p.parada_nombre.padEnd(34)} ${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}  | ${lineas.join(' ; ') || '(nada con GPS ahora)'}`);
}
