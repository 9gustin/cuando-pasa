# Spec — "¿Cuándo salgo?" (colectivos Córdoba)

## 1. Problema

Tu Bondi muestra un colectivo por vez: elegís línea, después recorrido, y recién ahí ves dónde está. Si podés tomar varias líneas (10, 13, 18, 19…), tenés que repetir eso por cada una. Además no responde la pregunta real: **¿a qué hora salgo de casa?**

## 2. Objetivo

Una página web simple, pensada para el celular, donde:

1. Creás uno o más **viajes** ("Ir al trabajo", "Vuelta"). Cada viaje es **un nombre + la parada donde subís + el sentido** (hacia el centro / hacia afuera). Quedan **fijos en la home** como pestañas hasta que los elimines.
2. Al abrirla, con la **hora actual**, ves:
   - **Una sola lista** con todos los bondis que vienen, ordenados por hora. Cada fila dice: **línea → destino · faltan N paradas · HH:MM · en N min**. La primera va resaltada como "el próximo".
   - Los que no tienen dato de paradas van al final, más chiquitos.
3. **Filtro de líneas:** aparecen todas las líneas de la parada y con un toque ocultás las que no te sirven (ej. 15, 17). Quedan guardadas como ocultas y se pueden volver a mostrar.
4. Se actualiza sola cada 30 s y tiene un botón **Actualizar**.

**No hay** parada de bajada, hora de llegada al destino, caminata ni "salí a las". Esto queda para más adelante, si hace falta.

**Opcional (v1.1): notificaciones push.** Ver §11. Fuera de alcance: mapa, planificador origen → destino y cuentas de usuario.

## 3. Usuarios y casos

| Viaje | Parada (Tu Bondi) | Sentido | Líneas |
|---|---|---|---|
| Ir al trabajo (ella) | **SM02**, "Av Castro Barros 443", entre Europa y Palestina | Hacia afuera | Todas las que pasan; ella oculta las que no le sirven |
| Vuelta (ella) | (a definir) | Hacia el centro | |
| Sanatorio Allende (yo) | Plaza Rafael Núñez, sobre Castro Barros (falta el código) | Hacia afuera (Cerro) | |

Líneas que pasan hoy por cada parada, según Tu Bondi (13/11/2026):
- **PR01:** 10 → Ituzaingó, 11 → V. Bustos, 12 → Ituzaingó, 13 → C. Universitaria, 14 → 1° de Mayo, 15 → Ampl. Ferreyra, 17 → Ituzaingó, 18 → C. Universitaria, 19 → C. Universitaria.
- **SM02:** 10 → Lasalle, 11 → V. Allende, 12 → Policial, 13 → V. Rivera Indarte, 14 → Policial, 15 → V. Allende Parque, 17 → Nueva Esperanza, 18 → Saldán, 19 → V. Warcalde, 83 → Alto Alberdi.

## 4. Fuente de datos: **Tu Bondi es la fuente de verdad**

### 4.1 Backend de Tu Bondi (Micronauta)
No es una API pública ni documentada. Base: `https://micronauta4.dnsalias.net/usuario/urbano2_cmd.php`, con el parámetro `conf=cbaciudad`.

- **Sesión:** primero `GET /usuario/urbano.php?conf=cbaciudad`, que da la cookie `PHPSESSID`. Sin cookie responde `408`. Si un pedido devuelve 408, se renueva la sesión y se reintenta una vez.
- **CORS:** solo acepta su propio origen. El navegador no puede llamarlo directo, así que **hace falta un backend propio (proxy)**.

| Comando | Método | Parámetros | Uso |
|---|---|---|---|
| `proximos_arribos` | POST form | `codigo` (parada, ej. `PR01`), `conf`, `onlygps=true`, `show80min=true` | **Principal.** Todos los coches que vienen a la parada, de todas las líneas |
| `paradas_cercanas` | POST form | `lat`, `lon`, `conf` | Paradas alrededor de un punto: `codigo`, `parada_nombre`, `lat`, `lon` |
| `buscar_direccion` | GET | `q`, `conf` | Calle o esquina → lat/lon. Ej. "castro barros y europa" |
| `lineasyrutas` | POST | `conf` | Catálogo de líneas, recorridos y colores |

Campos que se usan de `proximos_arribos`: `linea_nombre`, `ruta`, `ruta_descripcion` (hacia dónde va), `coche`, `proximo` ("Llegando" o "4min"), `horaTeoricaAjustada`, `dist_parada` (metros **en línea recta**), `a` = `[lat_parada, lon_parada, lat_coche, lon_coche]`, `color` y `notificacion` (desvíos).

Notas:
- Un mismo coche puede venir repetido con dos `ruta`; se deduplica por `coche` + `linea`.
- **No se usan** endpoints que piden el header anti-bot `X-Device-FlakerParam` (por ejemplo `seleccionatraza`).
- Ritmo: como máximo 1 pedido por segundo y caché de 15 s por parada.

