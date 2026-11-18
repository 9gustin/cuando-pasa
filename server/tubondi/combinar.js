// Junta proximos_arribos (un coche por línea, con nombre, destino y desvíos) con calcula_demora_de_linea
// (todos los coches que van a pasar por la parada, pero solo con el id interno de la línea).
// Resultado: items con la forma de proximos_arribos, sin coches repetidos.

/**
 * @param items  items validados de proximos_arribos
 * @param demoras [{ cliente, items }] items validados de calcula_demora_de_linea, uno por empresa
 * @returns { items, agregados, sinLinea }
 */
export function combinarArribos(items, demoras) {
  // Lo que se sabe de cada línea (por empresa + id de línea + sentido; y sin sentido como respaldo).
  const info = new Map();
  for (const a of items) {
    const base = {
      linea_nombre: a.linea_nombre, ruta: a.ruta, ruta_descripcion: a.ruta_descripcion, color: a.color,
      cliente: a.cliente, cliente_nombre: a.cliente_nombre, notificacion: a.notificacion,
    };
    const conSentido = `${a.cliente}|${a.linea}|${a.sentido}`;
    const sinSentido = `${a.cliente}|${a.linea}`;
    if (!info.has(conSentido)) info.set(conSentido, base);
    if (!info.has(sinSentido)) info.set(sinSentido, base);
  }

  const vistos = new Set(items.map((a) => `${a.linea_nombre}|${a.coche}`));
  const salida = [...items];
  let agregados = 0;
  let sinLinea = 0;
  for (const { cliente, items: lista } of demoras) {
    for (const d of lista) {
      // Solo se suman coches de líneas que proximos_arribos confirma para ESTA parada y sentido.
      const base = info.get(`${cliente}|${d.linea}|${d.sentido}`) ?? info.get(`${cliente}|${d.linea}`);
      if (!base) { sinLinea++; continue; }
      const clave = `${base.linea_nombre}|${d.coche}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({ ...d, ...base });
      agregados++;
    }
  }
  return { items: salida, agregados, sinLinea };
}
