// Nuevo viaje: nombre → dónde estás (esquina o ubicación) → elegir una de las paradas más cercanas → crear.
import { html, pintar, debounce, textoSentido } from './util.js';
import { bondiHtml, colorEmpresa } from './bondi.js';
import * as estado from './estado.js';
import * as api from './api.js';

const raw = (s) => html([s]);
const DETALLE_AUTOMATICO = 5; // a las primeras N paradas se les pide sentido y líneas solas; al resto, al tocarlas
const ICONO_VOLVER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>';
const ICONO_UBICACION = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>';
const ICONO_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F4FB8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';
const ICONO_FLECHA = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>';
const POSTE_MINI = '<span class="poste chico" aria-hidden="true"><span class="poste-palo"></span><span class="poste-cartel"></span></span>';
const NOMBRES_RAPIDOS = ['Ir al trabajo', 'Volver a casa', 'Facultad', 'Gimnasio'];

/** Líneas de una parada, una por número, ordenadas, con el color de su empresa. */
export const lineasDeParada = (lineas) => {
  const m = new Map();
  for (const l of lineas ?? []) if (!m.has(l.linea)) m.set(l.linea, l);
  return [...m.values()].sort((a, b) => a.linea.localeCompare(b.linea, 'es', { numeric: true }));
};

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
      s.detalles[codigo] = { estado: 'ok', sentido: d.parada.sentido, lineas: d.lineas, proximos: d.proximos ?? [] };
    } catch { s.detalles[codigo] = { estado: 'error' }; }
    if (vivo) actualizarDetalle(codigo);
  }

  /** Partes de la tarjeta de una parada que cambian cuando llega su detalle (sin tocar el botón). */
  function partesDe(p, i) {
    const d = s.detalles[p.codigo];
    const sentido = d?.estado === 'ok' && (d.sentido === 'centro' || d.sentido === 'afuera') ? d.sentido : null;
    const lineas = d?.estado === 'ok' ? lineasDeParada(d.lineas) : [];
    let estadoTxt = '';
    if (d?.estado === 'cargando') estadoTxt = 'Mirando qué bondis pasan…';
    else if (d?.estado === 'error') estadoTxt = 'No pudimos ver qué bondis pasan ahora.';
    else if (d?.estado === 'ok' && !lineas.length) estadoTxt = 'Ahora no viene ningún bondi con GPS.';
    else if (!d && i >= DETALLE_AUTOMATICO) estadoTxt = 'Tocá para ver qué bondis pasan';
    return {
      meta: `${p.codigo} · a ${textoDistancia(p.distancia_m)}`,
      sentido: sentido ? html`<span class="sentido ${sentido}">${raw(ICONO_FLECHA)} ${textoSentido(sentido).toLowerCase()}</span>`
        : d?.estado === 'ok' ? html`<span class="sentido">sentido sin confirmar</span>` : html``,
      lineas: lineas.length ? html`<span class="leds">${lineas.map((l) => html`<span class="led-chico" style="--empresa:${colorEmpresa(l.color)}">${l.linea}</span>`)}</span>
        <span class="parada-meta">Van a ${destinosEjemplo(d.lineas)}</span>` : html``,
      estadoTxt, cargando: d?.estado === 'cargando', tocable: !d && i >= DETALLE_AUTOMATICO,
    };
  }

  /**
   * Cuando llega el detalle de una parada se cambia SOLO el contenido de adentro, sin reemplazar los botones:
   * si se redibuja el listado justo mientras el dedo toca un botón, el toque se pierde.
   */
  function actualizarDetalle(codigo) {
    const i = s.paradas?.findIndex((x) => x.codigo === codigo) ?? -1;
    const btn = raiz.querySelector(`.parada-item[data-codigo="${CSS.escape(codigo)}"]`);
    if (i >= 0 && btn) {
      const pr = partesDe(s.paradas[i], i);
      pintar(btn.querySelector('[data-parte="sentido"]'), pr.sentido);
      pintar(btn.querySelector('[data-parte="lineas"]'), pr.lineas);
      const est = btn.querySelector('[data-parte="estado"]');
      est.textContent = pr.estadoTxt; est.hidden = !pr.estadoTxt;
      est.classList.toggle('titila', pr.cargando); est.classList.toggle('tocable', pr.tocable);
    }
    if (s.elegida?.codigo === codigo) { pintarTarjeta(); marcarPasos(); }
  }

  function pintarTarjeta() {
    const cont = raiz.querySelector('#tarjeta');
    if (cont) pintar(cont, tarjetaHtml());
  }

  /** Pinta las paradas del recorrido (1, 2, 3) según lo completado, sin redibujar. */
  function marcarPasos() {
    const hechos = [!!s.nombre.trim(), !!s.lugar, !!s.elegida];
    raiz.querySelectorAll('.paso-num').forEach((el, i) => el.classList.toggle('hecho', hechos[i]));
  }

  /** Marca la parada elegida en el listado sin redibujarlo. */
  function marcarSeleccion() {
    for (const b of raiz.querySelectorAll('.parada-item')) {
      const sel = b.dataset.codigo === s.elegida?.codigo;
      b.classList.toggle('sel', sel);
      b.setAttribute('aria-checked', String(sel));
    }
    const crear = raiz.querySelector('[data-accion="crear"]');
    if (crear) {
      crear.disabled = !s.elegida || s.creando;
      crear.querySelector('[data-texto]').textContent = s.elegida ? 'Crear viaje' : 'Elegí una parada';
    }
    marcarPasos();
    const cont = raiz.querySelector('#tarjeta');
    if (!cont && s.elegida) render(); else pintarTarjeta();
  }

  /** "Ahora mismo viene…": el próximo bondi real de la parada elegida. */
  function tarjetaHtml() {
    const e = s.elegida;
    if (!e) return html``;
    const d = s.detalles[e.codigo] ?? {};
    let contenido;
    if (d.estado === 'ok' && d.proximos?.length) {
      const p = d.proximos[0];
      const otros = d.proximos.length - 1;
      contenido = html`${bondiHtml({
        linea: p.linea, destino: p.destino, color: p.color, minutos: p.minutos, hora: p.hora,
        detalle: otros > 0 ? `y ${otros} bondi${otros === 1 ? '' : 's'} más en camino` : 'por ahora es el único en camino',
        gira: true,
      })}`;
    } else if (d.estado === 'ok') contenido = html`<span class="texto-suave">Ahora no viene ningún bondi con GPS, pero la parada sirve igual.</span>`;
    else if (d.estado === 'error') contenido = html`<span class="texto-suave">No pudimos ver los bondis ahora, pero podés crear el viaje igual.</span>`;
    else contenido = html`<span class="texto-suave titila">Mirando qué bondis vienen…</span>`;
    return html`
      <section class="paso">
        <span class="paso-num final" aria-hidden="true">${raw(ICONO_OK)}</span>
        <span class="paso-titulo">Ahora mismo viene…</span>
        ${contenido}
        <span class="texto-suave">Después, en el inicio, podés apagar las líneas que no te sirven.</span>
      </section>`;
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
      const pr = partesDe(p, i);
      return html`<li><button class="parada-item ${sel ? 'sel' : ''}" role="radio" aria-checked="${sel}" data-accion="parada" data-codigo="${p.codigo}">
        ${raw(POSTE_MINI)}
        <span class="parada-cuerpo">
          <span class="parada-titulo">${p.nombre}</span>
          <span class="parada-meta">${pr.meta}</span>
          <span data-parte="sentido">${pr.sentido}</span>
          <span class="parada-estado ${pr.cargando ? 'titila' : ''} ${pr.tocable ? 'tocable' : ''}" data-parte="estado" ${pr.estadoTxt ? '' : raw('hidden')}>${pr.estadoTxt}</span>
          <span class="parada-lineas" data-parte="lineas">${pr.lineas}</span>
        </span></button></li>`;
    };
    const hechos = [!!s.nombre.trim(), !!s.lugar, !!e];

    pintar(raiz, html`
      <div class="pantalla">
        <header class="cabecera fila-cab">
          <a class="boton-volver" href="#/" aria-label="Volver">${raw(ICONO_VOLVER)}</a>
          <h1 class="cartel-titulo"><span id="cartel-nombre">Nuevo viaje${s.nombre.trim() ? ` · ${s.nombre.trim()}` : ''}</span></h1>
        </header>
        <main class="contenido form">
          <div class="recorrido">
            <section class="paso">
              <span class="paso-num ${hechos[0] ? 'hecho' : ''}" aria-hidden="true">1</span>
              <label class="paso-titulo" for="nombre">¿Cómo le ponemos?</label>
              <input id="nombre" class="input" placeholder="Ir al trabajo" maxlength="40" autocomplete="off" value="${s.nombre}">
              <div class="chips">${NOMBRES_RAPIDOS.map((n) => html`<button class="chip-texto" data-accion="nombre-rapido" data-nombre="${n}" aria-pressed="${s.nombre === n}">${n}</button>`)}</div>
            </section>
            <section class="paso">
              <span class="paso-num ${hechos[1] ? 'hecho' : ''}" aria-hidden="true">2</span>
              <label class="paso-titulo" for="buscar">¿Dónde te tomás el bondi?</label>
              <input id="buscar" class="input" placeholder="Tu calle o una esquina, ej. Castro Barros y Europa" autocomplete="off" value="${s.texto}">
              ${s.cargandoBusca ? html`<span class="texto-suave titila">Buscando…</span>` : ''}
              ${s.sugerencias.length ? html`<ul class="sugerencias">${s.sugerencias.map((x, i) => html`<li><button class="sugerencia" data-accion="lugar" data-i="${i}">${x.texto}</button></li>`)}</ul>` : ''}
              ${s.lugar ? html`<div class="lugar">${raw(ICONO_OK)}<span>${s.lugar.texto}</span></div>` : ''}
              <button class="boton-ubicacion" data-accion="ubicacion">${raw(ICONO_UBICACION)} Mejor usá mi ubicación</button>
              ${s.mensaje ? html`<div class="aviso" role="status">${s.mensaje}</div>` : ''}
            </section>
            ${s.lugar ? html`
            <section class="paso">
              <span class="paso-num ${hechos[2] ? 'hecho' : ''}" aria-hidden="true">3</span>
              <span class="paso-titulo">Elegí tu parada</span>
              <span class="texto-suave">Las más cercanas a ${s.lugar.texto === 'Mi ubicación' ? 'vos' : 'ese lugar'}. Fijate la vereda: cada una va para un lado.</span>
              ${s.cargandoParadas ? html`<span class="texto-suave titila">Buscando paradas cerca…</span>` : ''}
              ${s.paradas && !s.paradas.length ? html`<div class="aviso">No encontramos paradas cerca de ese lugar.</div>` : ''}
              ${s.paradas?.length ? html`<ul class="lista-paradas" role="radiogroup" aria-label="Paradas cercanas">${s.paradas.map(itemParada)}</ul>
                <span class="texto-suave">¿No está la tuya? Probá con otra esquina más cerca de la parada.</span>` : ''}
            </section>` : ''}
            <div id="tarjeta">${tarjetaHtml()}</div>
          </div>
        </main>
        <footer class="pie solo">
          <button class="boton-timbre ancho" data-accion="crear" ${e && !s.creando ? '' : raw('disabled')}><span class="timbre" aria-hidden="true"></span><span data-texto>${e ? 'Crear viaje' : 'Elegí una parada'}</span></button>
          <span class="texto-suave centrado">Queda fijo en tu inicio. Lo podés borrar cuando quieras.</span>
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
    if (ev.target.id === 'nombre') {
      s.nombre = ev.target.value;
      const cartel = raiz.querySelector('#cartel-nombre');
      if (cartel) cartel.textContent = `Nuevo viaje${s.nombre.trim() ? ` · ${s.nombre.trim()}` : ''}`;
      for (const c of raiz.querySelectorAll('[data-accion="nombre-rapido"]')) c.setAttribute('aria-pressed', String(c.dataset.nombre === s.nombre));
      marcarPasos();
    }
    else if (ev.target.id === 'buscar') { s.texto = ev.target.value; buscarDebounced(); }
  }
  async function alClick(ev) {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const a = b.dataset.accion;
    if (a === 'nombre-rapido') { s.nombre = b.dataset.nombre; render(); }
    else if (a === 'lugar') { const l = s.sugerencias[+b.dataset.i]; if (l) { s.texto = l.texto; cargarParadas(l.lat, l.lon, l); } }
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
