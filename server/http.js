// Router mínimo sobre node:http: rutas de API, /salud, archivos estáticos y límite de pedidos por IP.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/** Límite por IP en ventana de 1 minuto (en memoria). */
export function crearLimitador({ max = 60, ventanaMs = 60_000, ahora = () => Date.now() } = {}) {
  const cuentas = new Map(); // ip -> { desde, n }
  return (ip) => {
    const t = ahora();
    let c = cuentas.get(ip);
    if (!c || t - c.desde >= ventanaMs) { c = { desde: t, n: 0 }; cuentas.set(ip, c); }
    c.n++;
    if (cuentas.size > 5000) for (const [k, v] of cuentas) if (t - v.desde >= ventanaMs) cuentas.delete(k);
    return c.n <= max;
  };
}

export const ipDe = (req) => req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?';

export function json(res, status, cuerpo, extra = {}) {
  const txt = JSON.stringify(cuerpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(txt);
}

/**
 * rutas: [{ metodo, patron: RegExp o string, manejar(req, res, { url, params }) }]
 * dirWeb: carpeta de estáticos (se sirve index.html en "/").
 */
export function crearServidor({ rutas = [], dirWeb, limite = crearLimitador() } = {}) {
  async function estatico(req, res, pathname) {
    if (!dirWeb) return false;
    const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^[/\\]+/, '');
    const abs = join(dirWeb, rel);
    if (abs !== dirWeb && !abs.startsWith(dirWeb + sep)) return false; // path traversal
    try {
      if (!(await stat(abs)).isFile()) return false;
      const cuerpo = await readFile(abs);
      const sw = rel === 'sw.js';
      res.writeHead(200, {
        'content-type': TIPOS[extname(abs)] ?? 'application/octet-stream',
        'cache-control': sw || rel === 'index.html' ? 'no-cache' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : cuerpo);
      return true;
    } catch { return false; }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      if (pathname.startsWith('/api/') && !limite(ipDe(req))) {
        return json(res, 429, { error: 'Demasiados pedidos, esperá un momento.' }, { 'retry-after': '60' });
      }
      for (const r of rutas) {
        if (r.metodo !== req.method) continue;
        const m = typeof r.patron === 'string' ? (pathname === r.patron ? [] : null) : r.patron.exec(pathname);
        if (m) return await r.manejar(req, res, { url, params: m.slice(1).map(decodeURIComponent) });
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && !pathname.startsWith('/api/') && (await estatico(req, res, pathname))) return;
      json(res, 404, { error: 'No encontrado' });
    } catch (e) {
      console.error(JSON.stringify({ evento: 'error_http', mensaje: e?.message }));
      if (!res.headersSent) json(res, 500, { error: 'Error interno' });
      else res.end();
    }
  });
}
