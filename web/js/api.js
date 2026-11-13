// Llamadas a nuestra API (mismo origen). Los errores llevan un mensaje listo para mostrar.

export class ErrorApi extends Error {
  constructor(mensaje, { estado = 0, formato = false } = {}) { super(mensaje); this.estado = estado; this.formato = formato; }
}

async function pedir(ruta, opciones = {}) {
  let r;
  try { r = await fetch(ruta, { ...opciones, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ErrorApi('No hay conexión con el servidor.'); }
  if (r.status === 204) return null;
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) throw new ErrorApi(cuerpo?.error ?? `Error ${r.status}`, { estado: r.status, formato: !!cuerpo?.formato });
  return cuerpo;
}

export const buscar = (q) => pedir(`/api/buscar?q=${encodeURIComponent(q)}`);
export const paradasCerca = (lat, lon) => pedir(`/api/paradas?lat=${lat}&lon=${lon}`);
export const parada = (codigo) => pedir(`/api/parada/${encodeURIComponent(codigo)}`);
export const activar = (codigo) => pedir(`/api/parada/${encodeURIComponent(codigo)}/activar`, { method: 'POST' }).catch(() => null);
