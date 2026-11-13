// Router por hash: #/ = Home, #/nuevo = Nuevo viaje.
import { montarHome } from './home.js';
import { montarNuevo } from './nuevo.js';

const raiz = document.getElementById('app');
let desmontar = () => {};

function ruta() {
  desmontar();
  const destino = location.hash.replace(/^#/, '') || '/';
  raiz.scrollTop = 0;
  desmontar = destino === '/nuevo' ? montarNuevo(raiz, (h) => { location.hash = h; }) : montarHome(raiz);
}

addEventListener('hashchange', ruta);
ruta();

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* sin offline, la app sigue andando */ }));
}
