import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodificarEntidades, escaparHtml, limpiarDesvio, horaAInstante, formatoHora, minutosDeProximo,
  normalizarArribos, segundosDelDia,
} from '../server/tubondi/normalizar.js';
import { validarArribos, validarBusqueda, validarParadasCercanas, validarLineas, ErrorFormato } from '../server/tubondi/validar.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/proximos_arribos_SM02.json', import.meta.url)));
const GRABADO = Date.parse(fixture.grabado); // 13/11/2026 ~16:10 hora Córdoba

test('entidades HTML se decodifican a texto plano', () => {
  assert.equal(decodificarEntidades('&#128204; Parada &amp; &#x1F4CD; &lt;b&gt;'), '📌 Parada & 📍 <b>');
  assert.equal(decodificarEntidades('&inexistente; &#99999999;'), '&inexistente; &#99999999;');
});

test('el desvío se limpia y luego se puede escapar sin que quede HTML activo', () => {
  const crudo = 'Zamudio\r\n&#128204; PARADA &lt;script&gt;alert(1)&lt;/script&gt;\r\n';
  const limpio = limpiarDesvio(crudo);
  assert.equal(limpio, 'Zamudio · 📌 PARADA <script>alert(1)</script>');
  assert.ok(!escaparHtml(limpio).includes('<script'));
  assert.equal(limpiarDesvio('   '), null);
  assert.equal(limpiarDesvio(undefined), null);
});

test('hora argentina: UTC-3 y cruce de medianoche', () => {
  const t = Date.parse('2026-11-13T19:10:00Z'); // 16:10 AR
  assert.equal(segundosDelDia(t), 16 * 3600 + 10 * 60);
  assert.equal(formatoHora(horaAInstante('16:15:06', t)), '16:15');
  assert.equal(horaAInstante('16:15:00', t) - t, 5 * 60_000);
  // 23:55 AR (02:55Z del día siguiente): "00:05" es del día siguiente
  const tarde = Date.parse('2026-11-14T02:55:00Z');
  assert.equal(horaAInstante('00:05:00', tarde) - tarde, 10 * 60_000);
  // 00:05 AR: "23:58" es del día anterior
  const madrugada = Date.parse('2026-11-14T03:05:00Z');
  assert.equal(madrugada - horaAInstante('23:58:00', madrugada), 7 * 60_000);
});

test('minutosDeProximo', () => {
  assert.equal(minutosDeProximo('Llegando'), 0);
  assert.equal(minutosDeProximo('4min'), 4);
  assert.equal(minutosDeProximo('??'), null);
});

test('fixture real de SM02: valida, deduplica por coche+línea y ordena por hora', () => {
  const { items, parada, descartados } = validarArribos(fixture.respuesta);
  assert.equal(parada.codigo, 'SM02');
  assert.equal(descartados, 0);
  const lista = normalizarArribos(items, GRABADO);
  const claves = lista.map((a) => `${a.linea}|${a.coche}`);
  assert.equal(new Set(claves).size, claves.length, 'sin duplicados');
  assert.ok(lista.length < items.length || lista.length === items.length);
  assert.ok(lista.length > 0);
  for (let i = 1; i < lista.length; i++) assert.ok(lista[i].instante >= lista[i - 1].instante);
  for (const a of lista) {
    assert.ok(a.minutos >= 0);
    assert.match(a.hora, /^\d\d:\d\d$/);
    assert.equal(typeof a.coche_lat, 'number');
    assert.ok(a.destino.length > 0);
  }
  const con = lista.find((a) => a.desvio);
  if (con) assert.ok(!/&#\d+;/.test(con.desvio), 'sin entidades sin decodificar');
});

test('descarta coches que ya pasaron, salvo los "Llegando"', () => {
  const base = { coche: '1', linea_nombre: '10', ruta: '1', ruta_descripcion: 'X', a: [0, 0, 0, 0], dist_parada: 10 };
  const t = Date.parse('2026-11-13T19:10:00Z');
  const r = normalizarArribos([
    { ...base, coche: '1', horaTeoricaAjustada: '16:05:00', proximo: '4min' },
    { ...base, coche: '2', horaTeoricaAjustada: '16:09:00', proximo: 'Llegando' },
    { ...base, coche: '3', proximo: '6min' },
  ], t);
  assert.deepEqual(r.map((a) => [a.coche, a.minutos]), [['2', 0], ['3', 6]]);
});

test('el mismo coche repetido con dos rutas cuenta una vez', () => {
  const base = { coche: '7', linea_nombre: '13', ruta_descripcion: 'X', a: [0, 0, 0, 0], horaTeoricaAjustada: '16:20:00', proximo: '10min' };
  const r = normalizarArribos([{ ...base, ruta: '9' }, { ...base, ruta: '10' }], Date.parse('2026-11-13T19:10:00Z'));
  assert.equal(r.length, 1);
});

test('validación: formato roto lanza ErrorFormato con mensaje claro', () => {
  assert.throws(() => validarArribos({ foo: 1 }), ErrorFormato);
  assert.throws(() => validarArribos({ proximos_arribos: [{ coche: 1 }, { coche: 2 }] }), /todos los items inválidos/);
  assert.throws(() => validarParadasCercanas({}), ErrorFormato);
  assert.throws(() => validarBusqueda({}), ErrorFormato);
  assert.throws(() => validarLineas([]), ErrorFormato);
  assert.deepEqual(validarArribos({ parada: { codigo: 'X' } }).items, []); // parada sin coches
  assert.deepEqual(validarArribos({ ok: false, errorMsg: 'No hay rutas que pasen por la parada' }).items, []); // visto en vivo
  const mezcla = validarArribos({ proximos_arribos: [fixture.respuesta.proximos_arribos[0], { coche: 1 }] });
  assert.equal(mezcla.items.length, 1);
  assert.equal(mezcla.descartados, 1);
});
