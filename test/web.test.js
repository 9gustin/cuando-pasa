import test from 'node:test';
import assert from 'node:assert/strict';
import { html, esc, crudo, colorInsignia, textoFaltan, textoSentido } from '../web/js/util.js';
import { minutosAhora, lineasUnicas } from '../web/js/home.js';
import { porCercania, destinosEjemplo, textoDistancia, obtenerUbicacion, mensajeUbicacion } from '../web/js/nuevo.js';

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

test('paradas: orden por cercanía, distancia legible y destinos de ejemplo', () => {
  const ps = [{ codigo: 'A', distancia_m: 300 }, { codigo: 'B', distancia_m: 80 }, { codigo: 'C', distancia_m: 1250 }];
  assert.deepEqual(porCercania(ps).map((p) => p.codigo), ['B', 'A', 'C']);
  assert.equal(ps[0].codigo, 'A', 'no muta el original');
  assert.equal(textoDistancia(80), '80 m');
  assert.equal(textoDistancia(1250), '1,3 km');
  assert.equal(destinosEjemplo([{ destino: 'Lasalle' }, { destino: 'V. Allende' }, { destino: 'Lasalle' }]), 'Lasalle, V. Allende…');
  assert.equal(destinosEjemplo([]), '');
});

// --- ubicación del celular ---
const geoFalso = (respuestas) => {
  const llamadas = [];
  return { llamadas, getCurrentPosition(ok, error, opciones) {
    llamadas.push(opciones);
    const r = respuestas[llamadas.length - 1];
    r.error ? error({ code: r.error }) : ok({ coords: { latitude: r.lat, longitude: r.lon } });
  } };
};

test('ubicación: primero rápida (sin GPS); si anda, no insiste', async () => {
  const g = geoFalso([{ lat: -31.404, lon: -64.192 }]);
  assert.deepEqual(await obtenerUbicacion(g), { lat: -31.404, lon: -64.192 });
  assert.equal(g.llamadas.length, 1);
  assert.equal(g.llamadas[0].enableHighAccuracy, false);
});

test('ubicación: si la rápida falla por tiempo, reintenta con GPS', async () => {
  const g = geoFalso([{ error: 3 }, { lat: 1, lon: 2 }]);
  assert.deepEqual(await obtenerUbicacion(g), { lat: 1, lon: 2 });
  assert.equal(g.llamadas[1].enableHighAccuracy, true);
});

test('ubicación: sin permiso no insiste; errores con mensaje claro', async () => {
  const g = geoFalso([{ error: 1 }]);
  await assert.rejects(obtenerUbicacion(g), { codigo: 'permiso' });
  assert.equal(g.llamadas.length, 1);
  await assert.rejects(obtenerUbicacion(geoFalso([{ error: 3 }, { error: 3 }])), { codigo: 'tiempo' });
  await assert.rejects(obtenerUbicacion(null), { codigo: 'sin-soporte' });
  assert.match(mensajeUbicacion('tiempo'), /adentro de casa/);
  assert.match(mensajeUbicacion('permiso'), /permiso/);
});
