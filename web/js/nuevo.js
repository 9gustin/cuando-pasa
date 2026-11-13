// Nuevo viaje: nombre → dónde te tomás el bondi → para qué lado vas → crear.
import { html, pintar, colorInsignia, debounce, textoSentido } from './util.js';
import * as estado from './estado.js';
import * as api from './api.js';

const raw = (s) => html([s]);
const ICONO_VOLVER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>';
const ICONO_UBICACION = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path><circle cx="12" cy="12" r="7"></circle></svg>';
const ICONO_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F4FB8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';

/** De las paradas cercanas, la más cercana de cada sentido. */
export function porSentido(paradas) {
  const r = { centro: null, afuera: null };
  for (const p of [...paradas].sort((a, b) => a.distancia_m - b.distancia_m)) {
    if ((p.sentido === 'centro' || p.sentido === 'afuera') && !r[p.sentido]) r[p.sentido] = p;
  }
  return r;
}

/** Destinos de ejemplo: los primeros 3 distintos. */
export const destinosEjemplo = (p) => {
  const d = [...new Set((p?.lineas ?? []).map((l) => l.destino))].slice(0, 3);
  return d.length ? `${d.join(', ')}…` : 'sin datos todavía';
};

export function montarNuevo(raiz, navegar) {
  const s = {
    nombre: '', texto: '', sugerencias: [], lugar: null, paradas: null, elegida: null,
    cargandoBusca: false, cargandoParadas: false, mensaje: null, creando: false,
  };
  let tokenBusca = 0, tokenParadas = 0, vivo = true;

  const sentidos = () => (s.paradas ? porSentido(s.paradas) : { centro: null, afuera: null });
  const otras = () => (s.paradas ?? []).filter((p) => p.sentido !== 'centro' && p.sentido !== 'afuera');

  function render() {
    const enfocado = document.activeElement?.id;
    const pos = document.activeElement?.selectionStart;
    const sent = sentidos();
    const opcion = (clave, titulo) => {
      const p = sent[clave];
      const sel = s.elegida && p && s.elegida.codigo === p.codigo;
      return html`<button role="radio" class="opcion ${sel ? 'sel' : ''}" aria-checked="${!!sel}" data-accion="sentido" data-clave="${clave}" ${p ? '' : raw('disabled')}>
        <span class="opcion-titulo">${titulo}</span>
        <span class="opcion-hint">${p ? destinosEjemplo(p) : 'no encontramos parada de este lado'}</span></button>`;
    };
    const e = s.elegida;
    pintar(raiz, html`
      <div class="pantalla">
        <header class="cabecera fila-cab">
          <a class="boton-volver" href="#/" aria-label="Volver">${raw(ICONO_VOLVER)}</a>
          <h1 class="cab-titulo">Nuevo viaje</h1>
        </header>
        <main class="contenido form">
          <div class="campo">
            <label for="nombre">1 · Nombre del viaje</label>
            <input id="nombre" class="input" placeholder="Ir al trabajo" maxlength="40" autocomplete="off" value="${s.nombre}">
          </div>
          <div class="campo">
            <label for="buscar">2 · ¿Dónde te tomás el bondi?</label>
            <div class="fila-input">
              <input id="buscar" class="input" placeholder="Una esquina o calle, ej. Castro Barros y Europa" autocomplete="off" value="${s.texto}">
              <button class="boton-cuadrado" data-accion="ubicacion" aria-label="Usar mi ubicación">${raw(ICONO_UBICACION)}</button>
            </div>
            ${s.cargandoBusca ? html`<span class="texto-suave">Buscando…</span>` : ''}
            ${s.sugerencias.length ? html`<ul class="sugerencias">${s.sugerencias.map((x, i) => html`<li><button class="sugerencia" data-accion="lugar" data-i="${i}">${x.texto}</button></li>`)}</ul>` : ''}
            ${s.lugar ? html`<div class="lugar">${raw(ICONO_OK)}<span>${s.lugar.texto}</span></div>` : ''}
            ${s.mensaje ? html`<div class="aviso" role="status">${s.mensaje}</div>` : ''}
          </div>
          ${s.lugar ? html`
          <div class="campo">
            <span class="etiqueta">3 · ¿Para qué lado vas?</span>
            ${s.cargandoParadas ? html`<span class="texto-suave">Buscando paradas cerca…</span>` : ''}
            ${s.paradas && !s.paradas.length ? html`<div class="aviso">No encontramos paradas cerca de ese lugar.</div>` : ''}
            ${s.paradas?.length ? html`
              <div role="radiogroup" aria-label="Sentido" class="opciones">
                ${opcion('centro', 'Hacia el centro')}${opcion('afuera', 'Hacia afuera')}
              </div>
              ${otras().length ? html`
                <span class="texto-suave">Paradas cercanas con sentido sin confirmar:</span>
                <div class="opciones una">${otras().map((p) => html`<button class="opcion ${e?.codigo === p.codigo ? 'sel' : ''}" role="radio" aria-checked="${e?.codigo === p.codigo}" data-accion="parada" data-codigo="${p.codigo}">
                  <span class="opcion-titulo">${p.nombre}</span><span class="opcion-hint">${p.codigo} · a ${p.distancia_m} m</span></button>`)}</div>` : ''}` : ''}
            ${e ? html`
              <div class="tarjeta parada-elegida">
                <span class="etiqueta-mayus">Tu parada</span>
                <strong class="parada-nombre">${e.nombre}</strong>
                <span class="texto-suave">${e.codigo} · ${textoSentido(e.sentido)} · a ${e.distancia_m} m</span>
                <div class="insignias">${e.lineas.length ? [...new Set(e.lineas.map((l) => l.linea))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((n) => html`<span class="insignia chica-i" style="background:${colorInsignia('#ff9500')}">${n}</span>`) : html`<span class="texto-suave">Todavía no vimos líneas acá.</span>`}</div>
                <span class="texto-suave">Después, en la home, podés ocultar las líneas que no te sirven.</span>
              </div>` : ''}
          </div>` : ''}
        </main>
        <footer class="pie solo">
          <button class="boton-primario ancho" data-accion="crear" ${e && !s.creando ? '' : raw('disabled')}>Crear viaje</button>
        </footer>
      </div>`);
    if (enfocado) { const el = raiz.querySelector(`#${enfocado}`); if (el) { el.focus(); if (pos != null) try { el.setSelectionRange(pos, pos); } catch { /* sin selección */ } } }
  }

  const buscarDebounced = debounce(async () => {
    const q = s.texto.trim();
    const mi = ++tokenBusca;
    if (q.length < 3) { s.sugerencias = []; s.cargandoBusca = false; s.mensaje = null; if (vivo) render(); return; }
    s.cargandoBusca = true; s.mensaje = null; render();
    try {
      const r = await api.buscar(q);
      if (mi !== tokenBusca || !vivo) return;
      s.sugerencias = r;
      if (!r.length) s.mensaje = 'No encontramos ese lugar. Probá con otra esquina o usá tu ubicación.';
    } catch (err) { if (mi === tokenBusca) { s.sugerencias = []; s.mensaje = err.message; } }
    finally { if (mi === tokenBusca && vivo) { s.cargandoBusca = false; render(); } }
  }, 500);

  async function cargarParadas(lat, lon, lugar) {
    const mi = ++tokenParadas;
    s.lugar = lugar; s.paradas = null; s.elegida = null; s.sugerencias = []; s.cargandoParadas = true; s.mensaje = null; render();
    try {
      const r = await api.paradasCerca(lat, lon);
      if (mi !== tokenParadas || !vivo) return;
      s.paradas = r;
      const sent = porSentido(r);
      s.elegida = sent.afuera ?? sent.centro ?? (r.length === 1 ? r[0] : null); // sugerencia inicial; se puede cambiar
    } catch (err) { if (mi === tokenParadas) { s.mensaje = err.message; s.paradas = []; } }
    finally { if (mi === tokenParadas && vivo) { s.cargandoParadas = false; render(); } }
  }

  function alInput(ev) {
    if (ev.target.id === 'nombre') s.nombre = ev.target.value;
    else if (ev.target.id === 'buscar') { s.texto = ev.target.value; buscarDebounced(); }
  }
  async function alClick(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'lugar') { const l = s.sugerencias[+b.dataset.i]; if (l) { s.texto = l.texto; cargarParadas(l.lat, l.lon, l); } }
    else if (a === 'ubicacion') {
      if (!navigator.geolocation) { s.mensaje = 'Este navegador no puede darnos tu ubicación.'; return render(); }
      s.mensaje = 'Buscando tu ubicación…'; render();
      navigator.geolocation.getCurrentPosition(
        (pos) => { const { latitude: lat, longitude: lon } = pos.coords; s.texto = ''; cargarParadas(lat.toFixed(5), lon.toFixed(5), { texto: 'Mi ubicación', lat, lon }); },
        (err) => { s.mensaje = err.code === 1 ? 'No tenemos permiso para ver tu ubicación. Podés buscar una esquina.' : 'No pudimos obtener tu ubicación. Podés buscar una esquina.'; render(); },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
    } else if (a === 'sentido') { s.elegida = sentidos()[b.dataset.clave] ?? s.elegida; render(); }
    else if (a === 'parada') { s.elegida = s.paradas.find((p) => p.codigo === b.dataset.codigo) ?? s.elegida; render(); }
    else if (a === 'crear' && s.elegida && !s.creando) {
      s.creando = true; render();
      const e = s.elegida;
      const viaje = estado.crearViaje({ nombre: s.nombre, sentido: e.sentido === 'centro' || e.sentido === 'afuera' ? e.sentido : '?', parada: e });
      estado.fijarViajeActivo(viaje.id);
      api.activar(e.codigo); // avisa al servidor que vigile y aprenda esa parada (en segundo plano)
      navegar('#/');
    }
  }
  raiz.addEventListener('input', alInput);
  raiz.addEventListener('click', alClick);
  render();
  return () => { vivo = false; raiz.removeEventListener('input', alInput); raiz.removeEventListener('click', alClick); };
}
