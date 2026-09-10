# Chrome Web Store — ficha de publicación

Todo lo que pide el Developer Dashboard, listo para pegar. Los bloques en
inglés van tal cual al formulario; el texto alrededor es la guía.

Los assets se regeneran con `npm run store-assets` (script:
`docs/store-assets.mjs`, mismo harness que las capturas del README: extensión
compilada, proyecto demo real, tráfico real).

---

## 1. Product details

**Item name** (lo toma del `manifest.json`, máx. 75 — hoy `Mocker`, correcto
tal cual).

**Summary**: no se escribe en el formulario, la store lo lee del campo
`description` del `manifest.json` (máx. 132). Hoy, tras el cambio, es este
(115 caracteres):

```
Mock any API response from simple YAML files — on your own or with your AI coding agent. No proxy, no code changes.
```

Para cambiarlo hay que tocar `extension/manifest.json` y volver a publicar,
no basta con editar la ficha.

**Category**: Developer Tools
**Language**: English

**Detailed description** (máx. 16.000):

```
Mocker serves fake API responses to the page you are developing, from simple YAML files on your own disk. No account, no proxy to run, no dev-server flag, no branch of throwaway code in your app.

A scenario is a file. Turn it on from the toolbar, reload the page, and every request it covers answers with the status, body and delay you wrote.

WHAT YOU CAN DO

• Mock any endpoint: method, URL, status code, response body and an optional delay.
• Group mocks into scenarios ("Empty list", "Expired session", "Save error") and flip them one switch at a time, or mock by mock.
• Match URLs without repeating hosts: a bare pathname matches any host, fragments match partially, and * covers ids in the middle.
• Reuse one mock across environments with {{variables}} resolved per environment (local, staging, …), validated live as you type.
• Simulate what is hard to reproduce: a 500 on save, a 401 mid-session, a listing that answers after three seconds, an empty result set.
• See the tab's real traffic in the popup and turn any captured request into a new mock with one click.
• Fire saved WebSocket pushes on demand, wrapped in the Centrifugo envelope for a channel or raw for any WebSocket app.
• Switch a whole domain off when you want the real backend back — the toolbar icon greys out so you always know.

MADE TO SHARE WITH YOUR AI AGENT

Because a mock is just a file, an AI coding agent can write it for you: "mock the items endpoint as empty", "make the save fail with a 500", and the scenario appears in the extension without a reload or an import.

The loop closes without a browser. Mocker writes the requests it sees to a log next to your scenarios — method, URL, request body, response status and body, and, when a mock matched, which scenario served it. Your agent reads that log to see what the app really called, writes the YAML, and checks that its mock matched. No screenshots to paste, no copying payloads by hand.

Mocker ships a Claude Code skill that teaches an agent the whole workflow (file format, URL matching, verification), so it gets it right on the first try.

FILES, NOT A DATABASE

Everything mocker knows lives in a folder you pick: one project file plus one YAML file per scenario. "New project" initializes that folder anywhere — an empty directory is enough. Put it next to the app you are working on, or in a scratch directory, or anywhere you like: mocker works the same, and anyone you hand the folder to gets exactly the same mocks.

Saving from the extension writes the YAML; editing the YAML in your editor shows up in the extension. Nothing is hidden in browser storage.

MOCKED REQUESTS ARE NEVER A MYSTERY

Every served mock logs to the page console with the original URL intact, the status coloured green or red, and the scenario that answered in parentheses. Amber counters in the popup show how many calls each scenario has served.

HOW TO START

1. Open Settings and click "New project" to initialize a folder, or "Import project" to pick one that already has scenarios.
2. Create a scenario, add a mock (method, URL, status, body) — or ask your agent to write it.
3. Turn the scenario on in the popup and reload your app.

WHAT IT DOES NOT DO

Mocker does not send anything anywhere. It has no account, no server and no telemetry: the requests it captures are written only to the folder you picked, on your own disk, and are wiped at the start of every browser session.

Open source: https://github.com/arturosdg/mocker
```

---

## 2. Graphic assets

| Asset | Requisito | Fichero |
| --- | --- | --- |
| Store icon | 128×128 PNG, arte de 96×96 con margen transparente | `docs/store/store-icon-128.png` |
| Screenshot 1 | 1280×800 | `docs/store/store-1-scenarios.png` |
| Screenshot 2 | 1280×800 | `docs/store/store-2-popup.png` |
| Screenshot 3 | 1280×800 | `docs/store/store-3-editor.png` |
| Screenshot 4 | 1280×800 | `docs/store/store-4-files.png` |
| Screenshot 5 | 1280×800 | `docs/store/store-5-agents.png` |
| Small promo tile | 440×280 | `docs/store/promo-small-440x280.png` |
| Marquee promo tile | 1400×560 | `docs/store/promo-marquee-1400x560.png` |

