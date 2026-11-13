# Plan de desarrollo — "¿Cuándo pasa?"

Qué hace el producto: `SPEC.md`. Cómo se ve: el prototipo (Home + Nuevo viaje).
Este documento dice **cómo se construye**: decisiones técnicas, integraciones, arquitectura, datos, algoritmos, infraestructura y etapas.

---

## 1. Resumen en 30 segundos

- Una **página web instalable (PWA)**, con HTML, CSS y JS sin framework, habla con **un backend propio chico en Node**.
- Ese backend es el único que habla con **Tu Bondi (Micronauta)**. Mantiene la sesión, cachea 15 s, limita el ritmo de pedidos y normaliza los datos.
- Las **"paradas que faltan"** salen de **aprender los recorridos solo con Tu Bondi**: el mismo coche aparece en varias paradas con distintas horas, y eso da el orden.
- Los **viajes y las líneas ocultas** viven en el celular (`localStorage`). El backend guarda lo aprendido en **SQLite**.
- Se hostea en **Fly.io, en la región Buenos Aires**, con un volumen para SQLite. Cuesta unos US$ 0–5 por mes.
- Las **notificaciones push** son una etapa opcional al final.

---

## 2. Decisiones técnicas (y por qué)

| Tema | Elección | Por qué / alternativa descartada |
|---|---|---|
| Lenguaje backend | **Node 24 LTS, JS con ESM** | Los scripts de exploración andan en Node (en WSL hay que instalarlo: nvm + Node 24). Tiene `fetch` y `node:sqlite` nativos, así que no hacen falta dependencias. TypeScript sería un extra innecesario para este tamaño. |
| Framework HTTP | **`node:http` a mano** (~80 líneas de router) | Son 5 endpoints. Si crece: Hono o Fastify. |
| Base de datos | **SQLite con `node:sqlite`** | Un archivo, cero servicios aparte, sobra para miles de observaciones por día. Se descartaron Postgres (de más) y JSON en disco (no aguanta escrituras concurrentes). |
| Frontend | **HTML + CSS + JS vanilla (módulos ES), sin build** | Son 2 pantallas y una lista. Sin React ni bundler: menos que mantener y carga instantánea en el celular. |
| PWA | **manifest + service worker** | Para "agregar a inicio", abrir a pantalla completa y, después, push (en iPhone el push exige la PWA instalada). |
| Estado del usuario | **`localStorage`** | No hay cuentas. Los viajes son de ese celular. `sessionStorage` se borra al cerrar la pestaña, por eso no. |
| Hosting | **Fly.io, región `eze` (Buenos Aires)** | Siempre prendido, con volumen persistente, cerca de Córdoba y por pocos dólares. Render gratis se duerme (30–60 s de arranque) y no sirve para push. Cloudflare Workers saldría con IPs de datacenter globales que Micronauta podría bloquear, y además obliga a pasar SQLite a D1. |
| Tests | **`node:test`** con respuestas grabadas | Viene incluido en Node. |

---

## 3. Integraciones

### 3.1 Tu Bondi / Micronauta (la principal y la única obligatoria)
Base: `https://micronauta4.dnsalias.net/usuario/urbano2_cmd.php?cmd=<cmd>`, siempre con `conf=cbaciudad`.

| Uso | Comando | Cuándo se llama |
|---|---|---|
| Sesión | `GET /usuario/urbano.php?conf=cbaciudad` → cookie `PHPSESSID` | Al arrancar y cuando un pedido devuelve 408 |
| Bondis que vienen a una parada | `POST proximos_arribos` (`codigo`, `onlygps=true`, `show80min=true`) | Cada vez que alguien abre o refresca un viaje (con caché de 15 s), y en el aprendizaje |
| Buscar esquina o calle | `GET buscar_direccion` (`q`) | En "Nuevo viaje", mientras se escribe (debounce 500 ms) |
| Paradas alrededor de un punto | `POST paradas_cercanas` (`lat`, `lon`) | En "Nuevo viaje" y en el aprendizaje |
| Catálogo de líneas y colores | `POST lineasyrutas` | Una vez por día (caché) |

