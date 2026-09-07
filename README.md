# AI Inversionista

AI Inversionista es una aplicación web para consultar mercados, conversar con un analista financiero basado en IA y construir planes orientativos de inversión desde una interfaz limpia y directa.

El proyecto combina un backend en FastAPI con un frontend estático en HTML, CSS y JavaScript. La aplicación permite pedir análisis de activos, comparar instrumentos, revisar noticias de mercado, visualizar gráficas y enviar planes de inversión por correo.

> Nota: el contenido generado por la aplicación es orientativo y no constituye asesoramiento financiero profesional.

## Funcionalidades

- Chat financiero en español con contexto conversacional.
- Análisis de acciones, ETFs, índices y criptomonedas por ticker o nombre.
- Gráficas de mercado con rangos `1D`, `5D`, `1M`, `6M`, `1Y` y `5Y`.
- Comparativas entre activos como `VOO vs QQQ` o `Apple frente a Microsoft`.
- Feed de noticias financieras con fuentes externas.
- Planificador de inversión con perfiles conservador, moderado y agresivo.
- Captura de leads y envío de planes por email mediante Resend.
- Rate limiting y cabeceras básicas de seguridad.

## Estructura del proyecto

```text
.
├── app/
│   ├── backend/
│   │   ├── Bots/              # Lógica de decisión, prompts y rutas del chat
│   │   ├── core/              # Creación de app, CORS, seguridad y arranque
│   │   ├── services/          # Servicios de chat y datos de mercado
│   │   ├── config.py          # Variables de entorno y rutas de datos
│   │   ├── csv_utils.py       # Persistencia local de leads y planes
│   │   ├── email_utils.py     # Envíos por Resend
│   │   └── main.py            # Punto de entrada FastAPI
│   └── frontend/
│       ├── css/               # Estilos de la interfaz
│       ├── js/                # Lógica del chat, gráficas y planificador
│       ├── pictures/          # Assets visuales
│       └── index.html         # Aplicación web
├── requirements.txt
└── README.md
```

## Requisitos

- Python 3.11 o superior recomendado.
- Cuenta y API key de Groq para las respuestas de IA.
- Cuenta y API key de Resend para enviar emails.
- Opcional: API key de NewsAPI para mejorar la cobertura de noticias.

## Configuración local

1. Crea y activa un entorno virtual:

```bash
python -m venv venv
venv\Scripts\activate
```

2. Instala dependencias:

```bash
pip install -r requirements.txt
```

3. Crea un archivo `.env` en la raíz del proyecto con estas variables:

```env
GROQ_API_KEY=
RESEND_API_KEY=
RESEND_FROM=
RESEND_TO=
NEWSAPI_API_KEY=
NEWS_LANGUAGE=es
NEWS_COUNTRY=ES
```

`NEWSAPI_API_KEY` es opcional. Si no existe, el backend intenta obtener noticias desde fuentes RSS públicas.
También puedes copiar `.env.example`; las variables del sistema tienen prioridad
sobre ese archivo local.

## Ejecutar la aplicación

Desde la raíz del proyecto:

```bash
uvicorn app.backend.main:app --reload
```

Después abre:

```text
http://127.0.0.1:8000
```

FastAPI sirve el frontend desde `/` y los assets estáticos desde `/static`.

## Endpoints principales

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/` | Sirve la interfaz web principal. |
| `GET` | `/health` | Comprueba el proceso sin llamar a servicios externos. |
| `POST` | `/chat` | Procesa mensajes del usuario y devuelve respuesta del analista IA. |
| `GET` | `/live-feed` | Devuelve un resumen actual de mercado y noticias. |
| `GET` | `/asset-search?q=` | Busca activos por nombre o ticker. |
| `GET` | `/asset-quote?ticker=` | Devuelve cotización y métricas básicas de un activo. |
| `GET` | `/asset-chart?ticker=&range=` | Devuelve puntos de gráfica para el rango indicado. |
| `POST` | `/investment-plan-lead` | Guarda y envía por correo un plan de inversión. |

## Variables y datos sensibles

No subas claves, tokens, bases de datos locales ni CSVs con leads. Este repo ya ignora:

- `.env`
- `sendgrid.env`
- `venv/`
- `leads.csv`
- `investment_plans.csv`
- bases de datos locales y archivos temporales de SQLite
- `__pycache__/` y archivos `.pyc`

Antes de commitear, ejecuta:

```bash
python -m compileall -q app tests
python -m unittest discover -s tests -v
find app/frontend/js -type f -name '*.js' -print0 | xargs -0 -n1 node --check
git diff --check
```

## Notas de seguridad

- Las rutas del chat y mercado usan rate limiting con `slowapi`.
- El backend añade cabeceras como `X-Content-Type-Options`, `X-Frame-Options` y `Content-Security-Policy`.
- Las claves se leen exclusivamente desde variables de entorno.
- Los CSVs generados son datos operativos locales y no deben entrar en Git.

## Desarrollo

El backend se organiza alrededor de `create_app()` en `app/backend/core/app.py`, que configura seguridad, CORS, rutas y archivos estáticos.

La lógica principal está repartida así:

- `app/backend/Bots/chat_routes.py`: contratos HTTP y validación de payloads.
- `app/backend/services/chat_service.py`: orquestación entre chat, mercado y respuestas enriquecidas.
- `app/backend/services/market_service.py`: búsqueda de activos, cotizaciones, gráficas, noticias y planes.
- `app/frontend/js/`: interacción del usuario, renderizado del dashboard y planificador.

## Buenas prácticas antes de subir cambios

- No commitear archivos de entorno ni credenciales.
- No commitear CSVs con datos reales.
- Mantener `requirements.txt` actualizado cuando cambien dependencias.
- Ejecutar las pruebas locales; GitHub Actions repite las comprobaciones en cada push y pull request.
- Revisar que `git status --short` solo muestre archivos relacionados con el cambio.
