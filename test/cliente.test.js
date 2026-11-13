import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearCliente, ErrorTuBondi } from '../server/tubondi/cliente.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/proximos_arribos_SM02.json', import.meta.url))).respuesta;

/** fetch falso que imita a Tu Bondi: sin cookie → 408. Guarda cada pedido. */
function falso({ fallar = () => false, sesionesValidas = null } = {}) {
  const pedidos = [];
  let n = 0;
  let sesionActual = 0;
  const fetchFn = async (url, op = {}) => {
    const u = String(url);
    const ts = performance.now();
    pedidos.push({ url: u, ts, cookie: op.headers?.cookie ?? null, ua: op.headers?.['user-agent'], tienePeticionSignal: !!op.signal });
    n++;
    if (fallar(n, u)) throw new TypeError('fetch failed');
    if (u.includes('urbano.php')) {
      sesionActual++;
      return new Response('<html>' + 'x'.repeat(1000) + '</html>', { status: 200, headers: { 'set-cookie': `PHPSESSID=s${sesionActual}; path=/` } });
    }
    const cookie = op.headers?.cookie;
    const valida = sesionesValidas ? sesionesValidas(cookie) : cookie === `PHPSESSID=s${sesionActual}`;
    if (!cookie || !valida) return new Response('', { status: 408 });
    if (u.includes('proximos_arribos')) return Response.json(fixture);
    if (u.includes('paradas_cercanas')) return Response.json({ ok: true, paradas: [{ codigo: 'SM02', parada_nombre: 'Av Castro Barros 443', lat: '-31.4011', lon: '-64.1966' }] });
    if (u.includes('buscar_direccion')) return Response.json([{ lat: -31.4017, lon: -64.1965, display_name: 'Bv Castro Barros y Europa' }]);
    return Response.json({ lineas: [{ linea_nombre: '18', cliente_nombre: 'X' }] });
  };
  return { fetchFn, pedidos };
}

const rapido = { intervaloMs: 5, log: () => {}, pausaCorteMs: 80 };

test('20 llamadas seguidas a la misma parada → 1 sesión + 1 pedido (caché y dedup)', async () => {
  const { fetchFn, pedidos } = falso();
  const c = crearCliente({ fetchFn, ...rapido });
  await Promise.all(Array.from({ length: 10 }, () => c.proximosArribos('SM02'))); // en vuelo
  for (let i = 0; i < 10; i++) await c.proximosArribos('SM02');                   // caché
  assert.equal(pedidos.length, 2);
  assert.ok(pedidos[0].url.includes('urbano.php'));
  assert.ok(pedidos[1].url.includes('cmd=proximos_arribos'));
  assert.equal(pedidos[1].cookie, 'PHPSESSID=s1');
  assert.equal(c.estado().deduplicados, 9);
  assert.equal(pedidos[1].ua, 'cuando-pasa/0.1');
  assert.ok(pedidos.every((p) => p.tienePeticionSignal), 'todos con timeout');
});

test('la caché de proximos_arribos vence a los 15 s', async () => {
  const { fetchFn, pedidos } = falso();
  let t = 1_000_000;
  const c = crearCliente({ fetchFn, ahora: () => t, ...rapido });
  await c.proximosArribos('SM02');
  t += 14_000; await c.proximosArribos('SM02');
  assert.equal(pedidos.filter((p) => p.url.includes('proximos')).length, 1);
  t += 2_000; const r = await c.proximosArribos('SM02');
  assert.equal(pedidos.filter((p) => p.url.includes('proximos')).length, 2);
  assert.equal(r.desactualizado, false);
});

test('cola: pedidos distintos salen separados por al menos el intervalo', async () => {
  const { fetchFn, pedidos } = falso();
  const c = crearCliente({ fetchFn, intervaloMs: 60, log: () => {} });
  await Promise.all(['A1', 'A2', 'A3'].map((p) => c.proximosArribos(p)));
  for (let i = 1; i < pedidos.length; i++) assert.ok(pedidos[i].ts - pedidos[i - 1].ts >= 55, `hueco ${i}: ${pedidos[i].ts - pedidos[i - 1].ts}`);
  assert.equal(pedidos.length, 4); // sesión + 3
});

