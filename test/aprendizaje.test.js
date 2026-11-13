import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abrirDb } from '../server/db.js';
import { deducirPrevias, aprenderPrevias, estaCompleta } from '../server/aprendizaje/ordenar.js';
import { registrarObservaciones, purgarObservaciones } from '../server/aprendizaje/observar.js';
import { aprenderParada } from '../server/aprendizaje/tarea.js';
import { calcularSentido } from '../server/servicios/sentido.js';
import { calcularFaltan } from '../server/servicios/faltan.js';
import { crearServicioParada } from '../server/servicios/parada.js';
import { normalizarArribos, destinoCorto } from '../server/tubondi/normalizar.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/proximos_arribos_SM02.json', import.meta.url)));
const T0 = Date.parse(fixture.grabado);
const hm = (h, m) => Date.parse(`2026-11-13T${String(h + 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`); // hora AR → ms

test('migraciones: crea las tablas y es idempotente', () => {
  const db = abrirDb(':memory:');
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  for (const t of ['parada', 'linea_en_parada', 'observacion', 'previa', 'parada_activa', 'suscripcion']) assert.ok(tablas.includes(t), t);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
});

// Datos reales del 13/11/2026 14:22 (SPEC §4.2): la 13 → C. Universitaria, coche 382.
test('ordenar: reproduce BG01 → BG02 → BG03 → BG04 → BG05 → PR01 con el coche 382 del 13/11', () => {
  const horas = { BG01: [14, 22], BG02: [14, 23], BG03: [14, 24], BG04: [14, 25], BG05: [14, 26], PR01: [14, 27] };
  const ts = hm(14, 21);
  const obs = Object.entries(horas).map(([parada, [h, m]]) => ({ ts, parada, coche: '382', hora_estimada: hm(h, m) }));
  const previas = deducirPrevias(obs, 'PR01', { n: 6 });
  assert.deepEqual(previas.map((p) => p.parada), ['BG05', 'BG04', 'BG03', 'BG02', 'BG01']); // orden 1 = la anterior a PR01
  assert.deepEqual(previas.map((p) => p.min_tipicos), [1, 2, 3, 4, 5]);
  assert.ok(previas.every((p) => p.confianza > 0 && p.confianza < 0.67), 'con un solo coche la confianza es baja');
});

test('ordenar: mediana entre coches, confianza sube, y se ignoran observaciones de otra pasada', () => {
  const obs = [];
  const add = (ts, coche, parada, min) => obs.push({ ts, parada, coche, hora_estimada: hm(15, min) });
  for (const [coche, base, ts] of [['1', 10, hm(15, 0)], ['2', 20, hm(15, 8)], ['3', 30, hm(15, 16)]]) {
    add(ts, coche, 'A', base); add(ts, coche, 'B', base + 2); add(ts, coche, 'P', base + 3);
  }
  add(hm(15, 30), '1', 'A', 50); // del mismo coche pero 30 min después: no se compara con P de las 15:00
  const previas = deducirPrevias(obs, 'P');
  assert.deepEqual(previas.map((p) => [p.parada, p.min_tipicos, p.confianza]), [['B', 1, 1], ['A', 3, 1]]);
});

test('ordenar: paradas que el coche pasa DESPUÉS (o a la misma hora) no son previas', () => {
  const ts = hm(10, 0);
  const obs = [
    { ts, parada: 'P', coche: '1', hora_estimada: hm(10, 10) },
    { ts, parada: 'POST', coche: '1', hora_estimada: hm(10, 14) },
    { ts, parada: 'MISMA', coche: '1', hora_estimada: hm(10, 10) },
  ];
  assert.deepEqual(deducirPrevias(obs, 'P'), []);
});

test('ordenar: corta la lista en un salto grande (faltan paradas en el medio)', () => {
  const ts = hm(10, 0);
  const obs = [['P', 10], ['A', 8], ['B', 5], ['LEJOS', -20]].map(([parada, m]) => ({ ts, parada, coche: '1', hora_estimada: hm(10, 10 + m) }));
  assert.deepEqual(deducirPrevias(obs, 'P').map((p) => p.parada), ['A', 'B']);
});