**Reglas de convivencia** (las hace cumplir el cliente, no cada llamada):
- **Ritmo:** cola global con como máximo 1 pedido por segundo hacia Micronauta y nunca más de 2 en paralelo.
- **Caché:** `proximos_arribos` 15 s por parada; `paradas_cercanas` 24 h por punto redondeado a 4 decimales; `buscar_direccion` 24 h por texto.
- **Deduplicación en vuelo:** si 3 usuarios piden SM02 al mismo tiempo, sale 1 solo pedido.
- **Timeout** de 10 s; **reintento** 1 vez solo ante un 408 (renovando la sesión).
- **Corte de emergencia (circuit breaker):** con 5 errores seguidos, se deja de llamar 60 s y se sirve el último dato con la marca "desactualizado".
- **User-Agent** genérico, sin datos personales.
- **No se usan** endpoints que piden el header anti-bot `X-Device-FlakerParam` (`seleccionatraza`, `consultacocheporruta`).
- **Validación del formato:** cada respuesta se valida (los campos esperados existen y tienen el tipo esperado). Si cambia el formato, se loguea un error claro y la página muestra "Tu Bondi cambió algo".

**Resultados de las pruebas reales (13/11/2026, 15:09, desde un servidor):**

| Prueba | Resultado |
|---|---|
| `proximos_arribos` **sin cookie** | `HTTP 408`, cuerpo vacío → hay que abrir sesión primero |
| Sesión `GET urbano.php` | `200`, 118 ms, `Set-Cookie: PHPSESSID=…` (la página pesa 300 KB: pedirla solo para la sesión, no parsearla) |
| `proximos_arribos` SM02 | `200`, **~1,7 s**, 7 KB, 10 items / **9 coches únicos** (hay duplicados por coche) |
| `buscar_direccion` "castro barros y europa" | `200`, 0,5 s → `[{"lat":-31.4017,"lon":-64.1965,"display_name":"Bv Castro Barros y Europa"}]` |
| `paradas_cercanas` en esa esquina | `200`, 0,8 s, `{ok:true, paradas:[58]}` ordenadas por cercanía; las 2 primeras son PR01 y SM02 |
| `lineasyrutas` | `200`, 0,4 s, 72 líneas (TAMSE, SiBus, Coniferal, SolBus) |
| 5 pedidos seguidos a SM02, uno por segundo | todos `200`, 1,6–1,8 s, sin bloqueos |

Detalles que el código tiene que manejar:
- **Latencia de ~1,7 s** en `proximos_arribos`: la caché de 15 s y la deduplicación de pedidos en vuelo son obligatorias para que la página se sienta rápida. El frontend muestra el último dato al toque y refresca en segundo plano.
- **`notificacion`** trae los **desvíos** del recorrido. Es texto con entidades HTML (`&#128204;`, `&#128205;`) y saltos `\r\n`: hay que decodificar las entidades y **escapar** el texto antes de mostrarlo (nunca insertarlo como HTML).
- `a` = `[lat_parada, lon_parada, lat_coche, lon_coche]` (números).
- `horaTeoricaAjustada` es la estimada y `horaTeorica` la programada, las dos en `HH:MM:SS`. Ojo con el cruce de medianoche: si la hora es mucho menor que la actual, es del día siguiente.
- Para `lineasyrutas`, el `sentido` de cada ruta (I/V) no dice centro/afuera; el sentido se calcula aparte (§6.3).

Ejemplo real (abreviado) de un item de `proximos_arribos`:
```json
{"coche":"92","linea":"14","linea_nombre":"14","ruta":"11","ruta_descripcion":"1° DE MAYO A POLICIAL",
 "color":"#ff9500","cliente_nombre":"CONIFERAL","a":[-31.4011,-64.196608,-31.40638,-64.193926],
 "dist_parada":640,"horaTeoricaAjustada":"15:09:25","horaTeorica":"15:02:00","proximo":"Llegando",
 "notificacion":"Zamudio - Acevedo - Tulumba - Su ruta &#128204; PARADAS PROVISORIAS: ..."}
```

