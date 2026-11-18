// Home: pestañas de viajes + "La calle" + lista de bondis (estilo colectivos de Córdoba).
import { html, pintar, horaActual, textoFaltan, textoSentido } from './util.js';
import { bondiHtml, miniHtml, colorEmpresa, ICONO_PARADA } from './bondi.js';
import * as estado from './estado.js';
import * as api from './api.js';

const ICONO_MAS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>';
const ICONO_DESVIO = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"></path><path d="M12 10v5"></path><path d="M12 18v.5"></path></svg>';
const raw = (s) => html([s]); // fragmento fijo, escrito acá (no viene de la API)
const MAX_CALLE_MIN = 30;
const MAX_CALLE_BONDIS = 8;

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

/** Claves (línea|coche) de los coches que NO son el primero de su línea + destino (por minutos): "el que sigue". */
export function clavesSegundos(proximos) {
  const ordenados = [...proximos].sort((a, b) => a.minutos - b.minutos);
  const vistos = new Set();
  const segundos = new Set();
  for (const p of ordenados) {
    const k = `${p.linea}|${p.destino}`;
    if (vistos.has(k)) segundos.add(`${p.linea}|${p.coche}`); else vistos.add(k);
  }
  return segundos;
}

/** Bondis para "La calle": los de los próximos 30 min, ubicados por minutos (100 % = en tu parada). */
export function bondisEnLaCalle(lista) {
  return lista.filter((p) => p.min <= MAX_CALLE_MIN).sort((a, b) => a.min - b.min).slice(0, MAX_CALLE_BONDIS)
    .map((p, i) => ({ linea: p.linea, color: p.color, pct: (1 - p.min / MAX_CALLE_MIN) * 100, carril: i % 2 === 1 }));
}

