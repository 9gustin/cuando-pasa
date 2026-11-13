// Estado del usuario en localStorage (viajes, líneas ocultas, último dato de cada parada).
// Todo con try/catch: en modo privado o con almacenamiento bloqueado la app sigue andando (sin guardar).

const leer = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const viajes = () => {
  const v = leer('viajes', []);
  return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && x.parada?.codigo) : [];
};
export const guardarViajes = (lista) => guardar('viajes', lista);

export function crearViaje({ nombre, sentido, parada }) {
  const lista = viajes();
  const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const viaje = {
    id, nombre: nombre.trim() || `Viaje ${lista.length + 1}`, sentido,
    parada: { codigo: parada.codigo, nombre: parada.nombre },
    ocultas: [], creado: new Date().toISOString().slice(0, 10),
  };
  guardarViajes([...lista, viaje]);
  return viaje;
}

export function actualizarViaje(id, cambios) {
  guardarViajes(viajes().map((v) => (v.id === id ? { ...v, ...cambios } : v)));
}
export const eliminarViaje = (id) => guardarViajes(viajes().filter((v) => v.id !== id));

export const viajeActivo = () => leer('viajeActivo', null);
export const fijarViajeActivo = (id) => guardar('viajeActivo', id);

/** Último JSON de una parada, para mostrar algo al toque mientras se refresca (y sin conexión). */
export const ultimoDato = (codigo) => leer(`ultimo:${codigo}`, null);
export const guardarUltimoDato = (codigo, datos) => guardar(`ultimo:${codigo}`, datos);
