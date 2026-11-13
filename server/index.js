// Arranque del servidor. Etapa 1: /salud y estáticos. (API y tareas programadas en etapas siguientes.)
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { crearServidor, json } from './http.js';
import { tuBondi } from './tubondi/cliente.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUERTO = Number(process.env.PORT ?? 3000);

const cliente = tuBondi();
const rutas = [
  {
    metodo: 'GET', patron: '/salud',
    manejar: (req, res) => {
      const { tubondi, ultima_respuesta_ok } = cliente.estado();
      json(res, 200, { ok: true, tubondi, ultima_respuesta_ok });
    },
  },
];

const servidor = crearServidor({ rutas, dirWeb: join(raiz, 'web') });
servidor.listen(PUERTO, () => console.log(JSON.stringify({ evento: 'arranque', puerto: PUERTO })));

for (const senal of ['SIGINT', 'SIGTERM']) process.on(senal, () => servidor.close(() => process.exit(0)));
