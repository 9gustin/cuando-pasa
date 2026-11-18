// Coches que faltaban: proximos_arribos trae uno por línea; calcula_demora_de_linea trae todos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { combinarArribos } from '../server/tubondi/combinar.js';
import { validarArribos, validarDemoras } from '../server/tubondi/validar.js';
import { normalizarArribos, maxPorLinea } from '../server/tubondi/normalizar.js';
import { crearCliente } from '../server/tubondi/cliente.js';
import { crearServicio } from '../server/simple/servicio.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/arribos_completos_SM02.json', import.meta.url)));
const T0 = Date.parse(fx.grabado);
const arr = validarArribos(fx.proximos_arribos);
const demoras = fx.demoras.map((d) => ({ cliente: d.cliente, items: validarDemoras(d.respuesta).items }));

test('fixture real: proximos_arribos trae UN coche por línea', () => {
  const porLinea = new Map();
  for (const a of arr.items) porLinea.set(a.linea_nombre, (porLinea.get(a.linea_nombre) ?? new Set()).add(a.coche));
  assert.ok([...porLinea.values()].every((s) => s.size === 1));
});

test('combinarArribos: suma los otros coches de cada línea, sin repetir y con nombre y destino', () => {
  const c = combinarArribos(arr.items, demoras);
  assert.ok(c.agregados > 0, 'agrega coches que proximos_arribos no traía');
  assert.ok(c.items.length > arr.items.length);
  const claves = c.items.map((a) => `${a.linea_nombre}|${a.coche}`);
  assert.equal(new Set(claves).size, claves.length, 'sin coches repetidos');
  for (const a of c.items) {
    assert.equal(typeof a.linea_nombre, 'string');
    assert.equal(typeof a.ruta_descripcion, 'string');
  }
  const conDos = new Set(c.items.map((a) => a.linea_nombre).filter((l, i, xs) => xs.indexOf(l) !== i));
  assert.ok(conDos.size > 0, 'al menos una línea con 2 coches');
});

test('combinarArribos: ignora coches de líneas que proximos_arribos no confirma para la parada', () => {
  const extra = [{ cliente: '411', items: [{ coche: '9999', linea: '777', sentido: 'I', a: [0, 0, 0, 0], horaTeoricaAjustada: '10:00:00' }] }];
  const c = combinarArribos(arr.items, extra);
  assert.equal(c.agregados, 0);
  assert.equal(c.sinLinea, 1);
});

test('maxPorLinea: como máximo 2 por línea + destino, los primeros por hora', () => {
  const coches = normalizarArribos(combinarArribos(arr.items, demoras).items, T0);
  const dos = maxPorLinea(coches);
  const cuenta = {};
  for (const c of dos) cuenta[`${c.linea}|${c.destino}`] = (cuenta[`${c.linea}|${c.destino}`] ?? 0) + 1;
  assert.ok(Object.values(cuenta).every((n) => n <= 2));
  for (let i = 1; i < dos.length; i++) assert.ok(dos[i].instante >= dos[i - 1].instante, 'sigue ordenado por hora');
  assert.equal(maxPorLinea(coches, 1).length, new Set(coches.map((c) => `${c.linea}|${c.destino}`)).size);
});

/** fetch falso: sesión, proximos_arribos y calcula_demora_de_linea (por empresa) desde la fixture. */
function falso({ fallaDemora = false } = {}) {
  const pedidos = [];
  const fetchFn = async (url, op = {}) => {
    const u = String(url);
    pedidos.push({ url: u, body: op.body ? String(op.body) : '' });
    if (u.includes('urbano.php')) return new Response('ok', { status: 200, headers: { 'set-cookie': 'PHPSESSID=s1; path=/' } });
    if (u.includes('proximos_arribos')) return Response.json(fx.proximos_arribos);
    if (u.includes('calcula_demora_de_linea')) {
      if (fallaDemora) return new Response('', { status: 500 });
      const empresa = new URL(u).searchParams.get('cliente');
      return Response.json(fx.demoras.find((d) => d.cliente === empresa)?.respuesta ?? { proximos: [] });
    }
    return Response.json({});
  };
  return { fetchFn, pedidos };
}
const rapido = { intervaloMs: 1, log: () => {}, ahora: () => T0 };

test('cliente.arribosCompletos: 1 proximos_arribos (con onlygps_array) + 1 demora por empresa', async () => {
  const { fetchFn, pedidos } = falso();
  const c = crearCliente({ fetchFn, ...rapido });
  const r = await c.arribosCompletos('SM02');
  const arribos = pedidos.filter((p) => p.url.includes('proximos_arribos'));
  const dem = pedidos.filter((p) => p.url.includes('calcula_demora_de_linea'));
  assert.equal(arribos.length, 1);
  assert.match(decodeURIComponent(arribos[0].body), /onlygps_array=\{"408":false,"411":false,"421":false,"422":false\}/);
  const empresas = new Set(arr.items.map((a) => String(a.cliente)));
  assert.equal(dem.length, empresas.size);
  for (const p of dem) assert.equal(new URL(p.url).searchParams.get('parada'), 'SM02');
  assert.equal(r.completo, true);
  assert.ok(r.datos.items.length > arr.items.length);
  // Caché: una segunda llamada no vuelve a pedir nada.
  await c.arribosCompletos('SM02');
  assert.equal(pedidos.filter((p) => !p.url.includes('urbano.php')).length, 1 + empresas.size);
});

test('cliente.arribosCompletos: si falla la demora, devuelve uno por línea y completo = false', async () => {
  const { fetchFn } = falso({ fallaDemora: true });
  const c = crearCliente({ fetchFn, ...rapido });
  const r = await c.arribosCompletos('SM02');
  assert.equal(r.completo, false);
  assert.equal(r.datos.items.length, arr.items.length);
});

test('servicio simple con todos los coches: 2 por línea como máximo y alguna línea con 2', async () => {
  const { fetchFn } = falso();
  const s = crearServicio({ cliente: crearCliente({ fetchFn, ...rapido, ttlArribosMs: 0 }) });
  const r = await s.proximos('SM02');
  const cuenta = {};
  for (const p of r.proximos) cuenta[p.linea] = (cuenta[p.linea] ?? 0) + 1;
  assert.ok(Object.values(cuenta).every((n) => n <= 2));
  assert.ok(Object.values(cuenta).some((n) => n === 2));
});

test('sentido con todos los coches: SM02 sigue siendo "hacia afuera" (los de atrás no dan vuelta la cuenta)', async () => {
  const { fetchFn } = falso();
  const s = crearServicio({ cliente: crearCliente({ fetchFn, ...rapido, ttlArribosMs: 0 }) });
  const r = await s.proximos('SM02');
  assert.equal(r.parada.sentido, 'afuera');
});
