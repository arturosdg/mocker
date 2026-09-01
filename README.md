# Mocker

Scenario-based network mocking driven by files in your repo. Los escenarios de
mock viven como YAML en `.mocks/` dentro del repo de tu app (versionados con
las ramas, compartidos por git); un daemon local los sirve por WebSocket y la
extensión de Chrome los intercepta en el navegador.

```
.mocks/ (en el repo de tu app)  ←→  daemon (CLI)  ←ws→  extensión (Chrome MV3)
```

## Estructura de un proyecto de mocks

```
tu-app/
└── .mocks/
    ├── project.yaml            # targets + entornos
    └── scenarios/
        └── lista-vacia.yaml    # un fichero = un escenario con sus mocks
```

```yaml
# project.yaml
name: mi-app
targets:
  - https://localhost:3000
environments:
  local:
    api: https://api.sta.example
```

```yaml
# scenarios/lista-vacia.yaml
name: Lista vacía
mocks:
  - method: GET
    url: '{{api}}/api/items/'
    status: 200
    response: []
```

Las variables `{{nombre}}` se resuelven con el entorno seleccionado en el
popup, y sirven para no repetir hosts en cada mock: un mock, N entornos. Un
valor vacío deja la URL como pathname a secas.

## Matching de URLs

No hace falta escribir el host. Una URL de mock matchea contra la URL completa,
`origin + pathname` o `pathname`, ignorando barras finales y la query string:

- `/api/items/` matchea `https://cualquier-host/api/items/?page=2`
- `api/items` (sin barra inicial) matchea como fragmento: cualquier pathname
  que lo contenga
- `*` es comodín: `/api/items/*/photos/` matchea cualquier id intermedio

## Uso

```bash
npm install
npm run build

# 1. Arranca el daemon apuntando al repo que tiene .mocks/
node daemon/dist/cli.js ~/projects/mi-app   # o el bin `mocker` si lo enlazas

# 2. Carga la extensión en Chrome
#    chrome://extensions → modo desarrollador → "Cargar descomprimida" → extension/dist/

# 3. Abre el popup, activa escenarios con el switch
```

La activación es estado del navegador (no toca los ficheros) y tiene tres
niveles en el popup: un **toggle global** de interceptación en la cabecera,
un toggle por **escenario**, y — desplegando el escenario con ▸ — un toggle por
**mock** individual. Varios escenarios pueden estar activos a la vez y, si dos
mockean la misma URL, gana el último activado. El contador ámbar de cada
escenario indica cuántas requests ha matcheado en la sesión, y el botón
inferior abre la página de configuración.

## Los mocks se ven en la Console

Cada request matcheada se logea en la consola de la página con la URL original
intacta, al estilo de tweak:

```
mocker 16:34:56 GET https://localhost:3000/api/items/ 200 (lista-vacia)
```

El status va en verde (2xx/3xx) o rojo (4xx/5xx) y entre paréntesis aparece el
escenario que sirvió el mock. Las requests mockeadas no aparecen en la tab
Network (la respuesta es sintética, nunca sale del page-world) — la Console y
el contador verde del popup son las señales de que el mock está funcionando.

## Roadmap

- [x] Fase 1 — walking skeleton: daemon + popup con switches + intercepción fetch/XHR
- [x] Fase 2 — gestión manual de escenarios: settings page + API de escritura en el daemon
- [ ] Fase 3 — MCP server (`create_scenario`, `activate_scenario`, `get_request_log`…)
- [ ] Fase 4 — request log matched/unmatched visible desde CLI/MCP
- [ ] Fase 5 — grabación de respuestas reales a fichero
- [ ] Fase 6 — robustez: handshake con token, multi-proyecto, matching por query
- [ ] Fase 7 — adopción: empaquetado, onboarding, `.mocks/` en un repo real

## Settings page

El engranaje del popup (o `chrome://extensions` → Mocker → Opciones) abre la
página de configuración en pestaña completa: los escenarios como tarjetas
editables (nombre, descripción, mocks con nombre opcional,
método/URL/status/delay/respuesta), crear, duplicar y eliminar. Los toggles de
activación (global, escenario y mock) también viven aquí y aplican al
instante, sin pasar por Guardar. Renombrar = editar el campo Nombre y guardar;
el fichero conserva su id para que la activación no se pierda. La tarjeta de
proyecto edita `project.yaml`: nombre, targets y los entornos con sus
variables. **Guardar escribe el YAML en el repo vía daemon**
(verás el diff en `git status`) — la página no tiene almacenamiento propio: el
watcher devuelve el cambio y todo queda en los ficheros. Si los ficheros
cambian mientras editas, un aviso te pide guardar o recargar en vez de pisarte
la edición.
