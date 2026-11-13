// Pegamento entre las funciones de Vercel (req/res de Node) y el servicio simple.
import { servicioCompartido, aRespuestaError, CODIGO } from './servicio.js';

export function enviar(res, estado, cuerpo) {
  res.statusCode = estado;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(cuerpo));
}

/** Envuelve un manejador: método permitido, errores → JSON, sin filtrar detalles. */
export function ruta(metodo, fn, { servicio = servicioCompartido } = {}) {
  return async function handler(req, res) {
    if (req.method !== metodo) { res.setHeader('allow', metodo); return enviar(res, 405, { error: 'Método no permitido' }); }
    try {
      const url = new URL(req.url, 'http://localhost');
      await fn({ req, res, url, servicio: servicio() });
    } catch (e) {
      const [estado, cuerpo] = aRespuestaError(e);
      if (estado === 500) console.error(JSON.stringify({ evento: 'error', mensaje: e?.message }));
      enviar(res, estado, cuerpo);
    }
  };
}

export const numero = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);

/** Código de parada desde /api/parada/SM02 (o ?codigo=). */
export function codigoDe(req, url) {
  const c = req.query?.codigo ?? url.searchParams.get('codigo') ?? url.pathname.split('/').filter(Boolean).at(-1);
  return typeof c === 'string' && CODIGO.test(c) ? c.toUpperCase() : null;
}

export const hacerHandlers = (opciones) => ({
  salud: ruta('GET', ({ res }) => enviar(res, 200, { ok: true, modo: 'simple' }), opciones),
  buscar: ruta('GET', async ({ res, url, servicio }) => enviar(res, 200, await servicio.buscar(url.searchParams.get('q'))), opciones),
  paradas: ruta('GET', async ({ res, url, servicio }) => {
    const lat = numero(url.searchParams.get('lat')), lon = numero(url.searchParams.get('lon'));
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return enviar(res, 400, { error: 'lat y lon inválidas' });
    const max = Math.min(15, Math.max(1, Math.trunc(numero(url.searchParams.get('max')) ?? 8)));
    enviar(res, 200, await servicio.paradas(lat, lon, { max }));
  }, opciones),
  parada: ruta('GET', async ({ req, res, url, servicio }) => {
    const codigo = codigoDe(req, url);
    if (!codigo) return enviar(res, 400, { error: 'Código de parada inválido' });
    enviar(res, 200, await servicio.proximos(codigo));
  }, opciones),
  // En el MVP no hay aprendizaje: "activar" no hace nada (el frontend lo llama igual).
  activar: ruta('POST', ({ res }) => { res.statusCode = 204; res.end(); }, opciones),
});
