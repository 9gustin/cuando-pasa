# Referencia (exploración del 13/11/2026)

Material de la etapa de descubrimiento. **No es el código de la app**: sirve para copiar ideas y para verificar.

## scripts/ (Node, sin dependencias; se corren con `node <script>`)
| Archivo | Qué hace | Ejemplo |
|---|---|---|
| `tb.mjs` | Cliente mínimo de Tu Bondi: sesión (cookie), `paradasCercanas`, `arribos`, `hav` (distancia) | (lo importan los demás) |
| `pruebas.mjs` | Batería de pruebas contra Tu Bondi con todas las respuestas | `node pruebas.mjs` |
| `buscar_parada.mjs` | Paradas sobre una calle cerca de varios puntos + qué líneas pasan | `node buscar_parada.mjs castro '[[-31.401,-64.1967]]'` |
| `ordenar.mjs` | Ordena paradas candidatas por la hora estimada del mismo coche (validó BG01→…→PR01) | `node ordenar.mjs PR01,BG05,BG04,BG03,BG02,BG01 13 "A C. UNIVERSITARIA"` |
| `aprender.mjs` | Versión 1 del aprendizaje de paradas previas usando el GPS de los coches | `node aprender.mjs SM02 13,18 2` |

## prototipo/
Las dos pantallas aprobadas (Home con lista única + Nuevo viaje). Están en el formato `.dc.html` del lienzo de diseño de Claude: **no se abren tal cual en un navegador** (dependen de `support.js`). Hay que leerlas como referencia visual y de comportamiento: estructura, textos, colores, tamaños y estados. La versión navegable está en https://claude.ai/artifact/H3ddzbbW6xFWiafFpzdDTW (privada, del dueño del proyecto).