### 3.2 APIs del navegador
- **Geolocation** ("usar mi ubicación" en Nuevo viaje). Requiere HTTPS, que Fly da.
- **localStorage** para los viajes y las líneas ocultas.
- **Page Visibility:** el refresco cada 30 s se pausa con la pestaña oculta y se refresca apenas vuelve.
- **Service Worker + Push API** (solo en la etapa opcional).

### 3.3 Web Push (opcional, Etapa 8)
- Librería **`web-push`** (la única dependencia del proyecto) con claves **VAPID** generadas una vez y guardadas como secretos de Fly.
- Los envíos los entregan gratis los servicios de push de Google, Mozilla y Apple.

### 3.4 Monitoreo (gratis)
- **Better Stack o UptimeRobot** (plan gratis) pegándole a `/salud` cada 5 min.
- Logs con `fly logs`.

### 3.5 Lo que **no** se integra
- **GTFS municipal (2023):** está vencido, los códigos no coinciden y los recorridos cambiaron. Ya se analizó y queda descartado.
- **Nominatim (OpenStreetMap)**, el geocodificador de respaldo que usa la web de Tu Bondi, queda **fuera de v1**. Si `buscar_direccion` no encuentra algo, el usuario usa "mi ubicación". Si se agrega después: máximo 1 pedido por segundo y User-Agent propio, según su política de uso.
- **Telegram:** descartado por el usuario.

---

## 4. Arquitectura

```
 Celular (PWA)                                Backend (Fly.io, eze)                         Externo
┌──────────────────────┐   HTTPS /api/*   ┌───────────────────────────────────┐   HTTPS   ┌────────────────────┐
│ index.html / app.js  │ ───────────────▶ │ http.js  (router, rate limit/IP)  │           │ Tu Bondi           │
│ - Home (lista única) │                  │   │                               │           │ (Micronauta)       │
│ - Nuevo viaje        │ ◀─────────────── │   ├─ servicios/parada.js ──┐      │ ────────▶ │ proximos_arribos   │
│ localStorage:        │      JSON        │   ├─ servicios/buscar.js   ├─▶ tubondi/cliente.js │ paradas_cercanas   │
│  viajes, ocultas     │                  │   └─ servicios/viaje.js ───┘   (sesión, cola 1 rps, │ buscar_direccion   │
│ sw.js (instalable,   │                  │                                 caché, breaker,   │ lineasyrutas       │
│  push opcional)      │                  │ aprendizaje/  (tarea c/10 min)   validación)      └────────────────────┘
└──────────────────────┘                  │   observar.js → ordenar.js                        
                                          │ db.js  (SQLite en volumen /data)                  
                                          └───────────────────────────────────┘
```

**Estructura del repo:**
```
cuando-pasa/
├─ server/
│  ├─ index.js              arranque, tareas programadas
│  ├─ http.js               router mínimo, estáticos, rate limit por IP, /salud
│  ├─ db.js                 node:sqlite + migraciones
│  ├─ tubondi/
│  │  ├─ cliente.js         sesión, cola, caché, breaker, reintento 408
│  │  ├─ normalizar.js      deduplicar, "4min"→4, hora→Date, GPS
│  │  └─ validar.js         chequeo del formato de cada respuesta
│  ├─ servicios/
│  │  ├─ parada.js          lista única de próximos para una parada
│  │  ├─ buscar.js          esquina → paradas cercanas + sentido
│  │  └─ sentido.js         centro / afuera
│  └─ aprendizaje/
│     ├─ observar.js        guarda observaciones (parada, coche, hora)
│     └─ ordenar.js         deduce las paradas previas y los minutos típicos
├─ web/
│  ├─ index.html  app.js  estilos.css  manifest.webmanifest  sw.js  iconos/
├─ test/
│  ├─ fixtures/             respuestas reales grabadas de Tu Bondi
│  └─ *.test.js
├─ scripts/                 probar.js, grabar-fixture.js, aprender-ya.js
├─ fly.toml  Dockerfile  README.md
```

