---
name: mocker
description: >-
  Mock API responses in the browser through the mocker Chrome extension by
  editing YAML files in the repo's .mocks/ directory and verifying matches via
  .mocks/.runtime/requests.json. Use when the user asks to mock the network,
  fake or intercept HTTP calls, return a fixed response for an endpoint,
  simulate a backend error (500, 401, timeout/delay), create or edit mock
  scenarios, or check which requests were intercepted. Keywords: mocker, mock,
  mockear la red, escenario de mocks, interceptar llamadas.
---

# mocker — mocks de red por ficheros

mocker es una extensión de Chrome que intercepta `fetch`/XHR y sirve
respuestas definidas en YAML dentro del repo de la app. Tu interfaz como
agente son **ficheros**: escribes escenarios en `.mocks/` y lees el log de
requests en `.mocks/.runtime/requests.json`. No hay CLI ni servidor.

## Localiza el proyecto

Busca un directorio `.mocks/` con `project.yaml` en la raíz del repo. Si no
existe, créalo (y sugiere al usuario añadir `.mocks/.runtime/` al
`.gitignore`). El usuario debe tener la extensión instalada y el proyecto
importado (Configuración → Importar proyecto); si el log de runtime no se
actualiza, pídele que compruebe el punto verde de conexión en el popup.

## Formato de ficheros

```
.mocks/
├── project.yaml            # nombre + entornos (opcional)
└── scenarios/
    └── <id>.yaml           # un fichero = un escenario
```

`project.yaml`:

```yaml
name: mi-app
order:                # opcional: orden de escenarios en la UI
  - lista-vacia
environments:         # opcional: variables {{x}} para las URLs
  local:
    api: ''           # vacío = la URL queda como pathname
  staging:
    api: https://api.staging.example.com
```

Escenario (`scenarios/<id>.yaml`) — el nombre del fichero es el id, en
kebab-case, y no se renombra:

```yaml
name: Error al guardar          # obligatorio
description: El POST falla      # opcional
archived: true                  # opcional: lo oculta y desactiva
mocks:
  - name: Guardado roto         # opcional
    method: POST                # GET/POST/PUT/PATCH/DELETE/HEAD
    url: /api/items/            # ver matching
    status: 500                 # obligatorio
    delay: 400                  # opcional, ms
    headers:                    # opcional
      x-custom: valor
    response:                   # body: YAML/JSON o texto plano
      errors:
        - internal error
```

Los bodies van con la forma cruda de la API (p. ej. snake_case si la API
responde snake_case) — mocker no transforma nada.

## Matching de URLs

No escribas el host salvo que haga falta. Un mock matchea por URL completa,
`origin+pathname` o `pathname`, ignorando barras finales y query string:

- `/api/items/` matchea `https://cualquier-host/api/items/?page=2`
- `api/items` (sin barra inicial) matchea como fragmento del pathname
- `*` es comodín: `/api/items/*/photos/`
- `{{variable}}` se resuelve con el entorno activo — su caso fuerte es
  separar dos hosts que comparten pathname; entonces usa URL completa con
  variable de host

## Flujo de trabajo

1. Escribe o edita el YAML del escenario. La extensión recoge cambios cada
   ~30 s, o al instante cuando el usuario abre el popup o la configuración —
   dile "abre el popup de mocker" para forzar la sincronización.
2. **La activación es estado del navegador, no tuya**: pide al usuario que
   encienda el escenario con su switch en el popup. Si dos escenarios activos
   mockean la misma URL, gana el último activado.
3. Pide al usuario que use la app (o recargue la pestaña), y verifica en el
   log de runtime.

## Verificación: .mocks/.runtime/requests.json

Últimas 50 requests de las pestañas con mocking activo:

```json
{
  "updatedAt": "2026-09-02T12:00:00.000Z",
  "requests": [
    {
      "at": 1788350000000,
      "origin": "https://localhost:3000",
      "method": "POST",
      "url": "https://localhost:3000/api/items/",
      "requestBody": "{\"name\":\"x\"}",
      "status": 500,
      "body": "{\"errors\":[...]}",
      "mocked": true,
      "scenario": "error-al-guardar",
      "mockName": "Guardado roto",
      "mockUrl": "/api/items/"
    }
  ]
}
```

- `mocked: true` + `scenario`/`mockUrl` → tu mock matcheó.
- Sin `mocked` → tráfico real que pasó de largo: si esperabas matchear,
  revisa método/URL; si no, su `body` real es material para crear el mock.
- El fichero solo se actualiza mientras el usuario navega con la extensión
  conectada; `updatedAt` viejo = no hay tráfico nuevo, no un fallo.

## Errores comunes

- Mock que no matchea: método distinto, host escrito con typo (mejor
  pathname), o `{{variable}}` inexistente en el entorno activo (la UI lo
  marca en rojo).
- El escenario existe pero no intercepta: está apagado (switch), archivado
  (`archived: true`), o el dominio está desactivado (toggle del popup /
  icono gris).
- No edites la activación ni intentes tocar `chrome.storage`: no es tuyo.