export function montarHome(raiz) {
  const viajes = estado.viajes();
  if (!viajes.length) {
    pintar(raiz, html`
      <main class="pantalla vacia">
        ${raw(ICONO_PARADA)}
        <h1 class="titulo-grande">¿Cuándo pasa?</h1>
        <p class="texto-suave">Elegí la parada donde te tomás el bondi y mirá cuáles vienen, ordenados por hora.</p>
        <a class="boton-timbre" href="#/nuevo"><span class="timbre" aria-hidden="true"></span>Crear mi primer viaje</a>
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
    const visibles = datos ? datos.proximos.filter((p) => !oc.has(p.linea)).map((p) => ({ ...p, min: minutosAhora(p.minutos, datos.actualizado) })) : [];
    const conDato = visibles.filter((p) => p.faltan_paradas !== null);
    const sinDato = visibles.filter((p) => p.faltan_paradas === null);
    const segundos = clavesSegundos(visibles);
    const ocultasLista = unicas.filter((l) => oc.has(l.linea)).map((l) => l.linea);
    const mostradas = unicas.length - ocultasLista.length;
    const primero = conDato[0] ?? sinDato[0];

    const fila = (p) => {
      const clave = `${p.linea}|${p.coche}`;
      const esPrimero = p === primero;
      const segundo = segundos.has(clave);
      const chico = !esPrimero && (segundo || p.faltan_paradas === null);
      const detalle = (segundo ? 'el que sigue · ' : '') + textoFaltan(p.faltan_paradas, p.fuente_paradas);
      return html`
        <li class="bondi">
          ${bondiHtml({
            linea: p.linea, destino: p.destino, color: p.color, minutos: p.min, hora: p.hora, detalle,
            variante: esPrimero ? 'grande' : chico ? 'chico' : 'normal',
            sticker: esPrimero ? (p.min === 0 ? '¡Llegando!' : '¡El próximo!') : '',
            gira: esPrimero, bota: esPrimero && p.min <= 5,
          })}
          ${p.desvio ? html`<details class="desvio ${chico ? 'corrido' : ''}" data-clave="${clave}" ${desviosAbiertos.has(clave) ? raw('open') : ''}>
            <summary>${raw(ICONO_DESVIO)} desvío</summary><p>${p.desvio}</p></details>` : ''}
        </li>`;
    };

    let cuerpo;
    if (!datos) {
      cuerpo = error
        ? html`<div class="tarjeta vacio"><strong>No pudimos cargar la parada</strong><span class="texto-suave">${error.message}</span></div>`
        : html`<div class="tarjeta vacio"><strong class="titila">Buscando bondis…</strong></div>`;
    } else if (!visibles.length) {
      cuerpo = datos.proximos.length
        ? html`<div class="tarjeta vacio"><strong>Apagaste todas las líneas que vienen</strong><span class="texto-suave">Tocá “Líneas” para volver a prender los carteles.</span></div>`
        : html`<div class="tarjeta vacio"><strong>No viene ningún bondi con GPS</strong><span class="texto-suave">Ninguna línea tiene coches en camino ahora. Probá actualizar en un rato.</span></div>`;
    } else {
      cuerpo = html`<ul class="lista" aria-live="polite">${[...conDato, ...sinDato].map(fila)}</ul>`;
    }

    const calle = bondisEnLaCalle(visibles);
    const calleHtml = datos && visibles.length ? html`
      <div class="calle-bloque">
        <div class="calle" role="img" aria-label="La calle: ${calle.length} bondis vienen en los próximos ${MAX_CALLE_MIN} minutos, ubicados según cuánto les falta">
          <span class="calle-linea"></span>
          <span class="calle-poste"></span><span class="calle-cartel"></span><span class="calle-vos">VOS</span>
          <div class="calle-pista">${calle.map(miniHtml)}</div>
        </div>
        <div class="calle-escala" aria-hidden="true"><span>${MAX_CALLE_MIN} min</span><span>20</span><span>10</span><span>ya</span></div>
      </div>` : '';

    let aviso = '';
    if (datos) {
      const hace = Math.max(0, Math.round((Date.now() - Date.parse(datos.actualizado)) / 60_000));
      if (datos.desactualizado) aviso = html`<div class="aviso" role="status">Tu Bondi no responde: estos datos son de hace ${hace} min.</div>`;
      else if (error) aviso = html`<div class="aviso" role="status">No pudimos actualizar (${error.message}). Mostrando datos de hace ${hace} min.</div>`;
    }

    const sentido = datos?.parada?.sentido && datos.parada.sentido !== '?' ? datos.parada.sentido : activo.sentido;
    pintar(raiz, html`
      <div class="pantalla">
        <header class="cabecera">
          <div class="cab-fila">
            ${raw(ICONO_PARADA)}
            <div class="cab-textos">
              <span class="cab-chico">${activo.nombre} · son las <span id="ahora">${horaActual()}</span></span>
              <h1 class="cab-parada">${datos?.parada?.nombre ?? activo.parada.nombre}</h1>
              <span class="cab-sentido">${activo.parada.codigo} · ${textoSentido(sentido).toLowerCase()}</span>
            </div>
          </div>
          <div class="pestanas">
            <div role="tablist" aria-label="Viajes" class="pestanas-lista">
              ${viajesAhora.map((v) => html`<button role="tab" class="pestana" aria-selected="${v.id === activo.id}" data-accion="viaje" data-id="${v.id}">${v.nombre}</button>`)}
            </div>
            <a class="pestana nuevo" href="#/nuevo">${raw(ICONO_MAS)} Nuevo viaje</a>
          </div>
        </header>
        <main class="contenido">
          ${calleHtml}
          <div class="fila-titulo">
            <h2 class="titulo-seccion">Próximos bondis</h2>
            <button class="boton-filtro" data-accion="filtro" aria-expanded="${filtroAbierto}" ${datos ? '' : raw('disabled')}>Líneas ${mostradas}/${unicas.length}</button>
          </div>
          ${filtroAbierto && datos ? html`
            <div class="tarjeta filtro">
              <span class="texto-suave">Apagá los carteles de las líneas que no te sirven. Se guarda en este celular.</span>
              <div class="chips">
                ${unicas.map((l) => html`<button class="chip-led" style="--empresa:${colorEmpresa(l.color)}" aria-pressed="${!oc.has(l.linea)}" aria-label="Línea ${l.linea} hacia ${l.destino}" data-accion="linea" data-linea="${l.linea}">${l.linea}</button>`)}
              </div>
            </div>` : ''}
          ${aviso}
          ${cuerpo}
          ${ocultasLista.length ? html`<span class="texto-suave ocultas">Carteles apagados: ${ocultasLista.join(', ')}</span>` : ''}
          <button class="boton-peligro" data-accion="eliminar">Eliminar este viaje</button>
        </main>
        <footer class="pie">
          <span class="texto-suave">Actualizado <span id="hace">${datos ? hace() : '—'}</span></span>
          <button class="boton-timbre" data-accion="actualizar" ${cargando ? raw('disabled') : ''}><span class="timbre" aria-hidden="true"></span>${cargando ? 'Actualizando…' : 'Actualizar'}</button>
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
