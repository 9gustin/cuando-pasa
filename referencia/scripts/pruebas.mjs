// Batería de pruebas contra Tu Bondi (Micronauta), como lo haría el backend.
const BASE = 'https://micronauta4.dnsalias.net/usuario';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const t0 = () => performance.now();
let cookie = '';

async function req(nombre, url, opts = {}) {
  const s = t0();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
  const txt = await r.text();
  const ms = Math.round(t0() - s);
  console.log(`\n=== ${nombre}\n${opts.method || 'GET'} ${url.replace(BASE, '')}\n→ HTTP ${r.status} · ${ms} ms · ${txt.length} bytes`);
  await sleep(1000);
  return { r, txt, ms };
}
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ conf: 'cbaciudad', ...o }) });

// 1) Sin sesión
let x = await req('1. proximos_arribos SIN cookie', `${BASE}/urbano2_cmd.php?cmd=proximos_arribos`, form({ codigo: 'SM02', onlygps: 'true' }));
console.log('cuerpo:', JSON.stringify(x.txt.slice(0, 80)));

// 2) Sesión
x = await req('2. sesión (urbano.php)', `${BASE}/urbano.php?conf=cbaciudad`);
cookie = (x.r.headers.get('set-cookie') || '').split(';')[0];
console.log('cookie:', cookie.replace(/=.*/, '=<oculta>'));

// 3) proximos_arribos SM02
x = await req('3. proximos_arribos SM02 (la parada de ella)', `${BASE}/urbano2_cmd.php?cmd=proximos_arribos`, form({ codigo: 'SM02', onlygps: 'true', show80min: 'true' }));
const j = JSON.parse(x.txt);
console.log('parada:', JSON.stringify(j.parada));
const vistos = new Set(); const filas = [];
for (const a of j.proximos_arribos) {
  const k = a.coche + a.linea_nombre; if (vistos.has(k)) continue; vistos.add(k);
  filas.push(a);
}
console.log(`arribos: ${j.proximos_arribos.length} (sin duplicados: ${filas.length})`);
console.log('línea | destino                              | coche | proximo   | hora     | dist_parada');
for (const a of filas) console.log(`${a.linea_nombre.padEnd(5)} | ${a.ruta_descripcion.slice(0, 36).padEnd(36)} | ${a.coche.padEnd(5)} | ${String(a.proximo).padEnd(9)} | ${a.horaTeoricaAjustada} | ${a.dist_parada} m`);
console.log('\nejemplo de un item crudo:\n' + JSON.stringify(filas[0], null, 1));

// 4) buscar_direccion
x = await req('4. buscar_direccion "castro barros y europa"', `${BASE}/urbano2_cmd.php?a=&cmd=buscar_direccion&q=${encodeURIComponent('castro barros y europa')}&conf=cbaciudad`);
console.log(x.txt);
const dir = JSON.parse(x.txt)[0];

// 5) paradas_cercanas
x = await req('5. paradas_cercanas de esa esquina', `${BASE}/urbano2_cmd.php?cmd=paradas_cercanas`, form({ lat: dir.lat, lon: dir.lon }));
const pc = JSON.parse(x.txt);
console.log(`ok: ${pc.ok} · paradas: ${pc.paradas.length}`);
for (const p of pc.paradas.slice(0, 6)) console.log(`  ${p.codigo.padEnd(6)} ${p.parada_nombre.padEnd(30)} ${p.lat},${p.lon}`);

// 6) lineasyrutas
x = await req('6. lineasyrutas (catálogo)', `${BASE}/urbano2_cmd.php?cmd=lineasyrutas`, form({}));
const lr = JSON.parse(x.txt);
console.log(`líneas: ${lr.lineas.length} · empresas: ${[...new Set(lr.lineas.map(l => l.cliente_nombre))].join(', ')}`);
console.log('ejemplo:', JSON.stringify(lr.lineas.find(l => l.linea_nombre === '18')));

// 7) Ráfaga moderada: 5 pedidos seguidos a 1/s para ver estabilidad
console.log('\n=== 7. 5 pedidos seguidos a SM02 (1 por segundo)');
const tiempos = [];
for (let i = 0; i < 5; i++) {
  const s = t0();
  const r = await fetch(`${BASE}/urbano2_cmd.php?cmd=proximos_arribos`, { ...form({ codigo: 'SM02', onlygps: 'true' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie } });
  await r.text(); tiempos.push(`${r.status}/${Math.round(t0() - s)}ms`); await sleep(1000);
}
console.log('status/latencia:', tiempos.join(' · '));
