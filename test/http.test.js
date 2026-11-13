import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearServidor, crearLimitador, json } from '../server/http.js';

async function conServidor(opciones, fn) {
  const s = crearServidor(opciones);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try { await fn(base); } finally { s.close(); s.closeAllConnections?.(); }
}

test('/salud, estáticos, 404 y path traversal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-'));
  writeFileSync(join(dir, 'index.html'), '<h1>hola</h1>');
  writeFileSync(join(tmpdir(), 'secreto.txt'), 'no');
  const rutas = [{ metodo: 'GET', patron: '/salud', manejar: (q, r) => json(r, 200, { ok: true, tubondi: 'ok' }) }];
  await conServidor({ rutas, dirWeb: dir }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/salud`)).json(), { ok: true, tubondi: 'ok' });
    assert.equal(await (await fetch(`${base}/`)).text(), '<h1>hola</h1>');
    assert.equal((await fetch(`${base}/nada.js`)).status, 404);
    assert.equal((await fetch(`${base}/..%2Fsecreto.txt`)).status, 404);
  });
});

test('límite por IP: pasado el máximo devuelve 429 en /api/*', async () => {
  const rutas = [{ metodo: 'GET', patron: '/api/x', manejar: (q, r) => json(r, 200, {}) }];
  await conServidor({ rutas, limite: crearLimitador({ max: 3 }) }, async (base) => {
    const estados = [];
    for (let i = 0; i < 5; i++) estados.push((await fetch(`${base}/api/x`)).status);
    assert.deepEqual(estados, [200, 200, 200, 429, 429]);
  });
});
