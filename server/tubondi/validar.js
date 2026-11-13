// Chequeo del formato de las respuestas de Tu Bondi (API no oficial: puede cambiar sin aviso).
// Si algo no cuadra se lanza ErrorFormato con un mensaje claro; el cliente lo cuenta como falla.

export class ErrorFormato extends Error {
  constructor(cmd, detalle) {
    super(`Tu Bondi cambió algo: ${cmd}: ${detalle}`);
    this.name = 'ErrorFormato';
    this.cmd = cmd;
  }
}

const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const esTexto = (x) => typeof x === 'string';
const esNumeroLike = (x) => (typeof x === 'number' && Number.isFinite(x)) ||
  (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x));

/** Devuelve el motivo por el que un item de proximos_arribos no sirve, o null si está bien. */
export function problemaItemArribo(a) {
  if (!esObjeto(a)) return 'no es un objeto';
  for (const campo of ['coche', 'linea_nombre', 'ruta']) {
    if (!esTexto(a[campo]) && typeof a[campo] !== 'number') return `falta ${campo}`;
  }
  if (!esTexto(a.ruta_descripcion)) return 'falta ruta_descripcion';
  if (!Array.isArray(a.a) || a.a.length < 4 || !a.a.slice(0, 4).every(esNumeroLike)) return 'a no es [lat,lon,lat,lon]';
  if (a.horaTeoricaAjustada != null && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(a.horaTeoricaAjustada)) return 'horaTeoricaAjustada no es HH:MM:SS';
  if (a.horaTeoricaAjustada == null && !esTexto(a.proximo)) return 'no hay hora ni proximo';
  if (a.dist_parada != null && !esNumeroLike(a.dist_parada)) return 'dist_parada no es número';
  return null;
}

/**
 * proximos_arribos → { parada, items, descartados }.
 * Un item roto se descarta; si TODOS están rotos, es un cambio de formato y se lanza el error.
 */
export function validarArribos(json) {
  const cmd = 'proximos_arribos';
  if (!esObjeto(json)) throw new ErrorFormato(cmd, 'la respuesta no es un objeto');
  // Parada sin rutas: {"ok":false,"errorMsg":"No hay rutas que pasen por la parada"} (visto en vivo con CE26)
  if (json.ok === false && typeof json.errorMsg === 'string') return { parada: null, items: [], descartados: 0, sinRutas: true };
  let lista = json.proximos_arribos;
  if (lista == null && esObjeto(json.parada)) lista = []; // parada sin coches
  if (!Array.isArray(lista)) throw new ErrorFormato(cmd, 'falta proximos_arribos (lista)');
  const items = [];
  const motivos = [];
  for (const a of lista) {
    const p = problemaItemArribo(a);
    if (p) motivos.push(p); else items.push(a);
  }
  if (lista.length > 0 && items.length === 0) throw new ErrorFormato(cmd, `todos los items inválidos (${motivos[0]})`);
  return { parada: esObjeto(json.parada) ? json.parada : null, items, descartados: motivos.length };
}

export function validarParadasCercanas(json) {
  const cmd = 'paradas_cercanas';
  if (!esObjeto(json) || !Array.isArray(json.paradas)) throw new ErrorFormato(cmd, 'falta paradas (lista)');
  const ok = json.paradas.filter((p) => esObjeto(p) && esTexto(p.codigo) && esTexto(p.parada_nombre) &&
    esNumeroLike(p.lat) && esNumeroLike(p.lon));
  if (json.paradas.length > 0 && ok.length === 0) throw new ErrorFormato(cmd, 'todas las paradas son inválidas');
  return ok;
}

export function validarBusqueda(json) {
  const cmd = 'buscar_direccion';
  if (!Array.isArray(json)) throw new ErrorFormato(cmd, 'la respuesta no es una lista');
  const ok = json.filter((d) => esObjeto(d) && esNumeroLike(d.lat) && esNumeroLike(d.lon) && esTexto(d.display_name));
  if (json.length > 0 && ok.length === 0) throw new ErrorFormato(cmd, 'ningún resultado tiene lat/lon/display_name');
  return ok;
}

export function validarLineas(json) {
  const cmd = 'lineasyrutas';
  if (!esObjeto(json) || !Array.isArray(json.lineas)) throw new ErrorFormato(cmd, 'falta lineas (lista)');
  const ok = json.lineas.filter((l) => esObjeto(l) && esTexto(l.linea_nombre));
  if (json.lineas.length > 0 && ok.length === 0) throw new ErrorFormato(cmd, 'ninguna línea tiene linea_nombre');
  return ok;
}
