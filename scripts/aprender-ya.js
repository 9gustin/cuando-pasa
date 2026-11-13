// Uso: DB_PATH=/ruta/dev.db node scripts/aprender-ya.js SM02 [pasadas=1] [presupuesto=15]
// Corre pasadas de aprendizaje EN VIVO (cada una: hasta `presupuesto` pedidos reales a Tu Bondi, 1 por segundo)
// y muestra las previas aprendidas y las líneas vistas en la parada.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tuBondi } from '../server/tubondi/cliente.js';
import { abrirDb } from '../server/db.js';
import { crearServicioParada } from '../server/servicios/parada.js';
import { aprenderParada } from '../server/aprendizaje/tarea.js';

const codigo = (process.argv[2] ?? 'SM02').toUpperCase();
const pasadas = Number(process.argv[3] ?? 1);
const presupuesto = Number(process.argv[4] ?? 15);
const ruta = process.env.DB_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'cuando-pasa.db');

const cliente = tuBondi();
const db = abrirDb(ruta);
const servicio = crearServicioParada({ cliente, db });

for (let i = 1; i <= pasadas; i++) {
  const r = await aprenderParada(codigo, { cliente, servicio, db, presupuesto });
  console.log(`pasada ${i}: ${r.pedidos} pedidos, ${r.candidatas} candidatas, rutas: ${r.rutas.map((x) => `${x.linea}→${x.previas}`).join(' ') || '-'}`);
}

const previas = db.prepare(`SELECT p.linea, p.ruta, p.orden, p.parada, s.nombre, p.min_tipicos, p.confianza FROM previa p
  LEFT JOIN parada s ON s.codigo = p.parada WHERE p.parada_destino = ? ORDER BY p.linea, p.ruta, p.orden`).all(codigo);
console.log(`\nPrevias aprendidas para ${codigo}:`);
for (const p of previas) console.log(`  línea ${p.linea} ruta ${p.ruta} · #${p.orden} ${p.parada} ${p.nombre ?? ''} · ${p.min_tipicos.toFixed(1)} min · conf ${p.confianza.toFixed(2)}`);
const lineas = db.prepare('SELECT DISTINCT linea FROM linea_en_parada WHERE parada = ?').all(codigo).map((l) => l.linea);
console.log(`\nlinea_en_parada(${codigo}): ${lineas.sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ')}`);
console.log('estado del cliente:', JSON.stringify(cliente.estado()));
db.close();
