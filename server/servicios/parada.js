// Lista única de próximos colectivos de una parada (PLAN §6.1 y §7).
import { normalizarArribos } from '../tubondi/normalizar.js';
import { registrarObservaciones } from '../aprendizaje/observar.js';
import { calcularSentido } from './sentido.js';
import { calcularFaltan } from './faltan.js';

const ordenLinea = (a, b) => a.localeCompare(b, 'es', { numeric: true });

export function crearServicioParada({ cliente, db, ahora = () => Date.now() }) {
  /**
   * Un pedido (con caché) a Tu Bondi + registro de observaciones + sentido.
   * Lo usan la API y la tarea de aprendizaje, así toda observación sale de pedidos que ya se hacían.
   */
  async function arribos(codigo) {
    const r = await cliente.proximosArribos(codigo);
    const coches = normalizarArribos(r.datos.items, r.obtenido);
    const nombre = r.datos.parada?.descripcion ?? null;
    if (!r.desactualizado) {
      registrarObservaciones(db, codigo, coches, { nombre }, r.obtenido);
      const fila = db.prepare('SELECT sentido, lat, lon FROM parada WHERE codigo = ?').get(codigo);
      if (fila && (fila.sentido == null || fila.sentido === '?') && coches.length) {
        const sentido = calcularSentido({ lat: fila.lat, lon: fila.lon }, coches);
        db.prepare('UPDATE parada SET sentido = ? WHERE codigo = ?').run(sentido, codigo);
      }
    }
    return { coches, nombre, desactualizado: r.desactualizado, obtenido: r.obtenido, deCache: r.deCache };
  }

  function previasDe(codigo) {
    const filas = db.prepare(`SELECT p.linea, p.ruta, p.orden, p.min_tipicos, s.lat, s.lon FROM previa p
      LEFT JOIN parada s ON s.codigo = p.parada WHERE p.parada_destino = ? ORDER BY p.linea, p.ruta, p.orden`).all(codigo);
    const m = new Map();
    for (const f of filas) {
      const k = `${f.linea}|${f.ruta}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f);
    }
    return m;
  }

  function lineasDe(codigo, coches) {
    const filas = db.prepare('SELECT linea, destino, color FROM linea_en_parada WHERE parada = ?').all(codigo);
    const vistas = new Map();
    for (const f of [...filas, ...coches]) {
      const k = `${f.linea}|${f.destino}`;
      if (!vistas.has(k)) vistas.set(k, { linea: f.linea, destino: f.destino, color: f.color ?? null });
    }
    return [...vistas.values()].sort((a, b) => ordenLinea(a.linea, b.linea) || a.destino.localeCompare(b.destino));
  }

  /** El JSON de GET /api/parada/:codigo. */
  async function proximos(codigo) {
    const r = await arribos(codigo);
    const fila = db.prepare('SELECT nombre, lat, lon, sentido FROM parada WHERE codigo = ?').get(codigo);
    const previas = previasDe(codigo);
    const destino = { lat: fila?.lat, lon: fila?.lon };

    const filas = r.coches.map((c) => {
      const { faltan, fuente } = calcularFaltan(c, previas.get(`${c.linea}|${c.ruta}`) ?? [], destino);
      return {
        linea: c.linea, destino: c.destino, color: c.color, coche: c.coche,
        hora: c.hora, minutos: c.minutos, faltan_paradas: faltan, fuente_paradas: fuente,
        ...(c.desvio ? { desvio: c.desvio } : {}), _t: c.instante,
      };
    });
    // Primero los que tienen dato de paradas (por hora), después los que no (por hora).
    const conDato = filas.filter((f) => f.faltan_paradas !== null).sort((a, b) => a._t - b._t);
    const sinDato = filas.filter((f) => f.faltan_paradas === null).sort((a, b) => a._t - b._t);
    const proximosOrdenados = [...conDato, ...sinDato].map(({ _t, ...f }) => f);

    return {
      parada: {
        codigo, nombre: fila?.nombre ?? r.nombre ?? codigo,
        sentido: fila?.sentido ?? '?',
      },
      actualizado: new Date(r.obtenido).toISOString(),
      desactualizado: r.desactualizado,
      lineas: lineasDe(codigo, r.coches),
      proximos: proximosOrdenados,
    };
  }

  return { arribos, proximos, previasDe, lineasDe };
}
