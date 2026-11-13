// Arranque: base de datos, API, estáticos y tareas programadas.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crearServidor, json } from './http.js';
import { tuBondi, ErrorTuBondi } from './tubondi/cliente.js';
import { ErrorFormato } from './tubondi/validar.js';
import { abrirDb } from './db.js';
import { crearServicioParada } from './servicios/parada.js';
import { crearServicioBuscar } from './servicios/buscar.js';
import { iniciarTareas, marcarActiva } from './aprendizaje/tarea.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PORT ?? 3000);
const RUTA_DB = process.env.DB_PATH ?? join(raiz, 'data', 'cuando-pasa.db');
const CODIGO = /^[A-Za-z0-9]{2,8}$/;

/** Rutas de la API. Se exporta para poder testearla con un cliente y una base falsos. */
export function crearRutas({ cliente, db, parada, buscar, tareas }) {
  const manejarErrores = (fn) => async (req, res, ctx) => {
    try { return await fn(req, res, ctx); } catch (e) {
      if (e instanceof ErrorFormato) return json(res, 502, { error: 'Tu Bondi cambió algo y no pudimos leer los datos.', formato: true });
      if (e instanceof ErrorTuBondi) return json(res, 502, { error: 'Tu Bondi no responde ahora. Probá de nuevo en un rato.' });
      throw e;
    }
  };
  const numero = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);

  return [
    {
      metodo: 'GET', patron: '/salud',
      manejar: (req, res) => {
        const { tubondi, ultima_respuesta_ok } = cliente.estado();
        json(res, 200, { ok: true, tubondi, ultima_respuesta_ok });
      },
    },
    {
      metodo: 'GET', patron: '/api/buscar',
      manejar: manejarErrores(async (req, res, { url }) => json(res, 200, await buscar.buscar(url.searchParams.get('q')))),
    },
    {
      metodo: 'GET', patron: '/api/paradas',
      manejar: manejarErrores(async (req, res, { url }) => {
        const lat = numero(url.searchParams.get('lat')), lon = numero(url.searchParams.get('lon'));
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(res, 400, { error: 'lat y lon inválidas' });
        json(res, 200, await buscar.paradas(lat, lon));
      }),
    },
    {
      metodo: 'GET', patron: /^\/api\/parada\/([^/]+)$/,
      manejar: manejarErrores(async (req, res, { params: [codigo] }) => {
        if (!CODIGO.test(codigo)) return json(res, 400, { error: 'Código de parada inválido' });
        json(res, 200, await parada.proximos(codigo.toUpperCase()));
      }),
    },
    {
      metodo: 'POST', patron: /^\/api\/parada\/([^/]+)\/activar$/,
      manejar: (req, res, { params: [codigo] }) => {
        if (!CODIGO.test(codigo)) return json(res, 400, { error: 'Código de parada inválido' });
        const c = codigo.toUpperCase();
        marcarActiva(db, c);
        tareas?.aprender(c); // en segundo plano
        res.writeHead(204).end();
      },
    },
  ];
}

export function arrancar() {
  const cliente = tuBondi();
  const db = abrirDb(RUTA_DB);
  const parada = crearServicioParada({ cliente, db });
  const buscar = crearServicioBuscar({ cliente, db, servicio: parada });
  const tareas = iniciarTareas({ db, cliente, servicio: parada, rutaDb: RUTA_DB });
  const servidor = crearServidor({ rutas: crearRutas({ cliente, db, parada, buscar, tareas }), dirWeb: join(raiz, 'web') });

  // Canario: una vez por hora pide una parada fija y valida el formato (si falla 3 veces, /salud pasa a "degradado").
  const canario = setInterval(() => cliente.proximosArribos('SM02').catch(() => {}), 3_600_000);
  canario.unref();

  servidor.listen(PUERTO, () => console.log(JSON.stringify({ evento: 'arranque', puerto: PUERTO, db: RUTA_DB })));
  for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => { tareas.detener(); servidor.close(() => { db.close(); process.exit(0); }); });
  return { servidor, db };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) arrancar();
