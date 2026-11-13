// Home: pestañas de viajes + lista única de próximos colectivos.
import { html, pintar, horaActual, colorInsignia, textoFaltan, textoSentido } from './util.js';
import * as estado from './estado.js';
import * as api from './api.js';

const ICONO_FILTRO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"></path></svg>';
const ICONO_ACTUALIZAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>';
const ICONO_MAS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
const raw = (s) => html([s]); // fragmento fijo, escrito acá (no viene de la API)

/** Lo que muestra la fila a partir del dato del servidor, descontando el tiempo que pasó desde que se midió. */
export function minutosAhora(minutos, actualizadoIso, ahoraMs = Date.now()) {
  const transcurrido = (ahoraMs - Date.parse(actualizadoIso)) / 60_000;
  return Math.max(0, Math.round(minutos - (Number.isFinite(transcurrido) ? transcurrido : 0)));
}

/** Líneas únicas de la parada (una por número), ordenadas. */
export function lineasUnicas(lineas) {
  const m = new Map();
  for (const l of lineas) if (!m.has(l.linea)) m.set(l.linea, l);
  return [...m.values()].sort((a, b) => a.linea.localeCompare(b.linea, 'es', { numeric: true }));
}

export function montarHome(raiz) {
  const viajes = estado.viajes();
  if (!viajes.length) {
    pintar(raiz, html`
      <main class="pantalla vacia">
        <h1 class="titulo-grande">¿Cuándo pasa?</h1>
        <p class="texto-suave">Elegí la parada donde te tomás el bondi y mirá cuáles vienen, ordenados por hora.</p>
        <a class="boton-primario" href="#/nuevo">Crear mi primer viaje</a>
      </main>`);
    return () => {};
  }

  let activo = viajes.find((v) => v.id === estado.viajeActivo()) ?? viajes[0];
  let datos = estado.ultimoDato(activo.parada.codigo);
  let error = null;
  let cargando = false;
  let filtroAbierto = false;
  const desviosAbiertos = new Set();

  const ocultas = () => new Set(estado.viajes().find((v) => v.id === activo.id)?.ocultas ?? []);

  function render() {
    const scroll = raiz.querySelector('.contenido')?.scrollTop ?? 0;
    const viajesAhora = estado.viajes();
    const oc = ocultas();
    const unicas = datos ? lineasUnicas(datos.lineas) : [];
    const visibles = datos ? datos.proximos.filter((p) => !oc.has(p.linea)) : [];
    const conDato = visibles.filter((p) => p.faltan_paradas !== null);
    const sinDato = visibles.filter((p) => p.faltan_paradas === null);
    const ocultasLista = unicas.filter((l) => oc.has(l.linea)).map((l) => l.linea);
    const mostradas = unicas.length - ocultasLista.length;

    const fila = (p, i, chica) => {
      const primero = i === 0 && !chica;
      const clave = `${p.linea}|${p.coche}`;
      const min = minutosAhora(p.minutos, datos.actualizado);
      return html`
        <li class="fila ${primero ? 'primero' : ''} ${chica ? 'chica' : ''}">
          <div class="fila-principal">
            <span class="insignia" style="background:${chica ? '#8A8F99' : colorInsignia(p.color)}">${p.linea}</span>
            <div class="fila-centro">
              ${primero ? raw('<span class="etiqueta-proximo">El próximo</span>') : ''}
              <span class="destino">→ ${p.destino}</span>
              <span class="sub">${textoFaltan(p.faltan_paradas, p.fuente_paradas)}</span>
            </div>
            <div class="fila-derecha">
              <span class="hora">${p.hora}</span>
              <span class="sub">en ${min} min</span>
            </div>
          </div>
          ${p.desvio ? html`<details class="desvio" data-clave="${clave}" ${desviosAbiertos.has(clave) ? raw('open') : ''}>
            <summary>⚠ desvío</summary><p>${p.desvio}</p></details>` : ''}
        </li>`;
    };

    let cuerpo;
    if (!datos) {
      cuerpo = error
        ? html`<div class="tarjeta vacio"><strong>No pudimos cargar la parada</strong><span class="texto-suave">${error.message}</span></div>`
        : html`<div class="tarjeta vacio"><strong>Buscando colectivos…</strong></div>`;
    } else if (!visibles.length) {
      cuerpo = datos.proximos.length
        ? html`<div class="tarjeta vacio"><strong>Ocultaste todas las líneas que vienen</strong><span class="texto-suave">Tocá “Líneas” para volver a mostrarlas.</span></div>`
        : html`<div class="tarjeta vacio"><strong>No viene ningún bondi con GPS</strong><span class="texto-suave">Ninguna línea tiene coches en camino ahora. Probá actualizar en un rato.</span></div>`;
    } else {
      cuerpo = html`<ul class="lista" aria-live="polite">${conDato.map((p, i) => fila(p, i, false))}${sinDato.map((p, i) => fila(p, i, true))}</ul>`;
    }

    let aviso = '';
    if (datos) {
      const hace = Math.max(0, Math.round((Date.now() - Date.parse(datos.actualizado)) / 60_000));
      if (datos.desactualizado) aviso = html`<div class="aviso" role="status">Tu Bondi no responde: estos datos son de hace ${hace} min.</div>`;
      else if (error) aviso = html`<div class="aviso" role="status">No pudimos actualizar (${error.message}). Mostrando datos de hace ${hace} min.</div>`;
    }

    pintar(raiz, html`
      <div class="pantalla">
        <header class="cabecera">
          <div class="cab-textos">
            <span class="cab-chico">${activo.nombre} · ahora <span id="ahora">${horaActual()}</span></span>
            <h1 class="cab-parada">${datos?.parada?.nombre ?? activo.parada.nombre}</h1>
            <span class="cab-sentido">${textoSentido(datos?.parada?.sentido && datos.parada.sentido !== '?' ? datos.parada.sentido : activo.sentido)} · ${activo.parada.codigo}</span>
          </div>
          <div class="pestanas">
            <div role="tablist" aria-label="Viajes" class="pestanas-lista">
              ${viajesAhora.map((v) => html`<button role="tab" class="pestana" aria-selected="${v.id === activo.id}" data-accion="viaje" data-id="${v.id}">${v.nombre}</button>`)}
            </div>
            <a class="pestana nuevo" href="#/nuevo">${raw(ICONO_MAS)} Nuevo viaje</a>
          </div>
        </header>
        <main class="contenido">
          <div class="fila-titulo">
            <h2 class="titulo-seccion">Próximos colectivos</h2>
            <button class="boton-filtro" data-accion="filtro" aria-expanded="${filtroAbierto}" ${datos ? '' : raw('disabled')}>
              ${raw(ICONO_FILTRO)} Líneas ${mostradas}/${unicas.length}
            </button>
          </div>
          ${filtroAbierto && datos ? html`
            <div class="tarjeta filtro">
              <span class="texto-suave">Tocá para ocultar las que no te sirven. Se guarda en este celular.</span>
              <div class="chips">
                ${unicas.map((l) => html`<button class="chip" aria-pressed="${!oc.has(l.linea)}" data-accion="linea" data-linea="${l.linea}">${l.linea} <span class="chip-dest">→ ${l.destino}</span></button>`)}
              </div>
            </div>` : ''}
          ${aviso}
          ${cuerpo}
          ${ocultasLista.length ? html`<span class="texto-suave ocultas">Ocultas: ${ocultasLista.join(', ')}</span>` : ''}
          <button class="boton-peligro" data-accion="eliminar">Eliminar este viaje</button>
        </main>
        <footer class="pie">
          <span class="texto-suave">Actualizado <span id="hace">${datos ? hace() : '—'}</span></span>
          <button class="boton-oscuro" data-accion="actualizar" ${cargando ? raw('disabled') : ''}>${raw(ICONO_ACTUALIZAR)} ${cargando ? 'Actualizando…' : 'Actualizar'}</button>
        </footer>
      </div>`);
    const cont = raiz.querySelector('.contenido');
    if (cont) cont.scrollTop = scroll;
  }

  const hace = () => {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(datos.actualizado)) / 1000));
    return s < 90 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
  };

  async function cargar() {
    if (cargando) return;
    const codigo = activo.parada.codigo;
    cargando = true; render();
    try {
      const d = await api.parada(codigo);
      if (codigo !== activo.parada.codigo) return;
      datos = d; error = null;
      estado.guardarUltimoDato(codigo, d);
    } catch (e) {
      if (codigo === activo.parada.codigo) error = e;
    } finally { cargando = false; render(); }
  }

  // --- eventos (delegación) ---
  function alClick(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'viaje') {
      const v = estado.viajes().find((x) => x.id === b.dataset.id);
      if (!v || v.id === activo.id) return;
      activo = v; estado.fijarViajeActivo(v.id);
      datos = estado.ultimoDato(v.parada.codigo); error = null; filtroAbierto = false;
      render(); cargar();
    } else if (a === 'filtro') { filtroAbierto = !filtroAbierto; render(); }
    else if (a === 'linea') {
      const oc = ocultas();
      oc.has(b.dataset.linea) ? oc.delete(b.dataset.linea) : oc.add(b.dataset.linea);
      estado.actualizarViaje(activo.id, { ocultas: [...oc] });
      render();
    } else if (a === 'actualizar') cargar();
    else if (a === 'eliminar') {
      if (!confirm(`¿Eliminar el viaje “${activo.nombre}”?`)) return;
      estado.eliminarViaje(activo.id);
      estado.fijarViajeActivo(null);
      desmontar(); montarHome(raiz);
    }
  }
  const alToggle = (ev) => {
    const d = ev.target.closest?.('details[data-clave]');
    if (d) d.open ? desviosAbiertos.add(d.dataset.clave) : desviosAbiertos.delete(d.dataset.clave);
  };
  raiz.addEventListener('click', alClick);
  raiz.addEventListener('toggle', alToggle, true);

  const reloj = setInterval(() => {
    const a = raiz.querySelector('#ahora'); if (a) a.textContent = horaActual();
    const h = raiz.querySelector('#hace'); if (h && datos) h.textContent = hace();
  }, 1000);

  function desmontar() {
    clearInterval(reloj);
    raiz.removeEventListener('click', alClick); raiz.removeEventListener('toggle', alToggle, true);
  }

  estado.fijarViajeActivo(activo.id);
  render();
  cargar();
  return desmontar;
}