test('aprenderPrevias guarda en la base y estaCompleta exige n previas con confianza', () => {
  const db = abrirDb(':memory:');
  const ahora = hm(14, 30);
  const ins = db.prepare('INSERT INTO observacion (ts, parada, linea, ruta, coche, hora_estimada) VALUES (?,?,?,?,?,?)');
  for (const coche of ['1', '2', '3']) {
    const ts = hm(14, 20 + Number(coche));
    ['S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'P'].forEach((p, i) => ins.run(ts, p, '13', '9', coche, hm(14, 20 + Number(coche) + i)));
  }
  const prev = aprenderPrevias(db, 'P', '13', '9', { ahora });
  assert.equal(prev.length, 6);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM previa').get().c, 6);
  assert.equal(estaCompleta(db, 'P', '13', '9', { ahora }), true);
  assert.equal(estaCompleta(db, 'P', '13', '9', { ahora: ahora + 8 * 86_400_000 }), false, 'a la semana hay que re-verificar');
  assert.equal(estaCompleta(db, 'P', '18', '9', { ahora }), false);
});

test('observar: guarda parada, líneas y observaciones; no repite dentro del minuto; purga a los 30 días', () => {
  const db = abrirDb(':memory:');
  const coches = normalizarArribos(fixture.respuesta.proximos_arribos, T0);
  const n1 = registrarObservaciones(db, 'SM02', coches, { nombre: 'Av Castro Barros 443' }, T0);
  const n2 = registrarObservaciones(db, 'SM02', coches, { nombre: 'Av Castro Barros 443' }, T0 + 20_000);
  assert.equal(n1, coches.length);
  assert.equal(n2, 0);
  assert.equal(registrarObservaciones(db, 'SM02', coches, {}, T0 + 90_000), coches.length);
  assert.equal(db.prepare('SELECT nombre FROM parada WHERE codigo = ?').get('SM02').nombre, 'Av Castro Barros 443');
  const lineas = db.prepare('SELECT DISTINCT linea FROM linea_en_parada WHERE parada = ?').all('SM02').map((l) => l.linea).sort();
  assert.deepEqual(lineas, ['10', '11', '12', '13', '14', '15', '17', '18', '19', '83']);
  assert.ok(purgarObservaciones(db, 30, T0 + 31 * 86_400_000) > 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM observacion').get().c, 0);
});

test('sentido: SM02 con los coches reales viene "afuera"; si los coches vienen de lejos es "centro"', () => {
  const coches = normalizarArribos(fixture.respuesta.proximos_arribos, T0);
  const parada = { lat: coches[0].parada_lat, lon: coches[0].parada_lon };
  assert.equal(calcularSentido(parada, coches), 'afuera');
  assert.equal(calcularSentido(parada, []), '?');
  // coches claramente más lejos del centro (Plaza San Martín) que la parada → "centro"
  const lejos = [{ coche_lat: -31.30, coche_lon: -64.30 }, { coche_lat: -31.31, coche_lon: -64.29 }];
  assert.equal(calcularSentido(parada, lejos), 'centro');
});

test('destinoCorto', () => {
  assert.equal(destinoCorto('C. UNIVERSITARIA A SALDAN'), 'Saldan');
  assert.equal(destinoCorto('ITUZAINGO A NUEVA ESPERANZA.'), 'Nueva Esperanza');
  assert.equal(destinoCorto('1° DE MAYO A POLICIAL'), 'Policial');
});

// --- paradas que faltan ---
// Calle recta Norte→Sur sobre un meridiano: P en lat -31.40; previas cada ~0,001° (≈110 m) hacia el norte.
const P = { lat: -31.400, lon: -64.2 };
const previas = [1, 2, 3, 4, 5, 6].map((o) => ({ orden: o, lat: -31.400 + 0.001 * o, lon: -64.2, min_tipicos: o * 1.0 }));
const coche = (lat, minutos = 5) => ({ coche_lat: lat, coche_lon: -64.2, minutos });

test('faltan por GPS: entre la previa 2 y la 1 → faltan 2 (la 1 y la tuya)', () => {
  assert.deepEqual(calcularFaltan(coche(-31.3985), previas, P), { faltan: 2, fuente: 'gps' });
  assert.deepEqual(calcularFaltan(coche(-31.3995), previas, P), { faltan: 1, fuente: 'gps' }); // justo después de la anterior a P
  assert.deepEqual(calcularFaltan(coche(-31.3945), previas, P), { faltan: 6, fuente: 'gps' });
});

test('faltan: coche más lejos de lo aprendido → sin dato; GPS fuera del recorrido → minutos', () => {
  assert.deepEqual(calcularFaltan(coche(-31.3700, 30), previas, P), { faltan: null, fuente: null });
  const desviado = { coche_lat: -31.3985, coche_lon: -64.19, minutos: 2.5 }; // ~950 m al costado
  assert.deepEqual(calcularFaltan(desviado, previas, P), { faltan: 3, fuente: 'minutos' });
  assert.deepEqual(calcularFaltan(coche(-31.3985), [], P), { faltan: null, fuente: null });
});

// --- servicio y aprendizaje con un cliente falso hecho con la fixture real ---
function clienteFalso() {
  const llamadas = { arribos: [], cercanas: [] };
  return {
    llamadas,
    proximosArribos: async (codigo) => {
      llamadas.arribos.push(codigo);
      const base = fixture.respuesta;
      // otras paradas: la misma lista pero sin coches (solo cuenta que respondan)
      const datos = codigo === 'SM02' ? { parada: base.parada, items: base.proximos_arribos } : { parada: { codigo, descripcion: `Parada ${codigo}` }, items: [] };
      return { datos, desactualizado: false, obtenido: T0, deCache: false };
    },
    paradasCercanas: async () => { llamadas.cercanas.push(1); return { datos: [], desactualizado: false, obtenido: T0, deCache: false }; },
    estado: () => ({ tubondi: 'ok', ultima_respuesta_ok: null }),
  };
}

test('servicio parada: lista única con el contrato de PLAN §7 (todos "sin dato" al principio)', async () => {
  const db = abrirDb(':memory:');
  const servicio = crearServicioParada({ cliente: clienteFalso(), db });
  const r = await servicio.proximos('SM02');
  assert.equal(r.parada.codigo, 'SM02');
  assert.equal(r.parada.nombre, 'Av Castro Barros 443');
  assert.equal(r.parada.sentido, 'afuera');
  assert.equal(r.desactualizado, false);
  assert.deepEqual([...new Set(r.lineas.map((l) => l.linea))], ['10', '11', '12', '13', '14', '15', '17', '18', '19', '83']);
  assert.ok(r.proximos.length >= 9);
  for (const p of r.proximos) {
    assert.match(p.hora, /^\d\d:\d\d$/);
    assert.equal(p.faltan_paradas, null);
    assert.ok(p.minutos >= 0);
  }
  const horas = r.proximos.map((p) => p.hora);
  assert.deepEqual(horas, [...horas].sort());
});

test('servicio parada: con previas aprendidas usa GPS y ordena primero los que tienen dato', async () => {
  const db = abrirDb(':memory:');
  const servicio = crearServicioParada({ cliente: clienteFalso(), db });
  await servicio.proximos('SM02'); // registra la parada con sus coordenadas
  const coches = normalizarArribos(fixture.respuesta.proximos_arribos, T0);
  const elegido = coches[coches.length - 1]; // un coche lejano, para forzar que el orden cambie
  const pp = db.prepare('SELECT lat, lon FROM parada WHERE codigo = ?').get('SM02');
  // una previa 'X1' justo donde está el coche elegido y otra más cerca de la parada
  db.prepare('INSERT INTO parada (codigo, nombre, lat, lon, actualizado) VALUES (?,?,?,?,?)').run('X1', 'x', elegido.coche_lat, elegido.coche_lon, T0);
  db.prepare('INSERT INTO parada (codigo, nombre, lat, lon, actualizado) VALUES (?,?,?,?,?)').run('X0', 'y', (pp.lat + elegido.coche_lat) / 2, (pp.lon + elegido.coche_lon) / 2, T0);
  const ins = db.prepare('INSERT INTO previa VALUES (?,?,?,?,?,?,?,?)');
  ins.run('SM02', elegido.linea, elegido.ruta, 1, 'X0', 3, 1, T0);
  ins.run('SM02', elegido.linea, elegido.ruta, 2, 'X1', 6, 1, T0);
  const r = await servicio.proximos('SM02');
  assert.equal(r.proximos[0].coche, elegido.coche, 'el que tiene dato va primero aunque sea el más lejano');
  assert.equal(r.proximos[0].fuente_paradas, 'gps');
  assert.ok(r.proximos[0].faltan_paradas >= 1);
  assert.ok(r.proximos.slice(1).every((p) => p.faltan_paradas === null || p.coche !== elegido.coche));
});

test('el desvío sale decodificado (sin entidades)', async () => {
  const servicio = crearServicioParada({ cliente: clienteFalso(), db: abrirDb(':memory:') });
  const r = await servicio.proximos('SM02');
  const con = r.proximos.filter((p) => p.desvio);
  assert.ok(con.length > 0);
  for (const p of con) assert.ok(!/&#\d+;|\r|\n/.test(p.desvio));
});

test('aprenderParada respeta el presupuesto de pedidos', async () => {
  const db = abrirDb(':memory:');
  const cliente = clienteFalso();
  const servicio = crearServicioParada({ cliente, db });
  const r = await aprenderParada('SM02', { cliente, servicio, db, presupuesto: 4, ahora: () => T0 });
  assert.ok(r.pedidos <= 4 + 1, `pedidos ${r.pedidos}`);
  assert.ok(cliente.llamadas.cercanas.length >= 1);
  assert.ok(r.rutas.length >= 1);
});