---

## 5. Modelo de datos

### Backend (SQLite)
```sql
-- Paradas conocidas (se completan solas con paradas_cercanas / proximos_arribos)
CREATE TABLE parada (
  codigo TEXT PRIMARY KEY, nombre TEXT, lat REAL, lon REAL,
  sentido TEXT CHECK (sentido IN ('centro','afuera','?')), actualizado INTEGER);

-- Qué línea+ruta se vio pasar alguna vez por cada parada (para ofrecer TODAS las líneas)
CREATE TABLE linea_en_parada (
  parada TEXT, linea TEXT, ruta TEXT, destino TEXT, color TEXT, visto INTEGER,
  PRIMARY KEY (parada, linea, ruta));

-- Materia prima del aprendizaje: "el coche X de la línea L se esperaba en la parada S a las HH:MM"
CREATE TABLE observacion (
  ts INTEGER, parada TEXT, linea TEXT, ruta TEXT, coche TEXT, hora_estimada INTEGER,
  lat_coche REAL, lon_coche REAL);
CREATE INDEX obs_coche ON observacion (linea, ruta, coche, ts);

-- Resultado: paradas previas a P para una línea+ruta, en orden (1 = la anterior a P)
CREATE TABLE previa (
  parada_destino TEXT, linea TEXT, ruta TEXT, orden INTEGER, parada TEXT,
  min_tipicos REAL, confianza REAL, actualizado INTEGER,
  PRIMARY KEY (parada_destino, linea, ruta, orden));

-- Lo que el backend "vigila" (paradas de viajes que alguien abrió en los últimos 14 días)
CREATE TABLE parada_activa (parada TEXT PRIMARY KEY, ultimo_uso INTEGER);

-- (Etapa 8) suscripciones push
CREATE TABLE suscripcion (id TEXT PRIMARY KEY, parada TEXT, lineas TEXT, n_paradas INTEGER,
  dias TEXT, desde TEXT, hasta TEXT, endpoint TEXT, p256dh TEXT, auth TEXT);
```
Las observaciones se purgan a los 30 días.

### Celular (`localStorage["viajes"]`)
```json
[{ "id":"v1", "nombre":"Ir al trabajo", "sentido":"afuera",
   "parada":{"codigo":"SM02","nombre":"Av Castro Barros 443"},
   "ocultas":["15","17"], "creado":"2026-11-13" }]
```
Se guardan las **ocultas** y no las elegidas: si aparece una línea nueva en la parada, se muestra sola.

---

## 6. Algoritmos

### 6.1 Lista de próximos (cada refresco, 1 pedido a Tu Bondi como máximo)
1. `proximos_arribos(P)`, servido de la caché si tiene menos de 15 s.
2. Normalizar:
   - Deduplicar por `coche + linea`.
   - Calcular `minutos` = `horaTeoricaAjustada` − ahora (o `proximo` si no hay hora).
   - Descartar los coches con minutos < 0 (ya pasaron).
3. Para cada coche, calcular **paradas que faltan**, en este orden de preferencia:
   1. **Por GPS:** con las paradas previas aprendidas de esa línea + ruta, buscar la parada previa más cercana al GPS del coche (y si está antes o después de ella). Faltan = su orden.
   2. **Por minutos:** contar las previas cuyos `min_tipicos` son menores que los minutos del coche.
   3. **Sin dato:** `faltan = null`. La fila va al final, en chico.
4. Registrar la observación (alimenta el aprendizaje, sin pedidos extra).
5. Ordenar: primero los que tienen dato, por hora; después los sin dato, por hora. El cliente aplica el filtro de ocultas.

