# ¿Cuándo pasa?

Web app (PWA) para ver los próximos colectivos de una parada de Córdoba con datos de Tu Bondi.
Qué hace: [SPEC.md](SPEC.md). Cómo se construye: [PLAN.md](PLAN.md). Cero dependencias npm; Node ≥ 24.

## Desarrollo

```bash
node server/index.js          # http://localhost:3000  (PORT=3111 para otro puerto)
node --test test/             # tests, con fixtures grabadas (no usan la API en vivo)
```

Variables: `PORT` (3000), `DB_PATH` (`data/cuando-pasa.db`).

> **SQLite y WSL:** si corrés Node en Windows sobre una carpeta de WSL (`\\wsl.localhost\...`), SQLite da
> `database is locked`. Corré Node **dentro de WSL**, o apuntá `DB_PATH` a un disco local de Windows.

### Scripts (los que tocan Tu Bondi en vivo: usarlos poco)
| Script | Qué hace |
|---|---|
| `node scripts/probar.js SM02 [n]` | Imprime los próximos de la parada; con `n` llamadas seguidas comprueba caché y dedup |
| `node scripts/aprender-ya.js SM02 [pasadas] [presupuesto]` | Corre pasadas de aprendizaje de paradas previas y muestra el resultado |
| `node scripts/grabar-fixture.js SM02` | Graba una respuesta real en `test/fixtures/` |
| `node scripts/hacer-iconos.js` | Regenera los íconos de la PWA |

## Reglas con Tu Bondi
Todo pedido pasa por `server/tubondi/cliente.js`: cola de 1 pedido/s, caché (15 s en `proximos_arribos`),
deduplicación en vuelo, timeout 10 s, renovación de sesión ante 408 y corte de emergencia. No se usan endpoints
con `X-Device-FlakerParam`. El texto de desvíos se decodifica en el servidor y se muestra siempre escapado.

## Publicar en Fly.io (Etapa 5)
La región `eze` (Buenos Aires) está retirada en Fly: se usa `gru` (São Paulo).
Los archivos están listos (`Dockerfile`, `fly.toml`) pero **no se ejecutó nada**. Cuando quieras, estos son los comandos:

```bash
fly auth login
fly launch --no-deploy --copy-config --name cuando-pasa --region gru   # si el nombre está tomado, elegí otro y ajustá fly.toml
fly volumes create data --region gru --size 1
fly deploy
fly status && curl https://cuando-pasa.fly.dev/salud
```

Después: un monitor gratis (UptimeRobot o Better Stack) pegándole a `https://<app>.fly.dev/salud` cada 5 min, y abrir la
URL desde los celulares → "Agregar a pantalla de inicio".

## Versión MVP gratis en Vercel (sin base de datos, sin cron)
`vercel.json` + `api/` publican la misma API como funciones: consultan a Tu Bondi **solo cuando alguien abre la app o
aprieta Actualizar** (sin caché ni refresco automático; "faltan ~N paradas" se estima por distancia). No hay aprendizaje ni
SQLite. El servidor completo (Fly.io, `server/`) queda aparte, para cuando haya que aprender paradas.

```bash
npx vercel login
npx vercel --prod      # primera vez: contestar las preguntas (proyecto nuevo "cuando-pasa", directorio actual)
```
