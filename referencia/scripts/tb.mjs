// Cliente mínimo de Tu Bondi (Micronauta) para exploración.
const BASE = 'https://micronauta4.dnsalias.net/usuario';
let cookie = null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function sesion() {
  const r = await fetch(`${BASE}/urbano.php?conf=cbaciudad`);
  cookie = (r.headers.get('set-cookie') || '').split(';')[0];
}
async function post(cmd, params) {
  if (!cookie) await sesion();
  for (let i = 0; i < 2; i++) {
    const r = await fetch(`${BASE}/urbano2_cmd.php?cmd=${cmd}`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ conf: 'cbaciudad', ...params })
    });
    if (r.status === 408) { await sesion(); continue; }
    await sleep(800); // ritmo amable
    return r.json();
  }
  throw new Error('sesión rechazada');
}
export const paradasCercanas = (lat, lon) => post('paradas_cercanas', { lat, lon }).then(j => j.paradas || []);
export const arribos = (codigo) => post('proximos_arribos', { codigo, onlygps: 'true', show80min: 'true' })
  .then(j => j.proximos_arribos || []);
export const hav = (a, b, c, d) => {
  const R = 6371000, t = x => x * Math.PI / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
