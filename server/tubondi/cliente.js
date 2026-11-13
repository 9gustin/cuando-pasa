// Único punto de contacto con Tu Bondi (Micronauta). Todo pedido pasa por acá.
// Reglas (PLAN §3.1): cola global de 1 pedido/s (máx. 2 en paralelo), caché, deduplicación de
// pedidos en vuelo, timeout 10 s, renovación de sesión ante 408 (1 reintento), corte de emergencia.
import {
  ErrorFormato, validarArribos, validarParadasCercanas, validarBusqueda, validarLineas,
} from './validar.js';

const BASE_URL = 'https://micronauta4.dnsalias.net/usuario';
const CONF = 'cbaciudad';

export class ErrorTuBondi extends Error {
  constructor(mensaje, { causa, codigo } = {}) {
    super(mensaje);
    this.name = 'ErrorTuBondi';
    this.causa = causa;
    this.codigo = codigo; // 'red' | 'timeout' | 'http' | 'sesion' | 'json' | 'corte'
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const TTL = {
  proximos_arribos: 15_000,
  paradas_cercanas: 24 * 3_600_000,
  buscar_direccion: 24 * 3_600_000,
  lineasyrutas: 24 * 3_600_000,
};

/**
 * Crea un cliente. Todo es inyectable para poder testear sin red ni esperas reales.
 * Cada método devuelve { datos, desactualizado, obtenido (ms epoch), deCache }.
 */
export function crearCliente({
  fetchFn = globalThis.fetch,
  ahora = () => Date.now(),
  intervaloMs = 1000,        // separación mínima entre inicios de pedidos
  maxParalelo = 2,
  timeoutMs = 10_000,
  umbralCorte = 5,           // errores seguidos para abrir el corte
  pausaCorteMs = 60_000,
  maxViejoMs = 30 * 60_000,  // hasta cuándo se sirve un dato viejo si Tu Bondi falla
  maxCache = 500,
  ttlArribosMs = TTL.proximos_arribos, // 0 = sin caché (modo simple/Vercel)
  base = BASE_URL,
  userAgent = 'cuando-pasa/0.1',
  log = (o) => console.log(JSON.stringify(o)),
} = {}) {
  // ---------- cola global ----------
  const espera = [];
  let activos = 0;
  let ultimoInicio = -Infinity;
  let bombeando = false;
  let despertar = null;
  const conTurno = (fn) => new Promise((resolve, reject) => {
    espera.push({ fn, resolve, reject });
    bombear();
  });
  async function bombear() {
    if (bombeando) return;
    bombeando = true;
    while (espera.length) {
      if (activos >= maxParalelo) { await new Promise((r) => { despertar = r; }); continue; }
      const falta = ultimoInicio + intervaloMs - ahora();
      if (falta > 0) await dormir(falta);
      const t = espera.shift();
      ultimoInicio = ahora();
      activos++;
      t.fn().then(t.resolve, t.reject).finally(() => { activos--; despertar?.(); despertar = null; });
    }
    bombeando = false;
  }

  // ---------- estado ----------
  let cookie = null;
  let sesionEnCurso = null;
  const cache = new Map();   // clave -> { valor, ts }
  const enVuelo = new Map(); // clave -> Promise
  let erroresSeguidos = 0;
  let cortadoHasta = 0;
  let ultimaRespuestaOk = null;
  const estadisticas = { pedidos: 0, deCache: 0, deduplicados: 0, errores: 0, sesiones: 0 };

  const headers = (extra = {}) => ({ 'user-agent': userAgent, ...(cookie ? { cookie } : {}), ...extra });

  /** Un pedido HTTP ya con turno: mide, loguea, aplica timeout. */
  async function http(cmd, url, opciones, etiqueta) {
    const t0 = ahora();
    let status = 'error';
    try {
      estadisticas.pedidos++;
      const r = await fetchFn(url, { ...opciones, signal: AbortSignal.timeout(timeoutMs) });
      status = r.status;
      return r;
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new ErrorTuBondi(timeout ? `${cmd}: timeout (${timeoutMs} ms)` : `${cmd}: error de red`, {
        causa: e, codigo: timeout ? 'timeout' : 'red',
      });
    } finally {
      log({ evento: 'tubondi', cmd, ...(etiqueta ? { parada: etiqueta } : {}), ms: ahora() - t0, status, cache: false });
    }
  }

  async function abrirSesion() {
    if (sesionEnCurso) return sesionEnCurso;
    sesionEnCurso = (async () => {
      estadisticas.sesiones++;
      // La página pesa ~300 KB: solo se pide por la cookie, no se lee.
      const r = await conTurno(async () => {
        const resp = await http('sesion', `${base}/urbano.php?conf=${CONF}`, { headers: headers() });
        await resp.body?.cancel().catch(() => {});
        return resp;
      });
      if (!r.ok) throw new ErrorTuBondi(`sesión: HTTP ${r.status}`, { codigo: 'http' });
      const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') ?? ''];
      const sid = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('PHPSESSID='));
      if (!sid) throw new ErrorTuBondi('sesión: Tu Bondi no devolvió PHPSESSID', { codigo: 'sesion' });
      cookie = sid;
    })().finally(() => { sesionEnCurso = null; });
    return sesionEnCurso;
  }

  /** Pedido con sesión: abre sesión si hace falta y reintenta UNA vez ante un 408. */
  async function pedir(cmd, url, opciones, etiqueta) {
    for (let intento = 0; intento < 2; intento++) {
      if (!cookie) await abrirSesion();
      const r = await conTurno(async () => {
        const resp = await http(cmd, url, { ...opciones, headers: headers(opciones.headers) }, etiqueta);
        if (resp.status === 408) { await resp.body?.cancel().catch(() => {}); return { sesionVencida: true }; }
        if (!resp.ok) { await resp.body?.cancel().catch(() => {}); throw new ErrorTuBondi(`${cmd}: HTTP ${resp.status}`, { codigo: 'http' }); }
        try { return { json: await resp.json() }; } catch (e) {
          throw new ErrorTuBondi(`${cmd}: la respuesta no es JSON`, { causa: e, codigo: 'json' });
        }
      });
      if (!r.sesionVencida) return r.json;
      cookie = null; // 408: sesión vencida
    }
    throw new ErrorTuBondi(`${cmd}: Tu Bondi rechazó la sesión (408 dos veces)`, { codigo: 'sesion' });
  }

  const post = (cmd, params, etiqueta) => pedir(cmd, `${base}/urbano2_cmd.php?cmd=${cmd}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ conf: CONF, ...params }),
  }, etiqueta);
  const get = (cmd, params) => pedir(cmd, `${base}/urbano2_cmd.php?${new URLSearchParams({ a: '', cmd, ...params, conf: CONF })}`, { method: 'GET' });

  // ---------- caché + dedup + corte ----------
  function guardar(clave, valor) {
    cache.delete(clave);
    cache.set(clave, { valor, ts: ahora() });
    if (cache.size > maxCache) cache.delete(cache.keys().next().value);
  }

  async function consultar(cmd, clave, ejecutar, etiqueta) {
    const previo = cache.get(clave);
    if (previo && ahora() - previo.ts < (cmd === 'proximos_arribos' ? ttlArribosMs : TTL[cmd])) {
      estadisticas.deCache++;
      log({ evento: 'tubondi', cmd, ...(etiqueta ? { parada: etiqueta } : {}), ms: 0, status: 'cache', cache: true });
      return { datos: previo.valor, desactualizado: false, obtenido: previo.ts, deCache: true };
    }
    const viejo = () => previo && ahora() - previo.ts < maxViejoMs
      ? { datos: previo.valor, desactualizado: true, obtenido: previo.ts, deCache: true } : null;

    if (ahora() < cortadoHasta) {
      const v = viejo();
      if (v) return v;
      throw new ErrorTuBondi(`${cmd}: corte de emergencia activo, sin dato previo`, { codigo: 'corte' });
    }
    if (enVuelo.has(clave)) {
      estadisticas.deduplicados++;
      return enVuelo.get(clave);
    }
    const p = (async () => {
      try {
        const datos = await ejecutar();
        erroresSeguidos = 0;
        ultimaRespuestaOk = ahora();
        guardar(clave, datos);
        return { datos, desactualizado: false, obtenido: ahora(), deCache: false };
      } catch (e) {
        estadisticas.errores++;
        erroresSeguidos++;
        if (erroresSeguidos >= umbralCorte) {
          cortadoHasta = ahora() + pausaCorteMs;
          log({ evento: 'tubondi_corte', errores: erroresSeguidos, pausa_ms: pausaCorteMs });
        }
        if (e instanceof ErrorFormato) log({ evento: 'tubondi_formato', error: e.message });
        const v = viejo();
        if (v) return v;
        throw e;
      }
    })().finally(() => enVuelo.delete(clave));
    enVuelo.set(clave, p);
    return p;
  }

  const redondear = (n) => Number(n).toFixed(4);

  return {
    /** Coches que vienen a una parada. datos = { parada, items } (items crudos validados). */
    proximosArribos: (codigo) => consultar('proximos_arribos', `arr:${codigo}`, async () => {
      const { parada, items, descartados } = validarArribos(await post('proximos_arribos',
        { codigo, onlygps: 'true', show80min: 'true' }, codigo));
      if (descartados) log({ evento: 'tubondi_items_descartados', parada: codigo, descartados });
      return { parada, items };
    }, codigo),

    /** Paradas alrededor de un punto (caché 24 h por punto redondeado a 4 decimales). */
    paradasCercanas: (lat, lon) => consultar('paradas_cercanas', `pc:${redondear(lat)},${redondear(lon)}`,
      async () => validarParadasCercanas(await post('paradas_cercanas', { lat: redondear(lat), lon: redondear(lon) })), null),

    /** Calle o esquina → lat/lon (caché 24 h por texto). */
    buscarDireccion: (q) => {
      const texto = String(q).trim().toLowerCase().replace(/\s+/g, ' ');
      return consultar('buscar_direccion', `bd:${texto}`, async () => validarBusqueda(await get('buscar_direccion', { q: texto })), null);
    },

    /** Catálogo de líneas (caché 24 h). */
    lineasYRutas: () => consultar('lineasyrutas', 'lr', async () => validarLineas(await post('lineasyrutas', {})), null),

    /** Para /salud. */
    estado: () => ({
      tubondi: ahora() < cortadoHasta || erroresSeguidos >= 3 ? 'degradado' : 'ok',
      ultima_respuesta_ok: ultimaRespuestaOk ? new Date(ultimaRespuestaOk).toISOString() : null,
      corte_activo: ahora() < cortadoHasta,
      errores_seguidos: erroresSeguidos,
      ...estadisticas,
    }),
  };
}

let porDefecto = null;
/** Cliente compartido del proceso (la cola 1 pedido/s es global: tiene que ser uno solo). */
export const tuBondi = () => (porDefecto ??= crearCliente());
