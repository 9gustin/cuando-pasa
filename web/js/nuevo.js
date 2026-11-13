// Nuevo viaje: nombre → dónde estás (esquina o ubicación) → elegir una de las paradas más cercanas → crear.
import { html, pintar, colorInsignia, debounce, textoSentido } from './util.js';
import * as estado from './estado.js';
import * as api from './api.js';

const raw = (s) => html([s]);
const DETALLE_AUTOMATICO = 5; // a las primeras N paradas se les pide sentido y líneas solas; al resto, al tocarlas
const ICONO_VOLVER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>';
const ICONO_UBICACION = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3"></path><path d="M12 19v3"></path><path d="M2 12h3"></path><path d="M19 12h3"></path><circle cx="12" cy="12" r="7"></circle></svg>';
const ICONO_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F4FB8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';

/** Destinos de ejemplo: los primeros 3 distintos. */
export const destinosEjemplo = (lineas) => {
  const d = [...new Set((lineas ?? []).map((l) => l.destino))].slice(0, 3);
  return d.length ? `${d.join(', ')}…` : '';
};

/** Distancia legible: "80 m", "1,2 km". */
export const textoDistancia = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/**
 * Ubicación del celular. Primero rápida (wifi/antenas, sirve adentro de casa); si falla por tiempo o no disponible,
 * segundo intento con GPS. Devuelve { lat, lon } o lanza { codigo: 'permiso'|'no-disponible'|'tiempo'|'sin-soporte' }.
 */
