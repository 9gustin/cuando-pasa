// Pasa las respuestas crudas de Tu Bondi a datos limpios y tipados.

const MS_DIA = 86_400_000;
const OFFSET_AR_MS = -3 * 3_600_000; // Córdoba es UTC-3 todo el año (sin horario de verano)

// ---------- texto ----------
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodifica entidades HTML (&#128204;, &#x1F4CC;, &amp;…). El resultado es TEXTO PLANO, no HTML. */
export function decodificarEntidades(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** Escapa texto para meterlo en HTML. El frontend debe usar textContent o esto; nunca innerHTML crudo. */
export function escaparHtml(s) {
  const mapa = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s ?? '').replace(/[&<>"']/g, (c) => mapa[c]);
}

/** Texto de desvío listo para mostrar: entidades decodificadas, sin controles, saltos → " · ". */
export function limpiarDesvio(s) {
  if (s == null) return null;
  const t = decodificarEntidades(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' · ')
    .replace(/\s+/g, ' ').trim();
  return t || null;
}

// ---------- tiempo ----------
/** Segundos desde medianoche (hora argentina) de un instante. */
export function segundosDelDia(ahoraMs) {
  const local = ahoraMs + OFFSET_AR_MS;
  return Math.floor((((local % MS_DIA) + MS_DIA) % MS_DIA) / 1000);
}

/**
 * "HH:MM:SS" (hora argentina) → ms epoch del instante más cercano a `ahoraMs`.
 * Maneja el cruce de medianoche: si cae a más de 12 h de distancia, es del día anterior/siguiente.
 */
export function horaAInstante(hora, ahoraMs) {
  const [h, m, s = 0] = hora.split(':').map(Number);
  const local = ahoraMs + OFFSET_AR_MS;
  const inicioDia = ahoraMs - (((local % MS_DIA) + MS_DIA) % MS_DIA); // medianoche argentina, en ms epoch
  let t = inicioDia + ((h * 60 + m) * 60 + s) * 1000;
  if (t - ahoraMs > MS_DIA / 2) t -= MS_DIA;
  else if (ahoraMs - t > MS_DIA / 2) t += MS_DIA;
  return t;
}

/** "HH:MM" en hora argentina. */
export function formatoHora(ms) {
  const sd = segundosDelDia(ms);
  return `${String(Math.floor(sd / 3600)).padStart(2, '0')}:${String(Math.floor((sd % 3600) / 60)).padStart(2, '0')}`;
}

/** "Llegando" → 0, "4min" → 4, otra cosa → null. */
export function minutosDeProximo(proximo) {
  if (typeof proximo !== 'string') return null;
  if (/llegando/i.test(proximo)) return 0;
  const m = /(\d+)/.exec(proximo);
  return m ? +m[1] : null;
}

// ---------- proximos_arribos ----------
/**
 * Items crudos validados → coches únicos, con minutos, sin los que ya pasaron, ordenados por hora.
 * Un mismo coche puede venir repetido con dos `ruta`: se deduplica por coche + línea.
 */
export function normalizarArribos(items, ahoraMs) {
  const vistos = new Map();
  for (const a of items) {
    const clave = `${a.linea_nombre}|${a.coche}`;
    if (!vistos.has(clave)) vistos.set(clave, a);
  }
  const salida = [];
  for (const a of vistos.values()) {
    const llegando = /llegando/i.test(a.proximo ?? '');
    let instante;
    if (a.horaTeoricaAjustada) instante = horaAInstante(a.horaTeoricaAjustada, ahoraMs);
    else {
      const min = minutosDeProximo(a.proximo);
      if (min == null) continue;
      instante = ahoraMs + min * 60_000;
    }
    let minutos = Math.round((instante - ahoraMs) / 60_000);
    if (minutos < 0) {
      if (!llegando) continue; // ya pasó
      minutos = 0;
    }
    const [latP, lonP, latC, lonC] = a.a.slice(0, 4).map(Number);
    salida.push({
      linea: String(a.linea_nombre),
      ruta: String(a.ruta),
      destino: a.ruta_descripcion,
      color: typeof a.color === 'string' ? a.color : null,
      coche: String(a.coche),
      instante,
      hora: formatoHora(instante),
      minutos,
      llegando,
      dist_m: a.dist_parada == null ? null : Number(a.dist_parada),
      parada_lat: latP, parada_lon: lonP, coche_lat: latC, coche_lon: lonC,
      desvio: limpiarDesvio(a.notificacion),
    });
  }
  return salida.sort((x, y) => x.instante - y.instante);
}

// ---------- otros comandos ----------
export const normalizarParadas = (paradas) => paradas.map((p) => ({
  codigo: p.codigo, nombre: p.parada_nombre, lat: Number(p.lat), lon: Number(p.lon),
}));

export const normalizarBusqueda = (lista) => lista.map((d) => ({
  texto: d.display_name, lat: Number(d.lat), lon: Number(d.lon),
}));

export const normalizarLineas = (lineas) => lineas.map((l) => ({
  linea: l.linea_nombre, empresa: l.cliente_nombre ?? null, color: l.color ?? null,
}));

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaM(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = (x) => x * Math.PI / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
