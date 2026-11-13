// Nuevo viaje: esquina → sugerencias → paradas cercanas con sentido y líneas (PLAN §6.4).
import { distanciaM } from '../tubondi/normalizar.js';

const MAX_PARADAS = 4; // cada una cuesta un proximos_arribos (cacheado) para saber el sentido y las líneas

export function crearServicioBuscar({ cliente, db, servicio }) {
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
      try { coches = (await servicio.arribos(p.codigo)).coches; } catch { /* sin datos de esa parada ahora */ }
      const fila = db.prepare('SELECT sentido FROM parada WHERE codigo = ?').get(p.codigo);
      salida.push({
        ...p,
        sentido: fila?.sentido ?? '?',
        lineas: servicio.lineasDe(p.codigo, coches).map(({ linea, destino }) => ({ linea, destino })),
      });
    }
    return salida;
  }

  return { buscar, paradas };
}
