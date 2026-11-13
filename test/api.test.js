import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { abrirDb } from '../server/db.js';
import { crearServidor } from '../server/http.js';
import { crearRutas } from '../server/index.js';
import { crearServicioParada } from '../server/servicios/parada.js';
import { crearServicioBuscar } from '../server/servicios/buscar.js';
import { ErrorTuBondi } from '../server/tubondi/cliente.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/proximos_arribos_SM02.json', import.meta.url)));
const T0 = Date.parse(fixture.grabado);

function montar({ falla = false } = {}) {
  const db = abrirDb(':memory:');
  const cliente = {
    proximosArribos: async (codigo) => {
      if (falla) throw new ErrorTuBondi('caído', { codigo: 'red' });
      const items = codigo === 'SM02' ? fixture.respuesta.proximos_arribos : [];
      return { datos: { parada: { codigo, descripcion: `Parada ${codigo}` }, items }, desactualizado: false, obtenido: T0, deCache: false };
    },
    buscarDireccion: async () => ({ datos: [{ lat: -31.4017, lon: -64.1965, display_name: 'Bv Castro Barros y Europa' }] }),
    paradasCercanas: async () => ({ datos: [
      { codigo: 'PR01', parada_nombre: 'Av Castro Barros 405', lat: '-31.4011', lon: '-64.1967' },
      { codigo: 'SM02', parada_nombre: 'Av Castro Barros 443', lat: '-31.4011', lon: '-64.1966' },
    ] }),
    estado: () => ({ tubondi: 'ok', ultima_respuesta_ok: null }),
  };
  const parada = crearServicioParada({ cliente, db });
  const buscar = crearServicioBuscar({ cliente, db, servicio: parada });
  const aprendidas = [];
  const tareas = { aprender: (c) => aprendidas.push(c) };
  return { db, aprendidas, rutas: crearRutas({ cliente, db, parada, buscar, tareas }) };
}

async function conApi(opts, fn) {
  const m = montar(opts);
  const s = crearServidor({ rutas: m.rutas });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${s.address().port}`, m); } finally { s.close(); s.closeAllConnections?.(); }
}

test('GET /api/parada/SM02 devuelve el contrato de §7', async () => {
  await conApi({}, async (base) => {
    const r = await fetch(`${base}/api/parada/sm02`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(Object.keys(j).sort(), ['actualizado', 'desactualizado', 'lineas', 'parada', 'proximos']);
    assert.equal(j.parada.codigo, 'SM02');
    assert.ok(j.proximos.length > 0);
    assert.deepEqual(Object.keys(j.proximos[0]).filter((k) => k !== 'desvio').sort(),
      ['color', 'coche', 'destino', 'faltan_paradas', 'fuente_paradas', 'hora', 'linea', 'minutos'].sort());
  });
});

test('código inválido → 400; coordenadas inválidas → 400', async () => {
  await conApi({}, async (base) => {
    assert.equal((await fetch(`${base}/api/parada/a%20b`)).status, 400);
    assert.equal((await fetch(`${base}/api/paradas?lat=x&lon=1`)).status, 400);
    assert.equal((await fetch(`${base}/api/paradas?lat=99&lon=1`)).status, 400);
  });
});

test('Tu Bondi caído → 502 con mensaje (sin filtrar el error interno)', async () => {
  await conApi({ falla: true }, async (base) => {
    const r = await fetch(`${base}/api/parada/SM02`);
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(await r.json()).includes('caído'));
  });
});

test('POST /activar → 204, marca la parada y dispara el aprendizaje', async () => {
  await conApi({}, async (base, m) => {
    const r = await fetch(`${base}/api/parada/sm02/activar`, { method: 'POST' });
    assert.equal(r.status, 204);
    assert.equal(m.db.prepare('SELECT COUNT(*) c FROM parada_activa WHERE parada = ?').get('SM02').c, 1);
    assert.deepEqual(m.aprendidas, ['SM02']);
  });
});

test('/api/buscar y /api/paradas (con sentido y líneas)', async () => {
  await conApi({}, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/buscar?q=castro%20barros%20y%20europa`)).json(),
      [{ texto: 'Bv Castro Barros y Europa', lat: -31.4017, lon: -64.1965 }]);
    assert.deepEqual(await (await fetch(`${base}/api/buscar?q=ab`)).json(), []);
    const ps = await (await fetch(`${base}/api/paradas?lat=-31.4017&lon=-64.1965`)).json();
    assert.equal(ps.length, 2);
    const sm02 = ps.find((p) => p.codigo === 'SM02');
    assert.equal(sm02.sentido, 'afuera');
    assert.ok(sm02.lineas.some((l) => l.linea === '13'));
    assert.equal(typeof sm02.distancia_m, 'number');
    assert.equal(ps.find((p) => p.codigo === 'PR01').sentido, '?');
  });
});
