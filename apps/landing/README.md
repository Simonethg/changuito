# @changuito/landing

Landing de marketing para **www.changuito.me**. Es un proyecto Next.js aparte de `apps/web` (el shopper, en app.changuito.me).

No comparte rutas con el shopper. Durante la beta controlada, los botones «Probar Changuito» van a `/whitelist`. `APP_URL` (`https://app.changuito.me`) queda para SEO y docs, sin navegación desde la landing.

## Vercel

Crear un **proyecto nuevo**, no reusar el de `apps/web`.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root Directory | `apps/landing` |
| Node.js | **22.x** (el repo pide `>=22.12`) |
| Install command | default — Vercel instala desde la raíz del monorepo (`npm ci`) |
| Build command | default — corre `next build` de este paquete |
| Environment variables | el sitio se construye sin ellas. `/whitelist` en producción no anota a nadie si faltan Turnstile o un destino. `/reportarbug` funciona sin variables (ver abajo). |

Dominio de producción: `www.changuito.me`. `app.changuito.me` sigue en el proyecto de `apps/web`.

La lista de espera vive en `/whitelist`. No hace falta login de Vercel para mergear el código: el próximo deploy toma la ruta. Sin un destino configurado, producción responde que no pudo anotar a la persona (no finge el alta). En `next dev` / `next start` local, si no hay variables, el alta se agrega a `apps/landing/.data/waitlist.jsonl` (gitignored).

### Variables que el proyecto de Vercel de la landing tiene que tener

El proyecto de `apps/web` (`app.changuito.me`) no comparte env con este. Las keys de Turnstile que ya usa el shopper hay que copiarlas al proyecto de la landing. Si falta alguna, `/whitelist` responde 503: «No pudimos anotarte por un problema nuestro. Probá de nuevo en un rato.» Producción no saltea el CAPTCHA.

En el proyecto de Vercel de **landing**, Production (y Preview si se prueba el alta ahí):

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `WAITLIST_WEBHOOK_URL`
- `WAITLIST_WEBHOOK_SECRET`

Analytics es opcional y gratis. Si estas variables quedan vacías, la landing no carga gtag, Meta Pixel ni Clarity. Setealas en **Production** del proyecto de Vercel de la landing. Preview y local pueden quedar sin ellas.