### 6.2 Aprender paradas previas (tarea cada 10 min, de 6 a 23 h, solo para paradas activas)
Ya se validó a mano en PR01 (orden exacto) y en SM02.
1. Para la parada P: `proximos_arribos(P)` → coches que se acercan, con su GPS.
2. Para hasta 3 coches por línea: `paradas_cercanas(GPS del coche)` → candidatas (radio 150 m), que se guardan en `parada`.
3. Para cada candidata nueva: `proximos_arribos(candidata)`. Si lista la misma línea + ruta, se guardan observaciones.
4. **Ordenar:** para cada coche visto en 2 o más paradas, se toman las diferencias `hora_estimada(P) − hora_estimada(S)`. Las S con diferencia > 0 son previas. Su `min_tipicos` es la mediana de las diferencias de todos los coches y de todas las pasadas.
5. Las previas se ordenan por `min_tipicos`. La confianza crece con la cantidad de coches que las vieron. Se guardan las 6 primeras en `previa`.
6. **Presupuesto:** como máximo 15 pedidos por parada por pasada. Cuando una línea + ruta tiene 6 previas con confianza alta, se deja de aprender y se re-verifica una vez por semana (los recorridos cambian).
   - Costo estimado: unos 100 pedidos por día por parada nueva durante 2–3 días, y después unos 10 por día.

### 6.3 Sentido de una parada (centro / afuera)
- Con `proximos_arribos(S)`: por cada coche, se compara su distancia a la Plaza San Martín (−31.4167, −64.1836) con la de la parada.
- Si la mayoría viene de más lejos, la parada es **"centro"**. Si no, **"afuera"**. Si no hay coches, queda `'?'`.
- Se guarda en `parada.sentido` y se recalcula si sale `'?'`.

### 6.4 Nuevo viaje
1. `buscar_direccion(texto)` → sugerencias. Probado: entiende "Castro Barros y Europa".
2. Al elegir una: `paradas_cercanas(lat, lon)` → se calcula el sentido de las 2–4 más cercanas.
3. Se muestran **Hacia el centro / Hacia afuera** con la parada más cercana de cada sentido, sus líneas (de `linea_en_parada` + el `proximos_arribos` actual) y sus destinos típicos.
4. "Crear viaje" guarda en `localStorage` y marca la parada como activa en el backend, lo que dispara el aprendizaje.

---

## 7. API propia (contrato)

| Método y ruta | Devuelve |
|---|---|
| `GET /api/buscar?q=castro barros y europa` | `[{texto, lat, lon}]` |
| `GET /api/paradas?lat=&lon=` | `[{codigo, nombre, lat, lon, distancia_m, sentido, lineas:[{linea, destino}]}]` |
| `GET /api/parada/SM02` | la lista de próximos (abajo) |
| `POST /api/parada/SM02/activar` | `204`: la marca como activa para el aprendizaje |
| `GET /salud` | `{ok, tubondi:"ok"|"degradado", ultima_respuesta_ok}` |

`GET /api/parada/SM02`:
```json
{
  "parada": {"codigo":"SM02","nombre":"Av Castro Barros 443","sentido":"afuera"},
  "actualizado": "2026-11-13T13:27:12-03:00",
  "desactualizado": false,
  "lineas": [{"linea":"10","destino":"Lasalle","color":"#ff9500"}, "..."],
  "proximos": [
    {"linea":"18","destino":"Saldán","color":"#ff9500","coche":"306",
     "hora":"13:31","minutos":4,"faltan_paradas":1,"fuente_paradas":"gps",
     "desvio":"Parada anulada: Bv. San Juan 464 · Parada provisoria: M. T. de Alvear 211"},
    {"linea":"12","destino":"Policial","hora":"13:58","minutos":31,"faltan_paradas":null}
  ]
}
```
Además: límite de 60 pedidos por minuto por IP, sin CORS (mismo origen) y sin datos personales.

---

## 8. Frontend

- **`app.js`** (unas 300 líneas):
  - Router por hash: `#/` es la Home y `#/nuevo` es Nuevo viaje.
  - Render con template strings, sin framework.
  - Estado en `localStorage`.
- **Home:**
  - Pestañas de viajes.
  - Lista única: la primera fila resaltada y las que no tienen dato al final, en chico.
  - Botón "Líneas N/M" con chips para ocultar o mostrar.
  - "Actualizado hace N s", Actualizar y Eliminar viaje (con `confirm`).