**Buscar parada (no hace falta un catálogo de todas):**
1. `buscar_direccion("Castro Barros y Europa")` → "Bv Castro Barros y Europa" con lat/lon (probado: también entiende esquinas).
2. `paradas_cercanas(lat, lon)` → las paradas alrededor, normalmente las dos veredas.
3. No encontré un endpoint de "todas las paradas", pero estos dos alcanzan. Si algún día hiciera falta un catálogo, se arma acumulando lo que devuelve `paradas_cercanas`.

**Sentido (hacia el centro / hacia afuera):** cada vereda es una parada distinta (en Castro Barros, `SM…` hacia afuera y `BG…`/`PR…` hacia el centro). Para etiquetar cada parada candidata sin pedírselo al usuario:
- Se mira `proximos_arribos` de esa parada. Para cada coche se compara la distancia al centro (Plaza San Martín, −31.4167, −64.1836) de **la parada** contra la del **coche** (`a`).
- Si la mayoría de los coches están más lejos del centro que la parada, esa vereda es **"hacia el centro"**. Si no, **"hacia afuera"**.
- De ayuda se muestran los destinos más comunes (`ruta_descripcion`): "V. Rivera Indarte, Saldán…".
- Si una parada no tiene coches en ese momento, se ofrece igual con "sentido desconocido" y los destinos vistos antes.

### 4.2 Paradas previas: se aprenden de Tu Bondi (validado)

Tu Bondi no expone, sin el header anti-bot, la lista de paradas de un recorrido. Igual se puede deducir:

> **El mismo coche aparece en varias paradas con distinta hora estimada. La parada donde llega antes está antes en el recorrido.**

Prueba real (13/11/2026, 14:22) con la 13 → C. Universitaria y el coche 382:

| BG01 (C.B. 1527) | BG02 (C.B. 1224) | BG03 (C.B. 1125) | BG04 (C.B. 965) | BG05 (C.B. 605) | **PR01** |
|---|---|---|---|---|---|
| 14:22 | 14:23 | 14:24 | 14:25 | 14:26 | **14:27** |

El orden sale exacto: BG01 → BG02 → BG03 → BG04 → BG05 → PR01. En la 18, el coche 71 no aparece en BG02, y BG02 tampoco lista la 18: el método detecta las paradas donde la línea no para.

Segunda prueba en **SM02** (13/11/2026), con el algoritmo de abajo y candidatas buscadas a partir del GPS de los coches:
- **13 → V. Rivera Indarte:** encontró 6 paradas anteriores: CU16 Av Valparaíso → OB02 Bv San Juan 464 → LC11 Mariano Fragueiro 329 / LC04 Corro 63 → LC12 Humberto Primo 850 → SM01 Castro Barros 58 → SM02.
- **18 → Saldán:** encontró 1 (CE47 Jujuy 29), porque el único coche estaba a 9 min.
- Conclusión: sirve, pero **se completa con varias pasadas**. Con pocos datos, la lista queda incompleta y se usa el plan B. **Es aceptable:** lo importante es saber qué bondis están cerca (≤ 6 paradas), no el nombre de cada parada.

**Algoritmo "aprender recorrido"** (en el backend, al guardar un viaje y después en segundo plano):
1. Llamar a `proximos_arribos(P)` en la parada del usuario. Para cada línea + ruta elegida, se toman las posiciones GPS de los coches que se acercan.
2. **Candidatas:** `paradas_cercanas` en la parada P y en las posiciones GPS de esos coches (y puntos intermedios). Quedan solo las paradas cuyo `proximos_arribos` lista esa misma línea + ruta.
3. **Orden:** para cada coche que aparece en 2 o más candidatas, ordenar por `horaTeoricaAjustada`. Combinar varios coches y varias consultas.
4. Guardar las **6 paradas previas** a P (N = 6, configurable) en `data/recorridos/<P>_<linea>_<ruta>.json`, con código, nombre, lat/lon y minutos típicos hasta P.
5. Volver a aprender a demanda o una vez por semana, porque los recorridos cambian. Es una sola vez por viaje, no en cada consulta.

**El GTFS oficial** (`cordoba.gtfs_3.zip`, de 2023 y vencido) **no es fuente de verdad**. Se analizó: los códigos de parada no coinciden con los de Tu Bondi y algunos recorridos cambiaron (la 13 y la 18 tienen otra punta). Solo queda como **pista opcional** para sembrar candidatas cuando no hay coches circulando (de noche). No es requisito de v1.

**Plan B** (paradas que todavía no se aprendieron): "paradas que faltan" ≈ `dist_parada` ÷ 350 m, y se muestran como "Parada N antes". Los minutos y la hora siempre son los de Tu Bondi, así que la lista funciona igual.

### 4.3 Qué líneas se ofrecen en una parada
**Todas** las que pasan por ella, no una lista fija:
- `proximos_arribos(P)` con `show80min=true` da las líneas + destino que vienen en los próximos 80 min.
- El backend **recuerda** cada línea + ruta que vio alguna vez en esa parada (`data/paradas/<P>.json`). Así una línea que justo no tiene coches ahora igual aparece para elegir.

## 5. Lógica en vivo (cada refresco)

