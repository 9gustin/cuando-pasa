// Utilidades del frontend. Todo texto que viene de la API pasa por `html` (escapa) o textContent: nunca HTML crudo.

const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);

class Crudo { constructor(s) { this.s = s; } }
/** Marca un fragmento como HTML ya seguro (solo para HTML armado con `html`). */
export const crudo = (s) => new Crudo(s);

/** Template tag: escapa cada valor interpolado, salvo los marcados con `crudo` y las listas de ellos. */
export function html(partes, ...valores) {
  const conv = (v) => (v instanceof Crudo ? v.s : Array.isArray(v) ? v.map(conv).join('') : esc(v));
  return new Crudo(partes.reduce((acc, p, i) => acc + p + (i < valores.length ? conv(valores[i]) : ''), ''));
}

/** Pone un fragmento `html` en un elemento. */
export function pintar(el, fragmento) {
  el.innerHTML = fragmento instanceof Crudo ? fragmento.s : esc(fragmento);
}

export const pad = (n) => String(n).padStart(2, '0');
export const horaActual = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Oscurece un color #rrggbb para que el texto blanco tenga buen contraste (AA). */
export function colorInsignia(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return '#B35400';
  const n = parseInt(m[1], 16);
  const f = 0.62;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x * f));
  return `#${c.map((x) => pad(x.toString(16))).join('')}`;
}

/** fuente 'distancia' = estimación por metros en línea recta: se marca con ~. */
export const textoFaltan = (n, fuente) => {
  if (n === null || n === undefined) return 'sin dato de paradas';
  const aprox = fuente === 'distancia' ? '~' : '';
  return n === 1 ? `falta ${aprox}1 parada` : `faltan ${aprox}${n} paradas`;
};
export const textoSentido = (s) => (s === 'centro' ? 'Hacia el centro' : s === 'afuera' ? 'Hacia afuera' : 'Sentido sin confirmar');

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