- **Refresco:** cada 30 s con `setInterval`. Se pausa con `visibilitychange` y refresca al volver. El contador "hace N s" corre cada 1 s.
- **Errores:**
  - Si Tu Bondi no responde, se muestran los últimos datos con un aviso "desactualizado".
  - Si no hay bondis, aparece el estado vacío.
  - Sin conexión, el service worker sirve la app y el último JSON.
- **Accesibilidad:** botones reales, contraste AA, objetivos táctiles de 44 px o más, y `aria-live="polite"` en la lista.
- **Lo que pesa:** unos 15 KB de JS + CSS. Sin fuentes externas (se usa la del sistema) para que cargue al instante con 4G malo.

---

## 9. Infraestructura y costos

| Pieza | Elección | Costo |
|---|---|---|
| App | Fly.io, 1 máquina `shared-cpu-1x` de 256 MB, región `eze` | ~US$ 2–4 por mes (o $0 con su crédito, si aplica) |
| Disco | Fly Volume de 1 GB en `/data` (SQLite) | ~US$ 0,15 por mes |
| HTTPS y dominio | `cuando-pasa.fly.dev` incluido; dominio propio opcional | $0 (dominio ~US$ 10 por año, opcional) |
| Monitoreo | UptimeRobot o Better Stack, plan gratis | $0 |
| Push | Servicios de push del navegador | $0 |

- **Deploy:** `fly launch` con un Dockerfile de Node 24 slim, `fly volumes create data`, y después `fly deploy`.
- **Secretos:** las claves VAPID, cuando llegue la etapa de push.
- **Backup:** copia diaria de SQLite a otro archivo en el mismo volumen. No es crítico: lo aprendido se re-aprende en días.

---

## 10. Calidad y operación

- **Tests unitarios:** normalizar, ordenar (con las observaciones reales de PR01/SM02 del 13/11), sentido y lista de próximos.
- **Fixtures:** `scripts/grabar-fixture.js SM02` guarda respuestas reales para los tests.
- **Canario:** una tarea cada hora pide `proximos_arribos` de una parada fija y valida el formato. Si falla 3 veces, `/salud` pasa a "degradado" y el monitor avisa por mail.
- **Logs:** un log estructurado por pedido a Tu Bondi (comando, ms, status, de caché o no), sin datos del usuario.
- **Prueba real:** una semana de uso, comparando "faltan N paradas" con lo que se ve en la calle y ajustando el radio y el presupuesto del aprendizaje.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Micronauta cambia o bloquea la API (no es oficial) | Uso mínimo (caché, deduplicación, 1 pedido por segundo) y validación del formato con canario. Pedirle a la Municipalidad (Gobierno Abierto) o a Micronauta un feed oficial; la app ya tiene la interfaz `tubondi/cliente.js` para cambiar la fuente sin tocar el resto. |
| Bloqueo de la IP del servidor | Se nota en el canario. Alternativa: otra región u otro proveedor. Como el volumen es bajo, el riesgo es bajo. |
| Pocas observaciones → paradas que faltan incompletas | Respaldo por minutos y si no "sin dato", al final de la lista. Se completa con el tiempo. |
| "Mi ubicación" no anda sin HTTPS | En producción hay HTTPS. En desarrollo por IP local se usa solo la búsqueda. |
| Push en iPhone | Solo con la PWA instalada (iOS 16.4 o más). Se explica en la pantalla al activarlo. |

---

## 12. Etapas

Cada etapa termina en algo que se puede probar. Las estimaciones son para una persona.

### Etapa 0 — Descubrimiento ✅ (hecho el 13/11)
- [x] Endpoints de Tu Bondi identificados y probados desde un servidor (con sesión).
- [x] GTFS analizado y descartado como fuente.
- [x] Método de las paradas previas validado en PR01 y SM02.
- [x] Parada de ella: SM02. Alcance: lista única, filtro de líneas y viajes.
- [x] Prototipo de UI aprobado.
- [ ] Código de la parada de Plaza Rafael Núñez (se resuelve con la pantalla Nuevo viaje).