- **Un solo pedido por refresco:** `proximos_arribos(P)`. Se sacan las líneas ocultas por el usuario.
- **Hora de paso:** `horaTeoricaAjustada` (o ahora + `proximo` min). "En N min" = esa hora − la hora actual del usuario.
- **El próximo que te sirve:** el primero por hora entre las líneas visibles.
- **Paradas que faltan:** con el GPS del coche (`a[2], a[3]`) y las paradas aprendidas, se busca el tramo (parada i → i+1) más cercano. Si no hay paradas aprendidas, se usa el plan B. Si el coche ya pasó P, se descarta.
- **Orden de la lista:** primero los que tienen "paradas que faltan", por hora; después los que no tienen ese dato, por hora.
- **Refresco:** cada 30 s en el cliente, más el botón Actualizar. El backend cachea cada parada 15 s.

## 6. Arquitectura

```
[Celular: PWA]  --/api/*-->  [Backend propio: Node 24 + SQLite, en Fly.io (eze)]  -->  Tu Bondi (Micronauta)
 localStorage: viajes, ocultas     sesión + cola 1 pedido/s + caché 15 s + aprendizaje
```

El detalle técnico (stack, integraciones, modelo de datos, algoritmos, contrato de la API, infraestructura y etapas) está en **`PLAN.md`**.

## 7. Almacenamiento en el cliente

`localStorage["viajes"]` (persiste; `sessionStorage` se borra al cerrar la pestaña). Se guardan las líneas **ocultas** y no las elegidas, así una línea nueva aparece sola:
```json
[{ "id":"v1", "nombre":"Ir al trabajo", "sentido":"afuera",
   "parada":{"codigo":"SM02","nombre":"Av Castro Barros 443"},
   "ocultas":["15","17"] }]
```
Los viajes quedan fijos hasta que se eliminan desde la home (con confirmación).

## 8. Pantallas (ver el prototipo)

1. **Home** (un viaje por pestaña):
   - Pestañas con los viajes, "+ Nuevo viaje" y "ahora HH:MM".
   - **"Próximos colectivos": una sola lista**, ordenada por hora, de todos los bondis que vienen de las líneas visibles:
     - Cada fila: número grande · "→ Saldán" · "falta 1 parada" · **13:31** · "en 4 min".
     - La primera fila va resaltada (fondo oscuro, "El próximo").
     - Las filas sin dato de paradas van al final, más chicas y en gris ("sin dato de paradas").
     - No hay grupos Cerca / Más lejos ni carril de paradas: alcanza con comparar "faltan N paradas" y "en N min" para decidir cuál tomar.
   - Botón **Líneas 8/10** arriba de la lista: abre los chips de todas las líneas para ocultar o mostrar. Debajo dice "Ocultas: 15, 17".
   - "Actualizado hace N s" y el botón Actualizar.
   - "Eliminar este viaje", con confirmación.
   - Estado vacío: "No viene ningún bondi con GPS".
2. **Nuevo viaje:**
   1. Nombre ("Ir al trabajo").
   2. ¿Dónde te tomás el bondi? Se escribe una esquina o calle (con sugerencias de `buscar_direccion`) o se usa "mi ubicación".
   3. ¿Para qué lado vas? **Hacia el centro / Hacia afuera**, cada uno con sus destinos de ejemplo. Abajo se ve la parada que corresponde, con todas sus líneas.
   4. "Crear viaje".

## 9. Riesgos

- **API no oficial:** puede cambiar o bloquearse. Para mitigarlo: uso moderado, caché, nada de endpoints con anti-bot, y contactar a la Municipalidad o a Micronauta si se usa más allá de lo personal.
- **Aprendizaje incompleto:** si pasan pocos coches, faltan paradas en la lista. Se completa con el tiempo y mientras tanto se usa el plan B.
- **`dist_parada` es en línea recta:** solo sirve para el plan B.
- **"Cerca mío" necesita HTTPS:** funciona en el hosting, no por IP local.

## 10. Decisiones abiertas

1. ~~¿PR01 o SM02?~~ **SM02**.
2. Código de la parada de Plaza Rafael Núñez y qué líneas van hacia el Sanatorio Allende.
3. Dónde hostear.

## 11. Opcional: notificaciones push (v1.1)

"Avisame cuando un bondi de este viaje esté a ≤ N paradas", de lunes a viernes, dentro de una franja horaria (ej. 13:15–13:45).

Qué hace falta:
- **En el cliente:** un service worker y un manifest (instalar en la pantalla de inicio), y pedir permiso. En **iPhone solo funciona con la página instalada** en la pantalla de inicio (iOS 16.4 o más).
- **En el backend:**
  - Claves VAPID y guardar la suscripción de cada viaje con su franja.
  - Una tarea que, dentro de la franja, consulta `proximos_arribos` cada 30 a 60 s y manda el push una sola vez por coche.
  - Esto requiere un servidor siempre prendido (los planes gratis que se duermen no sirven).
- Librería: `web-push` (Node). Costo de servicios: $0 (el push lo envían Google o Apple gratis). Solo se paga el servidor si el plan gratis no alcanza.
- **Esfuerzo estimado:** 1,5 a 2 días. No es caro, pero se deja para después de que la página esté andando.