- `NEXT_PUBLIC_GA_MEASUREMENT_ID` (GA4, forma `G-XXXX`)
- `NEXT_PUBLIC_META_PIXEL_ID` (numérico)
- `NEXT_PUBLIC_CLARITY_PROJECT_ID`

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` entra en el bundle del cliente: un valor vacío deja el formulario sin widget. `TURNSTILE_SECRET_KEY`, `WAITLIST_WEBHOOK_URL` y `WAITLIST_WEBHOOK_SECRET` son de servidor. Los tres ids de analytics también son públicos y, vacíos, no cargan scripts. Un cambio de env se aplica en el próximo deploy.

Elegí **uno** de estos destinos. Si están los dos, Redis es el registro y el webhook recibe una copia. El alta en vivo va a Apps Script, así que las dos variables del webhook hacen falta.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `WAITLIST_WEBHOOK_URL` | en producción, salvo que haya Redis | `POST` JSON `{ kind, name, email, source, otherDetail, whatsapp, whatsappGroup, userAgent, createdAt }` y, si hay secreto, `webhookSecret`. HTTPS (Apps Script, Notion, Sheets, Slack, Make). `http` solo en `localhost`. |
| `WAITLIST_WEBHOOK_SECRET` | junto con el webhook en producción | `Authorization: Bearer …` y el mismo valor en el cuerpo como `webhookSecret`. Apps Script no entrega `Authorization` ni headers custom en `e.headers`; `doPost` tiene que leer el secreto del body y no guardarlo en la hoja. Un HTTP 200 con `{ "ok": false }` es un fallo, no un alta. |
| `KV_REST_API_URL` o `UPSTASH_REDIS_REST_URL` | la otra vía | El mismo Redis REST que ya usa el shopper. La landing es otro proyecto de Vercel: hay que conectar la integración ahí, no se hereda sola. |
| `KV_REST_API_TOKEN` o `UPSTASH_REDIS_REST_TOKEN` | junto con la URL | Token REST. Nunca commitearlo. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | en producción | Site key pública de Cloudflare Turnstile (widget en el formulario). Tiene que estar en este proyecto, no solo en el del shopper. |
| `TURNSTILE_SECRET_KEY` | en producción | Secret key de Turnstile (solo servidor; verifica el token antes de guardar). Nunca commitearla. Si falta esta o la site key, producción rechaza el alta. |

El Apps Script (`appendWaitlist_`) no está en este repo. El `POST` manda este JSON (header `X-Changuito-Waitlist: 1`), con los nombres que el script ya lee:

| Campo | Tipo | Notas |
|---|---|---|
| `kind` | string | Siempre `"waitlist"`. |
| `name` | string | Nombre limpio. El script también acepta `nombre`. |
| `email` | string | En minúsculas. |
| `source` | string | Una opción de la lista (el valor visible). El script también acepta `fuente`. |
| `otherDetail` | string o `null` | Solo si `source` es `Otros`. El script también acepta `detalle_otros`. |
| `whatsapp` | string | Obligatorio. E.164 con `+`. Un número argentino local se guarda como `+549…` (se saca el `15` y se agrega el `9`). |
| `whatsappGroup` | boolean | `true` si quiere entrar al grupo de beta testers. En la hoja va a `grupo_whatsapp`. |
| `userAgent` | string | Solo si el request trae `User-Agent`. El script también acepta `user_agent`. |
| `createdAt` | string | ISO 8601. |
| `webhookSecret` | string | Solo si `WAITLIST_WEBHOOK_SECRET` está seteado. Es auth, no un dato de la persona. El script lo lee y no lo escribe en la fila. |

No se envía `feedback` ni `contactForFeedback`. La pregunta de contacto quedó reemplazada por `whatsappGroup`.

### Cloudflare Turnstile

El formulario de `/whitelist` manda un token de Turnstile con el alta. El servidor lo verifica contra `siteverify` antes de persistir. El honeypot (`company`) y el rate-limit siguen activos; el CAPTCHA es adicional.

- **Producción:** si faltan `NEXT_PUBLIC_TURNSTILE_SITE_KEY` o `TURNSTILE_SECRET_KEY` en el proyecto de Vercel de la landing, el alta se rechaza (mismo espíritu que un sink sin configurar). No se saltea la verificación.
- **Local / no-production:** si las keys no están, el submit se acepta sin widget (se loguea un aviso una vez) para que `next dev` siga funcionando.

Creá un widget en el [dashboard de Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) (o reusá el de `app.changuito.me` si el hostname `www.changuito.me` está permitido) y pegá las dos keys en el proyecto de Vercel de la landing.

La clave de Redis es `changuito:landing:waitlist` (hash por email, `HSETNX`), para no pisar las sesiones del shopper si comparten base.

## Reportar un bug

`/reportarbug` es la página pública para contar un fallo (la app enlaza `https://www.changuito.me/reportarbug`). El pie del home también apunta ahí.

Si `BUG_REPORT_WEBHOOK_URL` está configurada, el servidor hace `POST` JSON. Si no está, el reporte se acepta igual y queda en el log del proceso con el prefijo `[bug-report]`, para que la página sirva antes de tener un destino. Un webhook que responde mal sí es un error: la persona puede reintentar. Un HTTP 200 con `{ "ok": false }` también es un fallo.

| Variable | Obligatoria | Para qué |
|---|---|---|
| `BUG_REPORT_WEBHOOK_URL` | no | `POST` JSON con `kind: "bug"`, el relato en `error`, cómo repetirlo en `pasos`, `adjuntos` (foto o video en base64) y, si hay secreto, `webhookSecret`. `http` solo en `localhost`. |
| `BUG_REPORT_WEBHOOK_SECRET` | no | Si está, va como `Authorization: Bearer …` y el mismo valor en el cuerpo como `webhookSecret`. Apps Script no entrega `Authorization` ni headers custom en `e.headers`; `doPost` tiene que leer el secreto del body y no guardarlo en la hoja. Un HTTP 200 con `{ "ok": false }` es un fallo, no un reporte guardado. |