export async function obtenerUbicacion(geo = globalThis.navigator?.geolocation) {
  if (!geo) throw { codigo: 'sin-soporte' };
  const intento = (opciones) => new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject({ codigo: e.code === 1 ? 'permiso' : e.code === 2 ? 'no-disponible' : 'tiempo' }),
      opciones);
  });
  try { return await intento({ enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60_000 }); }
  catch (e) {
    if (e.codigo === 'permiso') throw e;
    return intento({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  }
}

export const mensajeUbicacion = (codigo) => ({
  permiso: 'No tenemos permiso para ver tu ubicación. Activalo en los ajustes del navegador, o escribí tu calle o una esquina.',
  'no-disponible': 'Tu celular no pudo ubicarte. Probá de nuevo, o escribí tu calle o una esquina.',
  tiempo: 'Tardó demasiado en ubicarte (a veces pasa adentro de casa). Probá de nuevo, o escribí tu calle, ej. “tomas guido”.',
  'sin-soporte': 'Este navegador no puede darnos tu ubicación. Escribí tu calle o una esquina.',
})[codigo] ?? 'No pudimos obtener tu ubicación. Escribí tu calle o una esquina.';

/** Orden por cercanía (el servidor ya las manda así, pero no dependemos de eso). */
export const porCercania = (paradas) => [...paradas].sort((a, b) => a.distancia_m - b.distancia_m);

export function montarNuevo(raiz, navegar) {
  const s = {
    nombre: '', texto: '', sugerencias: [], lugar: null, paradas: null, elegida: null,
    detalles: {}, // codigo -> { estado: 'cargando'|'ok'|'error', sentido, lineas }
    cargandoBusca: false, cargandoParadas: false, mensaje: null, creando: false,
  };
  let tokenBusca = 0, tokenParadas = 0, vivo = true;

  /** Sentido y líneas de una parada (un pedido a /api/parada). */
  async function cargarDetalle(codigo) {
    if (s.detalles[codigo]) return;
    s.detalles[codigo] = { estado: 'cargando' };
    if (vivo) actualizarDetalle(codigo);
    try {
      const d = await api.parada(codigo);
      s.detalles[codigo] = { estado: 'ok', sentido: d.parada.sentido, lineas: d.lineas };
    } catch { s.detalles[codigo] = { estado: 'error' }; }
    if (vivo) actualizarDetalle(codigo);
  }

  // Textos de cada parada del listado: [línea 1, línea 2]
  function metaDe(p) {
    const d = s.detalles[p.codigo];
    const sentido = d?.estado === 'ok' ? (d.sentido === 'centro' || d.sentido === 'afuera' ? textoSentido(d.sentido) : 'sentido sin confirmar')
      : d?.estado === 'cargando' ? 'mirando sentido…' : '';
    return [`${p.codigo} · a ${textoDistancia(p.distancia_m)}${sentido ? ` · ${sentido}` : ''}`, d?.estado === 'ok' ? destinosEjemplo(d.lineas) : ''];
  }

  /**
   * Cuando llega el detalle de una parada se cambia SOLO el texto, sin reemplazar los botones:
   * si se redibuja el listado justo mientras el dedo toca un botón, el toque se pierde.
   */
  function actualizarDetalle(codigo) {
    const p = s.paradas?.find((x) => x.codigo === codigo);
    const btn = raiz.querySelector(`.parada-item[data-codigo="${CSS.escape(codigo)}"]`);
    if (p && btn) {
      const [m1, m2] = metaDe(p);
      btn.querySelector('[data-meta="1"]').textContent = m1;
      const l2 = btn.querySelector('[data-meta="2"]');
      l2.textContent = m2; l2.hidden = !m2;
    }
    if (s.elegida?.codigo === codigo) pintarTarjeta();
  }

  function pintarTarjeta() {
    const cont = raiz.querySelector('#tarjeta');
    if (cont) pintar(cont, tarjetaHtml());
  }

  /** Marca la parada elegida en el listado sin redibujarlo. */
  function marcarSeleccion() {
    for (const b of raiz.querySelectorAll('.parada-item')) {
      const sel = b.dataset.codigo === s.elegida?.codigo;
      b.classList.toggle('sel', sel);
      b.setAttribute('aria-checked', String(sel));
    }
    const crear = raiz.querySelector('[data-accion="crear"]');
    if (crear) { crear.disabled = !s.elegida || s.creando; crear.textContent = s.elegida ? 'Crear viaje' : 'Elegí una parada'; }
    const cont = raiz.querySelector('#tarjeta');
    if (!cont && s.elegida) render(); else pintarTarjeta();
  }

  function tarjetaHtml() {
    const e = s.elegida;
    if (!e) return html``;
    const d = s.detalles[e.codigo] ?? {};
    return html`
      <div class="tarjeta parada-elegida">
        <span class="etiqueta-mayus">Tu parada</span>
        <strong class="parada-nombre">${e.nombre}</strong>
        <span class="texto-suave">${e.codigo} · a ${textoDistancia(e.distancia_m)}${d.estado === 'ok' ? ` · ${textoSentido(d.sentido)}` : ''}</span>
        ${d.estado === 'cargando' ? html`<span class="texto-suave">Buscando las líneas que pasan…</span>` : ''}
        ${d.estado === 'error' ? html`<span class="texto-suave">No pudimos ver las líneas ahora, pero podés crear el viaje igual.</span>` : ''}
        ${d.estado === 'ok' ? html`<div class="insignias">${d.lineas.length
          ? [...new Set(d.lineas.map((l) => l.linea))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((n) => html`<span class="insignia chica-i" style="background:${colorInsignia('#ff9500')}">${n}</span>`)
          : html`<span class="texto-suave">No viene ningún bondi con GPS ahora, pero la parada sirve igual.</span>`}</div>` : ''}
        <span class="texto-suave">Después, en la home, podés ocultar las líneas que no te sirven.</span>
      </div>`;
  }

  /** Detalle de las primeras paradas, de a una (para no apilar pedidos a Tu Bondi). */
  async function cargarDetallesIniciales(token) {
    for (const p of s.paradas.slice(0, DETALLE_AUTOMATICO)) {
      if (!vivo || token !== tokenParadas) return;
      await cargarDetalle(p.codigo);
    }
  }

  function render() {
    const scroll = raiz.querySelector('.contenido')?.scrollTop ?? 0;
    const enfocado = document.activeElement?.id;
    const pos = document.activeElement?.selectionStart;
    const e = s.elegida;
    const itemParada = (p, i) => {
      const sel = e?.codigo === p.codigo;
      const [m1, m2] = metaDe(p);
      return html`<li><button class="parada-item ${sel ? 'sel' : ''}" role="radio" aria-checked="${sel}" data-accion="parada" data-codigo="${p.codigo}">
        <span class="parada-num">${i + 1}</span>
        <span class="parada-cuerpo">
          <span class="parada-titulo">${p.nombre}</span>
          <span class="parada-meta" data-meta="1">${m1}</span>
          <span class="parada-meta" data-meta="2" ${m2 ? '' : raw('hidden')}>${m2}</span>
        </span></button></li>`;
    };

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
            <label for="buscar">2 · ¿Dónde estás?</label>
            <div class="fila-input">
              <input id="buscar" class="input" placeholder="Tu calle o una esquina, ej. Tomás Guido" autocomplete="off" value="${s.texto}">
              <button class="boton-cuadrado" data-accion="ubicacion" aria-label="Usar mi ubicación">${raw(ICONO_UBICACION)}</button>
            </div>
            ${s.cargandoBusca ? html`<span class="texto-suave">Buscando…</span>` : ''}
            ${s.sugerencias.length ? html`<ul class="sugerencias">${s.sugerencias.map((x, i) => html`<li><button class="sugerencia" data-accion="lugar" data-i="${i}">${x.texto}</button></li>`)}</ul>` : ''}
            ${s.lugar ? html`<div class="lugar">${raw(ICONO_OK)}<span>${s.lugar.texto}</span></div>` : ''}
            ${s.mensaje ? html`<div class="aviso" role="status">${s.mensaje}</div>` : ''}
          </div>
          ${s.lugar ? html`
          <div class="campo">
            <span class="etiqueta">3 · Elegí tu parada <span class="texto-suave">(las más cercanas a ${s.lugar.texto === 'Mi ubicación' ? 'vos' : 'ese lugar'}, de más cerca a más lejos)</span></span>
            ${s.cargandoParadas ? html`<span class="texto-suave">Buscando paradas cerca…</span>` : ''}
            ${s.paradas && !s.paradas.length ? html`<div class="aviso">No encontramos paradas cerca de ese lugar.</div>` : ''}
            ${s.paradas?.length ? html`<ul class="lista-paradas" role="radiogroup" aria-label="Paradas cercanas">${s.paradas.map(itemParada)}</ul>
              <span class="texto-suave">¿No está la tuya? Probá con otra esquina más cerca de la parada.</span>` : ''}
            <div id="tarjeta">${tarjetaHtml()}</div>
          </div>` : ''}
        </main>
        <footer class="pie solo">
          <button class="boton-primario ancho" data-accion="crear" ${e && !s.creando ? '' : raw('disabled')}>${e ? 'Crear viaje' : 'Elegí una parada'}</button>
        </footer>
      </div>`);
    const cont = raiz.querySelector('.contenido');
    if (cont) cont.scrollTop = scroll;
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
    s.lugar = lugar; s.paradas = null; s.elegida = null; s.detalles = {}; s.sugerencias = []; s.cargandoParadas = true; s.mensaje = null; render();
    try {
      const r = await api.paradasCerca(lat, lon);
      if (mi !== tokenParadas || !vivo) return;
      s.paradas = (Array.isArray(r) ? r : []).map((p) => ({ ...p }));
      s.paradas = porCercania(s.paradas);
      // Si el servidor ya mandó sentido y líneas (servidor completo), se aprovechan.
      for (const p of s.paradas) if (p.sentido && Array.isArray(p.lineas)) s.detalles[p.codigo] = { estado: 'ok', sentido: p.sentido, lineas: p.lineas };
    } catch (err) { if (mi === tokenParadas) { s.mensaje = err.message; s.paradas = []; } }
    finally { if (mi === tokenParadas && vivo) { s.cargandoParadas = false; render(); } }
    if (mi === tokenParadas && vivo && s.paradas?.length) cargarDetallesIniciales(mi);
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
      s.mensaje = 'Buscando tu ubicación…'; render();
      try {
        const { lat, lon } = await obtenerUbicacion();
        if (!vivo) return;
        s.texto = '';
        cargarParadas(lat.toFixed(5), lon.toFixed(5), { texto: 'Mi ubicación', lat, lon });
      } catch (e) { if (vivo) { s.mensaje = mensajeUbicacion(e?.codigo); render(); } }
    } else if (a === 'parada') {
      s.elegida = s.paradas.find((p) => p.codigo === b.dataset.codigo) ?? s.elegida;
      marcarSeleccion();
      if (s.elegida) cargarDetalle(s.elegida.codigo);
    } else if (a === 'crear' && s.elegida && !s.creando) {
      s.creando = true; render();
      const e = s.elegida;
      const sentido = s.detalles[e.codigo]?.sentido;
      const viaje = estado.crearViaje({ nombre: s.nombre, sentido: sentido === 'centro' || sentido === 'afuera' ? sentido : '?', parada: e });
      estado.fijarViajeActivo(viaje.id);
      api.activar(e.codigo); // avisa al servidor (si vigila paradas); en la versión simple no hace nada
      navegar('#/');
    }
  }
  raiz.addEventListener('input', alInput);
  raiz.addEventListener('click', alClick);
  render();
  return () => { vivo = false; raiz.removeEventListener('input', alInput); raiz.removeEventListener('click', alClick); };
}
