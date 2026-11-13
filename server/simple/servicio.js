// Versión MVP sin base de datos ni aprendizaje (para Vercel): solo consulta a Tu Bondi cuando el usuario abre o actualiza.
// "Paradas que faltan" se estima por distancia en línea recta al coche (~350 m por parada) y se marca como aproximado.
import { crearCliente, ErrorTuBondi } from '../tubondi/cliente.js';
import { ErrorFormato } from '../tubondi/validar.js';
import { normalizarArribos, distanciaM } from '../tubondi/normalizar.js';
import { calcularSentido } from '../servicios/sentido.js';

const METROS_POR_PARADA = 350;
const MAX_PARADAS = 4;
export const CODIGO = /^[A-Za-z0-9]{2,8}$/;

/**
 * Faltan ≈ distancia / 350 m. Si los minutos de Tu Bondi no cuadran con la distancia (un coche cerca en línea recta pero
 * que tiene que dar toda la vuelta, o que todavía no salió), no se inventa un número: queda "sin dato".
 */
export function estimarFaltan(coche) {
  if (coche.llegando) return 1;
  if (coche.dist_m == null) return null;
  if (coche.minutos > coche.dist_m / 120 + 6) return null;
  return Math.max(1, Math.round(coche.dist_m / METROS_POR_PARADA));
}

export function crearServicio({ cliente = crearCliente({ ttlArribosMs: 0, log: () => {} }) } = {}) {
  async function arribos(codigo) {
    const r = await cliente.proximosArribos(codigo);
    return { coches: normalizarArribos(r.datos.items, r.obtenido), nombre: r.datos.parada?.descripcion ?? null, ...r };
  }

  const lineasDe = (coches) => {
    const m = new Map();
    for (const c of coches) {
      const k = `${c.linea}|${c.destino}`;
      if (!m.has(k)) m.set(k, { linea: c.linea, destino: c.destino, color: c.color });
    }
    return [...m.values()].sort((a, b) => a.linea.localeCompare(b.linea, 'es', { numeric: true }) || a.destino.localeCompare(b.destino));
  };

  async function proximos(codigo) {
    const r = await arribos(codigo);
    const filas = r.coches.map((c) => {
      const faltan = estimarFaltan(c);
      return {
        linea: c.linea, destino: c.destino, color: c.color, coche: c.coche, hora: c.hora, minutos: c.minutos,
        faltan_paradas: faltan, fuente_paradas: faltan === null ? null : 'distancia',
        ...(c.desvio ? { desvio: c.desvio } : {}), _t: c.instante,
      };
    });
    const ordenadas = [...filas.filter((f) => f.faltan_paradas !== null), ...filas.filter((f) => f.faltan_paradas === null)];
    const primera = r.coches[0];
    return {
      parada: {
        codigo, nombre: r.nombre ?? codigo,
        sentido: primera ? calcularSentido({ lat: primera.parada_lat, lon: primera.parada_lon }, r.coches) : '?',
      },
      actualizado: new Date(r.obtenido).toISOString(),
      desactualizado: r.desactualizado,
      lineas: lineasDe(r.coches),
      proximos: ordenadas.map(({ _t, ...f }) => f),
    };
  }

  async function buscar(q) {
    const texto = String(q ?? '').trim();
    if (texto.length < 3 || texto.length > 120) return [];
    const r = await cliente.buscarDireccion(texto);
    return r.datos.slice(0, 5).map((d) => ({ texto: d.display_name, lat: Number(d.lat), lon: Number(d.lon) }));
  }

  async function paradas(lat, lon) {
    const r = await cliente.paradasCercanas(lat, lon);
    const cercanas = r.datos
      .map((p) => ({ codigo: p.codigo, nombre: p.parada_nombre, lat: Number(p.lat), lon: Number(p.lon) }))
      .map((p) => ({ ...p, distancia_m: Math.round(distanciaM(lat, lon, p.lat, p.lon)) }))
      .sort((a, b) => a.distancia_m - b.distancia_m)
      .slice(0, MAX_PARADAS);
    const salida = [];
    for (const p of cercanas) {
      let coches = [];
      try { coches = (await arribos(p.codigo)).coches; } catch { /* sin datos de esa parada ahora */ }
      salida.push({
        ...p,
        sentido: coches.length ? calcularSentido(p, coches) : '?',
        lineas: lineasDe(coches).map(({ linea, destino }) => ({ linea, destino })),
      });
    }
    return salida;
  }

  return { proximos, buscar, paradas };
}

/** Traduce errores a respuestas HTTP (sin filtrar detalles internos). */
export function aRespuestaError(e) {
  if (e instanceof ErrorFormato) return [502, { error: 'Tu Bondi cambió algo y no pudimos leer los datos.', formato: true }];
  if (e instanceof ErrorTuBondi) return [502, { error: 'Tu Bondi no responde ahora. Probá de nuevo en un rato.' }];
  return [500, { error: 'Error interno' }];
}

let compartido = null;
/** Un solo servicio por instancia "caliente" de la función (así se reutiliza la sesión de Tu Bondi). */
export const servicioCompartido = () => (compartido ??= crearServicio());
