import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearServicio, estimarFaltan } from '../server/simple/servicio.js';
import { hacerHandlers } from '../server/simple/manejar.js';
import { crearCliente, ErrorTuBondi } from '../server/tubondi/cliente.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/proximos_arribos_SM02.json', import.meta.url)));
const T0 = Date.parse(fixture.grabado);

const clienteFalso = ({ falla = false } = {}) => ({
  proximosArribos: async (codigo) => {
    if (falla) throw new ErrorTuBondi('caído', { codigo: 'red' });
    const items = codigo === 'SM02' ? fixture.respuesta.proximos_arribos : [];
    return { datos: { parada: codigo === 'SM02' ? fixture.respuesta.parada : { codigo, descripcion: `Parada ${codigo}` }, items }, desactualizado: false, obtenido: T0, deCache: false };
  },
  buscarDireccion: async () => ({ datos: [{ lat: -31.4017, lon: -64.1965, display_name: 'Bv Castro Barros y Europa' }] }),
  paradasCercanas: async () => ({ datos: [
    { codigo: 'LEJOS', parada_nombre: 'Lejos', lat: '-31.41', lon: '-64.19' },
    { codigo: 'SM02', parada_nombre: 'Av Castro Barros 443', lat: '-31.4011', lon: '-64.1966' },
    ...Array.from({ length: 12 }, (_, i) => ({ codigo: `X${i}`, parada_nombre: `X${i}`, lat: String(-31.402 - i * 0.001), lon: '-64.1965' })),
  ] }),
});

test('estimarFaltan: distancia/350 m; "Llegando" = 1; minutos incoherentes → sin dato', () => {
  assert.equal(estimarFaltan({ llegando: true, dist_m: 20, minutos: 0 }), 1);
  assert.equal(estimarFaltan({ llegando: false, dist_m: 700, minutos: 3 }), 2);
  assert.equal(estimarFaltan({ llegando: false, dist_m: 100, minutos: 3 }), 1);
  assert.equal(estimarFaltan({ llegando: false, dist_m: 800, minutos: 47 }), null); // cerca en línea recta pero tiene que dar la vuelta
  assert.equal(estimarFaltan({ llegando: false, dist_m: null, minutos: 5 }), null);
});

test('servicio simple: contrato de /api/parada con la fixture real, sin DB', async () => {
  const s = crearServicio({ cliente: clienteFalso() });
  const r = await s.proximos('SM02');
  assert.equal(r.parada.nombre, 'Av Castro Barros 443');
  assert.equal(r.parada.sentido, 'afuera');
  assert.ok(r.proximos.length >= 9);
  assert.ok(r.lineas.some((l) => l.linea === '13'));
  for (const p of r.proximos) {
    assert.match(p.hora, /^\d\d:\d\d$/);
    assert.ok(p.fuente_paradas === 'distancia' || (p.fuente_paradas === null && p.faltan_paradas === null));
  }
  const conDato = r.proximos.findIndex((p) => p.faltan_paradas === null);
  assert.ok(conDato === -1 || r.proximos.slice(conDato).every((p) => p.faltan_paradas === null), 'los sin dato van al final');
});

test('/paradas: ordenadas por cercanía, tope configurable', async () => {
  const s = crearServicio({ cliente: clienteFalso() });
  const todas = await s.paradas(-31.4017, -64.1965);
  assert.equal(todas.length, 8);
  for (let i = 1; i < todas.length; i++) assert.ok(todas[i].distancia_m >= todas[i - 1].distancia_m);
  assert.equal((await s.paradas(-31.4017, -64.1965, { max: 3 })).length, 3);
  assert.ok(!todas.some((p) => p.codigo === 'LEJOS'), 'la más lejana queda fuera del top 8');
  const bien = hacerHandlers({ servicio: () => s });
  const r = await llamar(bien.paradas, { url: '/api/paradas?lat=-31.4017&lon=-64.1965&max=5' });
  assert.equal(r.json.length, 5);
});

test('servicio simple: /buscar y /paradas', async () => {
  const s = crearServicio({ cliente: clienteFalso() });
  assert.equal((await s.buscar('castro barros y europa'))[0].texto, 'Bv Castro Barros y Europa');
  assert.deepEqual(await s.buscar('ab'), []);
  const ps = await s.paradas(-31.4017, -64.1965);
  assert.deepEqual(Object.keys(ps[0]).sort(), ['codigo', 'distancia_m', 'lat', 'lon', 'nombre']);
  assert.ok(ps.some((p) => p.codigo === 'SM02'));
});

// --- handlers de Vercel con req/res falsos ---
async function llamar(handler, { metodo = 'GET', url = '/', query } = {}) {
  const res = { headers: {}, statusCode: 200, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b ?? ''; } };
  await handler({ method: metodo, url, query }, res);
  return { estado: res.statusCode, json: res.body ? JSON.parse(res.body) : null, res };
}

test('handlers: parada válida, inválida, método incorrecto, Tu Bondi caído', async () => {
  const bien = hacerHandlers({ servicio: () => crearServicio({ cliente: clienteFalso() }) });
  const ok = await llamar(bien.parada, { url: '/api/parada/sm02', query: { codigo: 'sm02' } });
  assert.equal(ok.estado, 200);
  assert.equal(ok.json.parada.codigo, 'SM02');
  assert.equal((await llamar(bien.parada, { url: '/api/parada/SM02' })).json.parada.codigo, 'SM02', 'sin req.query, desde la URL');
  assert.equal((await llamar(bien.parada, { url: '/api/parada/a%20b' })).estado, 400);
  assert.equal((await llamar(bien.parada, { metodo: 'POST', url: '/api/parada/SM02' })).estado, 405);
  assert.equal((await llamar(bien.paradas, { url: '/api/paradas?lat=x&lon=1' })).estado, 400);
  assert.equal((await llamar(bien.activar, { metodo: 'POST', url: '/api/parada/SM02/activar' })).estado, 204);
  assert.equal((await llamar(bien.salud, { url: '/salud' })).json.ok, true);

  const mal = hacerHandlers({ servicio: () => crearServicio({ cliente: clienteFalso({ falla: true }) }) });
  const caido = await llamar(mal.parada, { url: '/api/parada/SM02' });
  assert.equal(caido.estado, 502);
  assert.ok(!JSON.stringify(caido.json).includes('caído'));
  assert.equal(caido.res.headers['cache-control'], 'no-store');
});

test('cliente con ttlArribosMs: 0 no cachea proximos_arribos', async () => {
  let pedidos = 0;
  const fetchFn = async (u) => {
    if (String(u).includes('urbano.php')) return new Response('x', { headers: { 'set-cookie': 'PHPSESSID=a' } });
    pedidos++;
    return Response.json(fixture.respuesta);
  };
  const c = crearCliente({ fetchFn, ttlArribosMs: 0, intervaloMs: 1, log: () => {} });
  await c.proximosArribos('SM02'); await c.proximosArribos('SM02');
  assert.equal(pedidos, 2);
});
