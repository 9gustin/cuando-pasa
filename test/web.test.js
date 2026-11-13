import test from 'node:test';
import assert from 'node:assert/strict';
import { html, esc, crudo, colorInsignia, textoFaltan, textoSentido } from '../web/js/util.js';
import { minutosAhora, lineasUnicas } from '../web/js/home.js';
import { porSentido, destinosEjemplo } from '../web/js/nuevo.js';

const texto = (f) => f.s;

test('html escapa todo lo interpolado (el desvío de Tu Bondi nunca se inserta como HTML)', () => {
  const malo = '<img src=x onerror=alert(1)> "&\' <script>';
  const r = texto(html`<p title="${malo}">${malo}</p>`);
  assert.ok(!r.includes('<img') && !r.includes('<script'));
  assert.ok(r.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(esc(null), '');
});

test('html: listas de fragmentos y crudo explícito', () => {
  assert.equal(texto(html`<ul>${['a', 'b<'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>b&lt;</li></ul>');
  assert.equal(texto(html`${crudo('<b>ok</b>')}`), '<b>ok</b>');
});

test('colorInsignia: oscurece el naranja de Tu Bondi y rechaza valores raros', () => {
  assert.equal(colorInsignia('#ff9500'), '#9e5c00');
  assert.equal(colorInsignia('red; background:url(x)'), '#B35400');
  assert.equal(colorInsignia(null), '#B35400');
});

test('textos en español rioplatense', () => {
  assert.equal(textoFaltan(1), 'falta 1 parada');
  assert.equal(textoFaltan(3), 'faltan 3 paradas');
  assert.equal(textoFaltan(null), 'sin dato de paradas');
  assert.equal(textoFaltan(3, 'distancia'), 'faltan ~3 paradas');
  assert.equal(textoFaltan(1, 'distancia'), 'falta ~1 parada');
  assert.equal(textoSentido('centro'), 'Hacia el centro');
  assert.equal(textoSentido('afuera'), 'Hacia afuera');
});

test('minutosAhora descuenta el tiempo transcurrido desde que se midió', () => {
  const t0 = Date.parse('2026-11-13T19:00:00Z');
  assert.equal(minutosAhora(4, new Date(t0).toISOString(), t0 + 30_000), 4 - 0); // 0,5 min → redondea
  assert.equal(minutosAhora(4, new Date(t0).toISOString(), t0 + 120_000), 2);
  assert.equal(minutosAhora(1, new Date(t0).toISOString(), t0 + 600_000), 0);
});

test('lineasUnicas: una por número, orden numérico', () => {
  const r = lineasUnicas([{ linea: '83', destino: 'A' }, { linea: '10', destino: 'B' }, { linea: '10', destino: 'C' }, { linea: '9', destino: 'D' }]);
  assert.deepEqual(r.map((l) => [l.linea, l.destino]), [['9', 'D'], ['10', 'B'], ['83', 'A']]);
});

test('porSentido elige la más cercana de cada lado; destinosEjemplo resume', () => {
  const ps = [
    { codigo: 'A', sentido: 'afuera', distancia_m: 90, lineas: [] },
    { codigo: 'B', sentido: 'afuera', distancia_m: 30, lineas: [{ linea: '10', destino: 'Lasalle' }, { linea: '11', destino: 'V. Allende' }] },
    { codigo: 'C', sentido: 'centro', distancia_m: 50, lineas: [] },
    { codigo: 'D', sentido: '?', distancia_m: 10, lineas: [] },
  ];
  const r = porSentido(ps);
  assert.equal(r.afuera.codigo, 'B');
  assert.equal(r.centro.codigo, 'C');
  assert.equal(destinosEjemplo(r.afuera), 'Lasalle, V. Allende…');
  assert.equal(destinosEjemplo(null), 'sin datos todavía');
});
