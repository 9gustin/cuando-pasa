// Uso: node scripts/probar.js SM02 [repeticiones=1]
// Pide los próximos colectivos de una parada a Tu Bondi (en vivo) e imprime la lista normalizada.
// Con repeticiones > 1 hace llamadas seguidas para comprobar la caché y la deduplicación.
import { crearCliente } from '../server/tubondi/cliente.js';
import { normalizarArribos } from '../server/tubondi/normalizar.js';

const codigo = (process.argv[2] ?? 'SM02').toUpperCase();
const n = Math.max(1, Number(process.argv[3] ?? 1));
const silencioso = process.argv.includes('--log') ? undefined : () => {};
const cliente = crearCliente({ log: silencioso });

const resultados = await Promise.all(Array.from({ length: n }, () => cliente.proximosArribos(codigo)));
const { datos, desactualizado } = resultados[0];
const lista = normalizarArribos(datos.items, Date.now());

console.log(`Parada ${codigo}${datos.parada?.descripcion ? ` · ${datos.parada.descripcion}` : ''}${desactualizado ? ' (DESACTUALIZADO)' : ''}`);
console.log('hora  | en   | línea | destino                          | coche | dist');
for (const a of lista) {
  console.log(`${a.hora} | ${String(a.minutos).padStart(2)}m  | ${a.linea.padEnd(5)} | ${a.destino.slice(0, 32).padEnd(32)} | ${a.coche.padEnd(5)} | ${a.dist_m ?? '?'} m${a.desvio ? '  ⚠ desvío' : ''}`);
}
if (!lista.length) console.log('(no viene ningún bondi con GPS)');
const e = cliente.estado();
console.log(`\n${n} llamada(s) → pedidos reales a Tu Bondi (incluye sesión): ${e.pedidos} · sesiones: ${e.sesiones} · caché: ${e.deCache} · deduplicados: ${e.deduplicados}`);