El icono de la store no es el mismo fichero que el de la extensión:
`extension/icons/icon-128.png` va a sangre porque en la barra de
herramientas se ve diminuto, mientras que la store pide el arte a 96×96
centrado en un lienzo de 128 con el resto transparente. `store-icon-128.png`
se genera del `icon.svg` con ese margen.

El orden importa: la primera captura es la que sale en los listados y en la
tarjeta de búsqueda. La marquee solo se usa si Google te destaca, pero se
sube igual porque es requisito para aparecer en colecciones.

---

## 3. Privacy practices

**Single purpose** (campo obligatorio):

```
Mocker intercepts the HTTP and WebSocket traffic of the page the developer is testing and serves responses defined in YAML files inside a folder the developer selects on their own disk. Everything the extension does serves that one purpose: reading those files, replacing matching responses in the page, and writing a local log of the requests it saw so the developer (or their coding agent) can build the next mock.
```

**Permission justifications** (uno por permiso declarado en el manifest):

`storage`

```
Stores which scenarios and mocks are currently active, the selected environment, the per-domain off switch, and the reference to the folder the developer picked. It also buffers the requests captured during the current browser session so the popup and the local log can show them. Nothing is sent off the device.
```

`alarms`

```
A 30-second alarm re-reads the selected folder so that changes made outside the browser — an editor, a script, a coding agent writing the YAML — are picked up without the developer having to reconnect anything.
```

`host permissions (<all_urls>)`

```
The developer decides which page they are testing, and the extension cannot know those hosts in advance: they are localhost ports, staging domains and internal apps that differ per project. Interception therefore has to be available on any page. The content script only patches fetch, XMLHttpRequest and WebSocket inside the page and reports what it sees to the extension; nothing is transmitted off the device, and the developer can switch any domain off from the popup.
```

**Remote code**: No. Todo el código va en el paquete; no hay `eval`, ni
scripts remotos, ni CDNs.

**Data usage** — no marcar ninguna categoría de recogida de datos, y explicar
por qué en el campo de texto:

```
Mocker does not collect or transmit any user data. It has no server, no account and no analytics. The network traffic it observes is only used to serve mock responses inside the page and is written to a folder the developer picked on their own disk, using the File System Access API with a permission the developer grants explicitly. That local log is wiped at the start of every browser session.
```

Y las tres certificaciones: no vendemos datos a terceros, no los usamos para
fines ajenos al propósito único, y no los usamos para determinar solvencia ni
para préstamos.

**Privacy policy URL** (Chrome la exige en cuanto declaras permisos que tocan
datos del usuario):

```
https://github.com/arturosdg/mocker/blob/main/PRIVACY.md
```

Vive en [`PRIVACY.md`](../PRIVACY.md) en la raíz del repo, que es público, así
que la URL es accesible sin sesión — requisito del revisor. Si algún día el
repo pasa a privado hay que moverla a otro sitio (GitHub Pages o una página
propia) antes de que la revisión la compruebe.

---

## 4. Distribution

- **Visibility**: Public (o Unlisted si primero quieres pasarlo por el equipo).
- **Distribution**: All regions.
- **Package**: `mocker-chrome-vX.Y.Z.zip` de la release de GitHub — el zip que
  ya construye CI, no un zip hecho a mano de `extension/dist/`.
- **Version**: hoy `1.2.0` (`extension/manifest.json`).

**Testing instructions for the reviewer** (importante: sin esto un revisor
abre la extensión y no ve nada que mockear):

```
Mocker needs a folder of YAML files to serve, so it does nothing until one is selected:

1. Click the extension icon and then "Configure scenarios" to open the settings page.
2. Click "New project" and pick any empty folder. Mocker writes a .mocks/ folder there with an empty project.
3. Click "New scenario", set Name to "Test", add a mock with method GET, URL /api/ and status 200, response { "mocked": true }, and save.
4. Open any page that calls /api/ (or open the console on any page and run fetch('/api/')). The response is the mocked one, and the page console shows a line starting with "mocker".
5. The popup lists the scenario with its switch and, below, the tab's captured traffic.
```

---

## 5. Antes de subir

- [ ] `npm run e2e` en verde (85 checks).
- [ ] `npm run store-assets` regenerado si ha cambiado la UI.
- [ ] `manifest.json` con la versión de la release que vas a subir.
- [ ] Privacy policy publicada y su URL en la ficha.
- [ ] Cuenta de developer verificada y la tasa única de 5 $ pagada.
