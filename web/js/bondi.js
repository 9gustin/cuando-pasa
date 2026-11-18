// Dibujos de colectivos (HTML + clases de estilos.css). Todo dato de la API pasa por `html` (escapa).
import { html } from './util.js';

const raw = (s) => html([s]);

/** Color de la empresa (franja del bondi). Solo #rrggbb; cualquier otra cosa → naranja Coniferal. */
export function colorEmpresa(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex : '#FF9500';
}

/**
 * Un bondi de costado: cartel LED con número y destino, minutos grandes, hora y una línea de detalle.
 * variante: 'grande' (el próximo) | 'normal' | 'chico' (el que sigue / sin dato).
 */
export function bondiHtml({ linea, destino, color, minutos, hora, detalle, variante = 'normal', sticker = '', gira = false, bota = false }) {
  return html`
    <div class="bondi-auto ${variante}" style="--empresa:${colorEmpresa(color)}">
      ${sticker ? html`<span class="sticker">${sticker}</span>` : ''}
      <div class="bondi-cuerpo ${bota ? 'bote' : ''}">
        <div class="cartel"><span class="cartel-num">${linea}</span><span class="cartel-dest">${destino}</span></div>
        <div class="bondi-info">
          <span class="min">${minutos}<small> min</small></span>
          <span class="info-col"><span class="hora">${hora}</span><span class="sub">${detalle}</span></span>
        </div>
        ${raw('<span class="franja"></span><span class="vidrio"></span><span class="farol"></span>')}
      </div>
      ${raw(`<span class="rueda r1 ${gira ? 'gira' : ''}"></span><span class="rueda r2 ${gira ? 'gira' : ''}"></span>`)}
    </div>`;
}

/** Bondi en miniatura para "La calle". pct: 0 = lejos (30 min), 100 = en tu parada. */
export function miniHtml({ linea, color, pct, carril }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return html`<span class="mini ${carril ? 'abajo' : ''}" style="--empresa:${colorEmpresa(color)};left:calc(${p}% - ${Math.round(p * 0.46)}px)"><span class="mini-led">${linea}</span></span>`;
}

/** Cartel de parada (poste con círculo). */
export const ICONO_PARADA = '<span class="poste" aria-hidden="true"><span class="poste-palo"></span><span class="poste-cartel"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="15" rx="3"></rect><path d="M4 11h16"></path><path d="M7 21v-3"></path><path d="M17 21v-3"></path></svg></span></span>';
