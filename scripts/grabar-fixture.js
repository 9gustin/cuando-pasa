// Uso: node scripts/grabar-fixture.js SM02
// Graba respuestas reales en test/fixtures/arribos_completos_<P>.json para usar en los tests (sin API en vivo):
// proximos_arribos (uno por línea) + calcula_demora_de_linea de cada empresa (todos los coches).
// (No toca proximos_arribos_<P>.json: los tests viejos dependen de esa grabación del 13/11.)
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crearCliente } from '../server/tubondi/cliente.js';

const codigo = (process.argv[2] ?? 'SM02').toUpperCase();
let arribos = null;
const demoras = [];
// Se intercepta fetch solo para guardar el JSON crudo, con el mismo cliente (cola y sesión incluidas).
const cliente = crearCliente({
  log: () => {},
  fetchFn: async (url, op) => {
    const r = await fetch(url, op);
    const u = String(url);
    if (r.ok && u.includes('cmd=proximos_arribos')) arribos = JSON.parse(await r.clone().text());
    if (r.ok && u.includes('cmd=calcula_demora_de_linea')) {
      const json = JSON.parse(await r.clone().text());
      delete json.error; delete json.configuracion; // mensajes internos largos que no se usan
      demoras.push({ cliente: new URL(u).searchParams.get('cliente'), respuesta: json });
    }
    return r;
  },
});
const r = await cliente.arribosCompletos(codigo);
const grabado = new Date().toISOString();
const dir = (n) => fileURLToPath(new URL(`../test/fixtures/${n}`, import.meta.url));
await writeFile(dir(`arribos_completos_${codigo}.json`), JSON.stringify({ grabado, proximos_arribos: arribos, demoras }, null, 1));
console.log(`Grabado ${codigo}: ${arribos?.proximos_arribos?.length ?? 0} items de proximos_arribos, ` +
  `${demoras.map((d) => `${d.respuesta.proximos?.length ?? 0} de la empresa ${d.cliente}`).join(', ')} → ${r.datos.items.length} combinados`);