La mascota de esa página es `public/brand/mascot-error.png` (el carrito idle con ojos en X y gesto hacia abajo). No se usa en el hero ni en el GIF de carga.

El adjunto es opcional: hasta 3 archivos, 3 MB en total, JPG, PNG, WEBP, GIF, MP4, WEBM o MOV. El tope entra en el cuerpo del request (el base64 lo agranda) y en lo que Apps Script sube a Drive. Cada ítem va `{ name, mimeType, base64 }`. El script los sube y escribe las URLs en la columna `adjuntos`.

Si el dashboard no detecta el workspace y pide comandos a mano (el working directory es `apps/landing`):

```bash
npm ci --prefix ../..
npm run build -w @changuito/landing --prefix ../..
```

El lockfile está en la raíz. No hace falta `vercel.json`: los headers de seguridad salen de `next.config.ts`.

## Monorepo

Desde la raíz del repo:

```bash
npm ci
npm run dev -w @changuito/landing      # http://localhost:3125
npm run build -w @changuito/landing
npm test -w @changuito/landing
npm run typecheck -w @changuito/landing
```

El paquete entra por el workspace `apps/*` del `package.json` raíz. No depende de `@changuito/mcp` ni de los bindings.

## Assets

El kit completo vive en `apps/branding/` (manuals, logo, mascota, pattern, motion, social, copy, tokens). Esta app solo copia a `public/` lo que la página sirve:

| Público | Origen |
|---|---|
| `public/brand/animacion-cargando.gif` | `apps/branding/motion/animacion-cargando.gif` (asset de marca; el hero ya no lo usa: es una demo en código) |
| `public/brand/mascot-idle.png` | `apps/branding/mascot/mascota-idle.png` (movimiento reducido, header de `/whitelist`, pie y cierre) |
| `public/brand/mascota-corriendo.png` | `apps/branding/mascot/mascota-corriendo.png` (CTA, en el lugar de la flecha) |
| `public/brand/wordmark.png` | `apps/branding/logo/wordmark.png` (lettering chunky con Sol de Mayo). Header de `/` (solo), `/whitelist` y `/reportarbug`. El mismo archivo está en `apps/web/public/brand`. |
| `public/og.jpg` | pose idle ancha del zip de landing (1280×720, JPEG), Open Graph y Twitter. El archivo anterior se llamaba `og.png` pero los bytes eran JPEG, así que el content-type no coincidía. |
| `public/brand/isotipo-mascota.png` | `apps/branding/logo/isotipo-mascota.png` (isotipo del JSON-LD, no va en el header) |
| `public/brand/mascot-error.png` | carrito idle con ojos en X y gesto hacia abajo. Header de `/reportarbug`, junto al wordmark. |
| `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` | mascota idle completa (`mascota-idle.png`) encajada en un cuadrado con margen transparente (16/32/48, 32 y 180). Sin recorte de cara. Los mismos archivos están en `apps/web/app`. `/whitelist` hereda estos íconos (no hay `app/whitelist/icon.png`). |

El header del home es solo el wordmark. El pie y el cierre siguen con la mascota idle y la palabra «Changuito» en Inter. `/whitelist` muestra la mascota idle y el wordmark. `/reportarbug` muestra la mascota de error y el wordmark. El fondo es `#FAFAF7` plano: el patrón mate-pan no se tilea.

## SEO

No hace falta ninguna variable de entorno. El HTML sale en `es-AR`. Next genera, en el build:

| Ruta | Qué es |
|---|---|
| `/robots.txt` | permite indexar las páginas de marketing (también a buscadores y crawlers de respuesta) y deja afuera `/api/` |
| `/sitemap.xml` | `/`, `/whitelist`, `/reportarbug` |
| `/llms.txt` | resumen en texto, armado con el copy público |
| `/manifest.webmanifest` | nombre, idioma e íconos |

El shopper (`app.changuito.me`) tiene su propio `robots.txt` y no se toca desde acá. `?estado=` en la lista y en el reporte de bug no se indexa; el canonical queda en la URL limpia.
