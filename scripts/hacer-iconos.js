// Genera los íconos PNG de la PWA sin dependencias (zlib + CRC a mano). Uso: node scripts/hacer-iconos.js
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../web/iconos/', import.meta.url));
mkdirSync(dir, { recursive: true });

const crcTabla = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTabla[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const trozo = (tipo, datos) => {
  const t = Buffer.from(tipo), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(datos.length); c.writeUInt32BE(crc(Buffer.concat([t, datos])));
  return Buffer.concat([l, t, datos, c]);
};

/** Dibuja: fondo oscuro + colectivo blanco con ventanilla y dos ruedas. `margen` agranda la zona segura (maskable). */
function png(tam, margen) {
  const px = Buffer.alloc(tam * tam * 4);
  const fondo = [0x15, 0x17, 0x1c], blanco = [255, 255, 255], naranja = [0xff, 0x95, 0x00];
  const u = tam / 100;
  const dentroRR = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const m = margen; // % por lado
  const s = (100 - 2 * m) / 100; // escala del dibujo
  const P = (v) => (m + v * s) * u;
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    let c = fondo;
    if (dentroRR(x, y, P(14), P(22), P(86), P(72), P(8) - P(0))) c = blanco;
    if (dentroRR(x, y, P(22), P(30), P(78), P(52), P(4) - P(0))) c = fondo;       // parabrisas
    if (dentroRR(x, y, P(14), P(58), P(86), P(64), 0)) c = naranja;               // franja
    if ((x - P(32)) ** 2 + (y - P(76)) ** 2 <= P(7) ** 2 - P(0) ** 2 || (x - P(68)) ** 2 + (y - P(76)) ** 2 <= (P(7) - P(0)) ** 2) c = blanco;
    const i = (y * tam + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  const filas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let y = 0; y < tam; y++) { filas[y * (tam * 4 + 1)] = 0; px.copy(filas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(filas)), trozo('IEND', Buffer.alloc(0))]);
}

writeFileSync(dir + 'icono-192.png', png(192, 6));
writeFileSync(dir + 'icono-512.png', png(512, 6));
writeFileSync(dir + 'icono-maskable-512.png', png(512, 16)); // contenido dentro del 80 % central
writeFileSync(dir + 'apple-180.png', png(180, 8));
writeFileSync(dir + 'icono.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#15171C"/><rect x="14" y="22" width="72" height="50" rx="8" fill="#fff"/><rect x="22" y="30" width="56" height="22" rx="4" fill="#15171C"/><rect x="14" y="58" width="72" height="6" fill="#ff9500"/><circle cx="32" cy="76" r="7" fill="#fff"/><circle cx="68" cy="76" r="7" fill="#fff"/></svg>\n`);
console.log('Íconos generados en', dir);
