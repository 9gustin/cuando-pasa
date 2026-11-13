// Uso: node scripts/grabar-fixture.js SM02
// Graba UNA respuesta real de proximos_arribos en test/fixtures/ para usar en los tests (sin API en vivo).
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crearCliente } from '../server/tubondi/cliente.js';

const codigo = (process.argv[2] ?? 'SM02').toUpperCase();
let crudo = null;
// Se intercepta fetch solo para guardar el JSON crudo, con el mismo cliente (cola y sesión incluidas).
const cliente = crearCliente({
  log: () => {},
  fetchFn: async (url, op) => {
    const r = await fetch(url, op);
    if (String(url).includes('cmd=proximos_arribos') && r.ok) {
      const txt = await r.clone().text();
      crudo = JSON.parse(txt);
    }
    return r;
  },
});
await cliente.proximosArribos(codigo);
const destino = fileURLToPath(new URL(`../test/fixtures/proximos_arribos_${codigo}.json`, import.meta.url));
await writeFile(destino, JSON.stringify({ grabado: new Date().toISOString(), respuesta: crudo }, null, 1));
console.log(`Grabado ${destino} (${crudo?.proximos_arribos?.length ?? 0} items)`);