test('408: renueva la sesión y reintenta una vez', async () => {
  const { fetchFn, pedidos } = falso();
  const c = crearCliente({ fetchFn, ...rapido });
  await c.proximosArribos('SM02');
  // el servidor "olvida" la sesión: nueva cookie válida
  const f2 = falso();
  let primera = true;
  const c2 = crearCliente({
    ...rapido,
    fetchFn: async (u, op) => {
      if (String(u).includes('proximos') && primera) { primera = false; return new Response('', { status: 408 }); }
      return f2.fetchFn(u, op);
    },
  });
  const r = await c2.proximosArribos('SM02');
  assert.equal(r.desactualizado, false);
  const urls = f2.pedidos.map((p) => (p.url.includes('urbano.php') ? 'sesion' : 'arribos'));
  assert.deepEqual(urls, ['sesion', 'sesion', 'arribos']); // sesión inicial, renovación tras el 408, reintento
  assert.equal(pedidos.length, 2);
});

test('408 dos veces seguidas → error de sesión (no reintenta más)', async () => {
  const { fetchFn, pedidos } = falso({ sesionesValidas: () => false });
  const c = crearCliente({ fetchFn, ...rapido });
  await assert.rejects(c.proximosArribos('SM02'), (e) => e instanceof ErrorTuBondi && e.codigo === 'sesion');
  assert.equal(pedidos.filter((p) => p.url.includes('proximos')).length, 2);
});

test('timeout: un pedido colgado se corta', async () => {
  const fetchFn = (url, op) => new Promise((_, rej) => {
    if (String(url).includes('urbano.php')) return rej(new TypeError('x'));
    op.signal.addEventListener('abort', () => rej(op.signal.reason));
  });
  const c = crearCliente({ fetchFn, timeoutMs: 30, ...rapido });
  await assert.rejects(c.proximosArribos('SM02'), /red|timeout/);
});

test('corte de emergencia: 5 errores seguidos → deja de llamar y sirve el último dato como desactualizado', async () => {
  let roto = false;
  const base = falso({ fallar: () => roto });
  let t = 5_000_000;
  const c = crearCliente({ fetchFn: base.fetchFn, ahora: () => t, ...rapido, pausaCorteMs: 60_000, maxViejoMs: 10 * 60_000 });
  const ok = await c.proximosArribos('SM02');
  assert.equal(ok.desactualizado, false);
  roto = true;
  t += 20_000; // vence la caché
  for (let i = 0; i < 5; i++) {
    const r = await c.proximosArribos('SM02'); // cada falla sirve el dato viejo, marcado
    assert.equal(r.desactualizado, true);
    t += 20_000;
  }
  const antes = base.pedidos.length;
  const r = await c.proximosArribos('SM02');
  assert.equal(r.desactualizado, true);
  assert.equal(base.pedidos.length, antes, 'con el corte abierto no se llama a Tu Bondi');
  assert.equal(c.estado().corte_activo, true);
  assert.equal(c.estado().tubondi, 'degradado');
  // sin dato previo → error explícito
  await assert.rejects(c.proximosArribos('OTRA'), (e) => e.codigo === 'corte');
  // pasada la pausa se prueba de nuevo y, si anda, se recupera
  t += 61_000; roto = false;
  const ok2 = await c.proximosArribos('SM02');
  assert.equal(ok2.desactualizado, false);
  assert.equal(c.estado().tubondi, 'ok');
});

test('respuesta con formato cambiado: error claro y cuenta como falla', async () => {
  const fetchFn = async (u) => (String(u).includes('urbano.php')
    ? new Response('x', { headers: { 'set-cookie': 'PHPSESSID=a' } }) : Response.json({ cambio: true }));
  const c = crearCliente({ fetchFn, ...rapido });
  await assert.rejects(c.proximosArribos('SM02'), /Tu Bondi cambió algo/);
  assert.equal(c.estado().errores, 1);
});

test('paradas_cercanas: caché por punto redondeado a 4 decimales; buscar_direccion por texto normalizado', async () => {
  const { fetchFn, pedidos } = falso();
  const c = crearCliente({ fetchFn, ...rapido });
  await c.paradasCercanas(-31.40171, -64.19651);
  await c.paradasCercanas(-31.401704, -64.196512);
  await c.buscarDireccion('Castro Barros  y Europa');
  const r = await c.buscarDireccion(' castro barros y europa ');
  assert.equal(r.datos[0].lat, -31.4017);
  assert.equal(pedidos.filter((p) => p.url.includes('paradas_cercanas')).length, 1);
  assert.equal(pedidos.filter((p) => p.url.includes('buscar_direccion')).length, 1);
});
