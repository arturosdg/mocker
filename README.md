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
        └── tareas-vacias.yaml  # un fichero = un escenario con sus mocks
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
# scenarios/tareas-vacias.yaml
name: Lista de tareas vacía
mocks:
  - method: GET
    url: '{{api}}/api/tasks/'
    status: 200
    response: []
```

Las URLs matchean por URL completa, por `origin + pathname` o por `pathname` a
secas. Las variables `{{nombre}}` se resuelven con el entorno seleccionado en
el popup.

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

La activación de escenarios es estado del navegador (no toca los ficheros):
varios escenarios pueden estar activos a la vez y, si dos mockean la misma URL,
gana el último activado. El contador verde de cada escenario indica cuántas
requests ha matcheado en la sesión.

## Los mocks se ven en la Console

Cada request matcheada se logea en la consola de la página con la URL original
intacta, al estilo de tweak:

```
mocker 16:34:56 GET https://localhost:3001/api/tasks/ 200 (tareas-vacias)
```

El status va en verde (2xx/3xx) o rojo (4xx/5xx) y entre paréntesis aparece el
escenario que sirvió el mock. Las requests mockeadas no aparecen en la tab
Network (la respuesta es sintética, nunca sale del page-world) — la Console y
el contador verde del popup son las señales de que el mock está funcionando.

## Roadmap

- [x] Slice 1 — walking skeleton: daemon + popup con switches + intercepción fetch/XHR
- [ ] Slice 2 — MCP server (`create_mock`, `activate_scenario`, `get_request_log`…)
- [ ] Slice 3 — request log matched/unmatched visible desde CLI/MCP
- [ ] Slice 4 — página de settings (editor en grande, escribe a los ficheros vía daemon)
- [ ] Slice 5 — grabación de respuestas reales a fichero
- [ ] Slice 6 — handshake con token entre extensión y daemon
