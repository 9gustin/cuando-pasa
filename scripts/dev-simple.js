// Uso: node scripts/dev-simple.js [puerto=3000]
// Levanta la versión MVP (las mismas funciones de api/ que usa Vercel) + los estáticos de web/, para probar en local.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize, sep } from 'node:path';
import { hacerHandlers } from '../server/simple/manejar.js';

const web = fileURLToPath(new URL('../web/', import.meta.url)).replace(/[\\/]$/, '');
const puerto = Number(process.argv[2] ?? process.env.PORT ?? 3000);
const h = hacerHandlers();
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/salud') return h.salud(req, res);
  if (pathname === '/api/buscar') return h.buscar(req, res);
  if (pathname === '/api/paradas') return h.paradas(req, res);
  if (/^\/api\/parada\/[^/]+\/activar$/.test(pathname)) return h.activar(req, res);
  if (/^\/api\/parada\/[^/]+$/.test(pathname)) return h.parada(req, res);
  try {
    const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^[/\\]+/, '');
    const abs = join(web, rel);
    if (!abs.startsWith(web + sep)) throw new Error('fuera de web/');
    const cuerpo = await readFile(abs); // se lee primero: si falta el archivo, todavía se puede responder 404
    res.writeHead(200, { 'content-type': TIPOS[extname(abs)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(cuerpo);
  } catch { res.writeHead(404).end('No encontrado'); }
}).listen(puerto, () => console.log(`MVP simple en http://localhost:${puerto}`));
