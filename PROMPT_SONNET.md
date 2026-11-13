Vas a construir "¿Cuándo pasa?", una web app (PWA) para ver los próximos colectivos de una parada de Córdoba (Argentina), usando los datos de Tu Bondi. El descubrimiento, el diseño y las pruebas contra la API ya están hechos: tu trabajo es implementar el plan, etapa por etapa.

## Leé primero, en este orden
1. `SPEC.md`: qué hace el producto y por qué (alcance cerrado: solo la parada de subida, una lista única de próximos colectivos, filtro de líneas y viajes guardados).
2. `PLAN.md`: cómo se construye. Ahí están el stack, las integraciones, los resultados reales de las pruebas contra Tu Bondi (§3.1), la arquitectura y la estructura del repo (§4), el modelo de datos (§5), los algoritmos (§6), el contrato de la API (§7), el frontend (§8), la infraestructura (§9) y las **etapas con su criterio de "listo"** (§12).
3. `referencia/README.md` y los scripts de `referencia/scripts/`: ya funcionan contra Tu Bondi. Reusá su lógica (sesión, pedidos, ordenamiento por hora del mismo coche).
4. `referencia/prototipo/`: las dos pantallas aprobadas, como referencia visual (no se abren tal cual en el navegador; ver el README).

## Cómo trabajar
- Ejecutá **una etapa de §12 por vez**, empezando por la **Etapa 1**. Al terminar cada una:
  - Corré su verificación ("Listo cuando…") y los tests.
  - Hacé un commit (`git init` al principio si no hay repo).
  - **Pará y reportame**: qué hiciste, la salida de la verificación y qué falta. No empieces la etapa siguiente sin mi OK.
- Respetá las decisiones del plan. Si algo del plan no funciona en la práctica, avisame con la evidencia y una propuesta antes de cambiar de enfoque.
- Entorno: **WSL (Ubuntu)**, en esta carpeta. Al 13/11 **no había Node instalado en WSL**: lo primero es correr `node -v`. Si falta o es menor a 24, pasame los comandos para instalar Node 24 LTS con nvm y esperá mi OK (no instales nada por tu cuenta). Usá `node:http`, `node:sqlite`, `node:test` y `fetch` nativo. **Cero dependencias npm** hasta la Etapa 7 (ahí se permite solo `web-push`).
- Frontend: HTML + CSS + JS vanilla con módulos ES, sin framework ni build. Textos de la UI en español rioplatense ("Próximos colectivos", "en 4 min", "falta 1 parada").

## Reglas con Tu Bondi (no negociables)
- La API no es oficial. Todo pedido pasa por `server/tubondi/cliente.js`, con una cola global de **como máximo 1 pedido por segundo**, caché (15 s para `proximos_arribos`), deduplicación de pedidos en vuelo, timeout de 10 s, renovación de sesión ante un **408** y corte de emergencia (§3.1).
- **No uses** endpoints que piden el header `X-Device-FlakerParam` (`seleccionatraza`, `consultacocheporruta`), ni intentes reproducir ese header.
- En los tests usá **fixtures grabadas**, no la API en vivo. Las pruebas en vivo, pocas y espaciadas, solo con los scripts de verificación.
- User-Agent genérico. No mandes ningún dato personal a ningún servicio externo.
- El texto de `notificacion` (desvíos) trae entidades HTML: decodificalo y **escapalo** antes de mostrarlo. Nunca lo insertes como HTML.

## Lo que necesita mi OK explícito antes de hacerlo
- Crear cuentas o recursos en Fly.io (o en cualquier otro servicio), hacer deploy, generar claves VAPID o configurar monitoreo externo (Etapas 5 y 7). Cuando llegues ahí, dejame los comandos exactos y yo los corro o te doy el OK.
- Agregar cualquier dependencia npm.
- Hacer push a un remoto.

## Datos útiles para probar
- La parada principal es **SM02** ("Av Castro Barros 443", entre Europa y Palestina, sentido "hacia afuera"). La de enfrente es **PR01** ("hacia el centro").
- Pasan por SM02: 10, 11, 12, 13, 14, 15, 17, 18, 19 y 83.
- "castro barros y europa" en `buscar_direccion` devuelve lat −31.4017, lon −64.1965.

Empezá leyendo los archivos y arrancá con la **Etapa 1**.