### Etapa 1 — Esqueleto + cliente de Tu Bondi (1 día)
- [ ] Repo, `server/index.js`, `http.js` con `/salud` y estáticos.
- [ ] `tubondi/cliente.js`: sesión, cola de 1 pedido por segundo, caché, deduplicación, timeout, reintento ante 408 y corte de emergencia.
- [ ] `normalizar.js` y `validar.js`, con tests sobre fixtures.
- [ ] `scripts/probar.js SM02`.
**Listo cuando:** `node scripts/probar.js SM02` imprime los bondis reales, y 20 llamadas seguidas generan como máximo 2 pedidos a Tu Bondi.

### Etapa 2 — Datos y aprendizaje (1,5 días)
- [ ] `db.js` con las migraciones de §5.
- [ ] `observar.js`: guarda observaciones desde cada `proximos_arribos`.
- [ ] `ordenar.js`: medianas, orden y confianza (§6.2), con tests usando los datos reales del 13/11.
- [ ] Tarea programada cada 10 min para las paradas activas, con su presupuesto.
- [ ] `sentido.js` (§6.3).
**Listo cuando:** después de un día corriendo, SM02 tiene 6 previas para la 13 y la 18, y `linea_en_parada` tiene 10, 11, 12, 13, 14, 15, 17, 18, 19 y 83.

### Etapa 3 — API (1 día)
- [ ] `/api/parada/:codigo` con la lista de §6.1 (GPS → minutos → sin dato).
- [ ] `/api/buscar`, `/api/paradas` (con sentido y líneas) y `/activar`.
- [ ] Rate limit por IP; marca "desactualizado" cuando el corte de emergencia está activo.
**Listo cuando:** `curl /api/parada/SM02` devuelve el JSON de §7 con datos reales.

### Etapa 4 — Frontend (1,5 días)
- [ ] Home como en el prototipo: pestañas, lista única, filtro de líneas, refresco y eliminar.
- [ ] Nuevo viaje: búsqueda con debounce, "mi ubicación", centro / afuera y crear.
- [ ] Estados de error, vacío y desactualizado.
- [ ] Desvíos: si el bondi trae `desvio`, la fila muestra un "⚠ desvío" chico que al tocarlo despliega el texto (escapado).
- [ ] Manifest, íconos y service worker (instalable, último JSON sin conexión).
**Listo cuando:** se crea el viaje "Ir al trabajo" en SM02 desde el celular (por la red local) y la lista se actualiza sola.

### Etapa 5 — Publicar (½ día)
- [ ] Dockerfile, `fly.toml`, volumen y deploy en `eze`.
- [ ] Monitor externo sobre `/salud` y canario cada hora.
- [ ] Instalarla en los dos celulares.
**Listo cuando:** funciona con 4G desde la parada.

### Etapa 6 — Semana de prueba y ajustes (½ día repartido)
- [ ] Usarla de lunes a viernes. Anotar diferencias entre "faltan N" y lo real.
- [ ] Ajustar el radio de candidatas, el presupuesto y el umbral de confianza.

### Etapa 7 — Opcional: notificaciones push (1,5–2 días)
- [ ] En el viaje: "Avisarme cuando falten ≤ N paradas", con días y franja horaria (ej. L–V 13:15–13:45).
- [ ] El service worker se suscribe y la suscripción se guarda en `suscripcion`.
- [ ] Tarea dentro de la franja: `proximos_arribos` cada 30–60 s (usa la caché); un aviso por coche.
- [ ] `web-push` con VAPID; probar en Android y en iPhone con la PWA instalada.

**Total v1 (Etapas 1–6): ~6 días.** Con push, ~8 días.

---

## 13. Después (no v1)
- Pedirle a la Municipalidad un feed oficial de tiempo real (GTFS-Realtime) y cambiar de fuente.
- Respaldo de búsqueda con Nominatim.
- Compartir un viaje por link (que se pueda abrir en otro celular con la misma parada y las mismas ocultas).
