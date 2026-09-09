// Batería e2e de mocker. Lanza Chromium con la extensión compilada
// (extension/dist), simula el picker de carpeta con OPFS y ejercita todas
// las funcionalidades. Uso: npm run e2e
// Chrome: variable MOCKER_CHROME, o el Chromium de la caché de Playwright,
// o el canal 'chrome' del sistema.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${extra}`}`)
}

function resolveChrome() {
  if (process.env.MOCKER_CHROME) {
    return { executablePath: process.env.MOCKER_CHROME }
  }
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright')
  if (existsSync(cache)) {
    const latest = readdirSync(cache)
      .filter((entry) => entry.startsWith('chromium-'))
      .sort()
      .at(-1)
    if (latest) {
      const binary = path.join(
        cache,
        latest,
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      )
      if (existsSync(binary)) return { executablePath: binary }
    }
  }
  return { channel: 'chrome' }
}

const PORT = 8140
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><body>e2e<script>
      window.__wsMessages = []
      const socket = new WebSocket('ws://localhost:${PORT}/connection/websocket')
      socket.onopen = () => socket.send('{"connect":"e2e"}')
      socket.onmessage = (event) => window.__wsMessages.push(event.data)
    </script></body></html>`)
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ real: true, path: request.url }))
})
server.on('upgrade', (request, socket) => {
  const accept = createHash('sha1')
    .update(
      `${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
    )
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  const greeting = Buffer.from('{"welcome":true}')
  socket.write(Buffer.concat([Buffer.from([0x81, greeting.length]), greeting]))
})
await new Promise((resolve) => server.listen(PORT, resolve))

const extensionPath = path.resolve(
  import.meta.dirname,
  '../extension/dist',
)
const context = await chromium.launchPersistentContext(
  mkdtempSync(path.join(tmpdir(), 'mocker-e2e-')),
  {
    ...resolveChrome(),
    headless: false,
    args: [
      '--headless=new',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  },
)
let [serviceWorker] = context.serviceWorkers()
if (!serviceWorker) {
  serviceWorker = await context.waitForEvent('serviceworker', {
    timeout: 10000,
  })
}
const extensionId = new URL(serviceWorker.url()).host

const settings = await context.newPage()
settings.on('dialog', (dialog) => void dialog.accept())
settings.on('pageerror', (error) =>
  console.log('[settings pageerror]', error.message),
)
await settings.setViewportSize({ width: 1100, height: 900 })
await settings.goto(`chrome-extension://${extensionId}/options.html`)
await settings.waitForTimeout(600)

// ───────────────────────── A. Estado inicial + importación
check(
  'pill roja sin proyecto',
  (await settings.locator('#connection-status').getAttribute('class')).includes(
    'status-pill--error',
  ),
)

await settings.evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry('e2e', { recursive: true })
  } catch {
    // primera ejecución
  }
  const mocks = await root.getDirectoryHandle('e2e', { create: true })
  const write = async (dir, name, content) => {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }
  await write(
    mocks,
    'project.yaml',
    'name: e2e-app\nenvironments:\n  local:\n    api: ""\n  staging:\n    api: https://api.staging.example.com\n',
  )
  const scenarios = await mocks.getDirectoryHandle('scenarios', {
    create: true,
  })
  await write(
    scenarios,
    'alpha.yaml',
    `name: Alpha
description: Escenario principal
mocks:
  - name: Alpha básico
    method: GET
    url: /api/alpha/
    status: 200
    response: { v: alpha }
  - method: GET
    url: frag/path
    status: 200
    response: { v: frag }
  - method: GET
    url: /api/w/*/end/
    status: 200
    response: { v: wild }
  - method: POST
    url: /api/slow/
    status: 201
    delay: 300
    response: { v: slow }
`,
  )
  await write(
    scenarios,
    'bravo.yaml',
    'name: Bravo\nmocks:\n  - method: GET\n    url: /api/bravo/\n    status: 200\n    response: { v: bravo }\n',
  )
  await write(
    scenarios,
    'pa.yaml',
    'name: Precedencia A\nmocks:\n  - method: GET\n    url: /api/p/\n    status: 200\n    response: { v: A }\n',
  )
  await write(
    scenarios,
    'pb.yaml',
    'name: Precedencia B\nmocks:\n  - method: GET\n    url: /api/p/\n    status: 200\n    response: { v: B }\n',
  )
  await write(
    scenarios,
    'envvar.yaml',
    'name: EnvVar\nmocks:\n  - method: GET\n    url: "{{api}}/api/env/"\n    status: 200\n    response: { v: env }\n',
  )
  await write(
    scenarios,
    'badvar.yaml',
    'name: BadVar\nmocks:\n  - method: GET\n    url: "{{nope}}/x/"\n    status: 200\n    response: {}\n',
  )
  await write(
    scenarios,
    'xhrcase.yaml',
    'name: XhrCase\nmocks:\n  - method: GET\n    url: /api/xhr/\n    status: 202\n    response: { v: xhr }\n',
  )
  await write(
    scenarios,
    'permock.yaml',
    'name: PerMock\nmocks:\n  - method: GET\n    url: /api/m1/\n    status: 200\n    response: { v: m1 }\n  - method: GET\n    url: /api/m2/\n    status: 200\n    response: { v: m2 }\n',
  )
  await write(
    mocks,
    'websockets.yaml',
    'messages:\n  - name: New task push\n    channel: tasks:e2e\n    data:\n      n: 1\n  - name: Plain refresh\n    data: plain-frame\n',
  )
  await write(
    scenarios,
    'arch.yaml',
    'name: Archivable\nmocks:\n  - method: GET\n    url: /api/arch/\n    status: 200\n    response: { v: arch }\n',
  )
  window.showDirectoryPicker = async () => mocks
})
await settings.locator('#connection-status').click()
await settings.waitForTimeout(1000)
check(
  'pill verde tras importar via pill',
  (await settings.locator('#connection-status').getAttribute('class')).includes(
    'status-pill--ok',
  ),
)
check(
  'escenarios cargados',
  (await settings.locator('#scenario-list .card').count()) === 9,
  String(await settings.locator('#scenario-list .card').count()),
)

const readOpfs = (parts) =>
  settings.evaluate(async (segments) => {
    const root = await navigator.storage.getDirectory()
    let dir = await root.getDirectoryHandle('e2e')
    for (const segment of segments.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(segment)
    }
    const file = await dir.getFileHandle(segments.at(-1))
    return (await file.getFile()).text()
  }, parts)

const patchState = (patch) =>
  settings.evaluate(async (statePatch) => {
    const { state } = await chrome.storage.local.get('state')
    await chrome.storage.local.set({ state: { ...state, ...statePatch } })
  }, patch)

// ───────────────────────── B. Modo lectura y proyecto
check(
  'modo lectura por defecto',
  (await settings.locator('.card--read').count()) === 9,
)
const alphaRow = settings
  .locator('[data-scenario-id="alpha"] .read-mock')
  .first()
check(
  'fila resumen con método+url+status',
  (await alphaRow.textContent()).includes('/api/alpha/') &&
    (await alphaRow.textContent()).includes('200'),
)
check(
  'proyecto plegado',
  !(await settings
    .locator('#project-container .card__header')
    .first()
    .isVisible()),
)

// ───────────────────────── C. Interceptor: matching y tipos
const app = await context.newPage()
await app.goto(`http://localhost:${PORT}/`)
await app.waitForTimeout(600)
const now = Date.now()
await patchState({
  activation: {
    alpha: { active: true, activatedAt: now },
    envvar: { active: true, activatedAt: now },
    xhrcase: { active: true, activatedAt: now },
    permock: { active: true, activatedAt: now },
    arch: { active: true, activatedAt: now },
    pa: { active: true, activatedAt: 1000 },
    pb: { active: true, activatedAt: 2000 },
  },
})
await settings.waitForTimeout(500)

const getJson = (url, options) =>
  app.evaluate(
    async ({ fetchUrl, fetchOptions }) => {
      const started = performance.now()
      const response = await fetch(fetchUrl, fetchOptions)
      return {
        status: response.status,
        body: await response.json(),
        elapsed: performance.now() - started,
      }
    },
    { fetchUrl: url, fetchOptions: options },
  )

check('mock fetch por pathname', (await getJson('/api/alpha/')).body.v === 'alpha')
check(
  'ignora query y barra final',
  (await getJson('/api/alpha?page=2')).body.v === 'alpha',
)
check(
  'matching por fragmento',
  (await getJson('/deep/frag/path/section/')).body.v === 'frag',
)
check('comodín *', (await getJson('/api/w/12345/end/')).body.v === 'wild')
const slow = await getJson('/api/slow/', { method: 'POST', body: '{"a":1}' })
check('status custom + delay', slow.status === 201 && slow.elapsed > 250, JSON.stringify(slow))
check(
  'variable de entorno resuelta (local)',
  (await getJson('/api/env/')).body.v === 'env',
)
check('passthrough sin mock', (await getJson('/api/nada/')).body.real === true)
const requestObjectPassthrough = await app.evaluate(async () => {
  try {
    const response = await fetch(
      new Request('/api/nada/', { method: 'POST', body: '{"photo":1}' }),
    )
    return { status: response.status, body: await response.json() }
  } catch (error) {
    return { error: String(error) }
  }
})
check(
  'passthrough con objeto Request con body',
  requestObjectPassthrough.body?.real === true,
  JSON.stringify(requestObjectPassthrough),
)
const xhr = await app.evaluate(
  () =>
    new Promise((resolve) => {
      const request = new XMLHttpRequest()
      request.open('GET', '/api/xhr/')
      request.addEventListener('load', () =>
        resolve({ status: request.status, body: JSON.parse(request.responseText) }),
      )
      request.send()
    }),
)
check('mock XHR', xhr.status === 202 && xhr.body.v === 'xhr')
check('precedencia: último activado gana', (await getJson('/api/p/')).body.v === 'B')
await patchState({
  activation: {
    alpha: { active: true, activatedAt: now },
    envvar: { active: true, activatedAt: now },
    xhrcase: { active: true, activatedAt: now },
    permock: { active: true, activatedAt: now },
    arch: { active: true, activatedAt: now },
    pa: { active: true, activatedAt: Date.now() },
    pb: { active: true, activatedAt: 2000 },
  },
})
await settings.waitForTimeout(400)
check('precedencia: reactivar invierte', (await getJson('/api/p/')).body.v === 'A')

// ───────────────────────── D. Popup: toggles, entorno, capturas
const popup = await context.newPage()
popup.on('pageerror', (error) => console.log('[popup pageerror]', error.message))
await popup.setViewportSize({ width: 400, height: 700 })
await popup.goto(`chrome-extension://${extensionId}/popup.html`)
await app.bringToFront()
await popup.reload()
await popup.waitForTimeout(700)

check(
  'popup: proyecto y pill verde',
  (await popup.locator('#project-name').textContent()) === 'e2e-app' &&
    (await popup.locator('#connection-status').getAttribute('class')).includes('ok'),
)
check(
  'popup: dominio en el toggle',
  (await popup.locator('#origin-label').textContent()) === `localhost:${PORT}`,
)

// entorno: staging rompe la variable, local la restaura
await popup.locator('#environment-select').selectOption('staging')
await popup.waitForTimeout(400)
check(
  'cambiar entorno desactiva la variable',
  (await getJson('/api/env/')).body.real === true,
)
await popup.locator('#environment-select').selectOption('local')
await popup.waitForTimeout(400)

// toggle por mock: apaga m2 desde la fila desplegada
await popup
  .locator('.scenario__row', { hasText: 'PerMock' })
  .click()
await popup.waitForTimeout(300)
await popup
  .locator('.scenario', { hasText: 'PerMock' })
  .locator('.mock-row .toggle')
  .nth(1)
  .click()
await popup.waitForTimeout(400)
check('toggle por mock: m1 sigue mockeado', (await getJson('/api/m1/')).body.v === 'm1')
check('toggle por mock: m2 pasa de largo', (await getJson('/api/m2/')).body.real === true)

// toggle por dominio
await popup.locator('#origin-toggle').click()
await popup.waitForTimeout(400)
check('dominio apagado: passthrough', (await getJson('/api/alpha/')).body.real === true)
await popup.locator('#origin-toggle').click()
await popup.waitForTimeout(400)
check('dominio encendido: mock de vuelta', (await getJson('/api/alpha/')).body.v === 'alpha')

// capturas + añadir a escenario
await popup.locator('#network-toggle').click()
await popup.waitForTimeout(300)
check(
  'capturas de la pestaña listadas',
  (await popup.locator('.capture-row').count()) > 3,
)
await popup.locator('#network-destination').selectOption('bravo')
const addRow = popup.locator('.capture-row', { hasText: '/api/nada/' }).first()
await addRow.locator('.capture-row__add').click()
await popup.waitForTimeout(900)
check(
  'añadir captura escribe el mock',
  (await readOpfs(['scenarios', 'bravo.yaml'])).includes('/api/nada/'),
)
check(
  'botón pasa a flecha',
  (await addRow.locator('.capture-row__add').textContent()) === '→',
)

// ───────────────────────── E. Log de runtime para agentes
const runtimeLog = JSON.parse(await readOpfs(['.runtime', 'requests.json']))
const mockedEntry = runtimeLog.requests.find((entry) => entry.mocked && entry.scenario === 'alpha')
const postEntry = runtimeLog.requests.find(
  (entry) => entry.method === 'POST' && entry.url.includes('/api/slow/'),
)
const requestObjectEntry = runtimeLog.requests.find(
  (entry) => entry.method === 'POST' && entry.url.includes('/api/nada/'),
)
check('runtime log con updatedAt', typeof runtimeLog.updatedAt === 'string')
check('runtime log: entrada mockeada con escenario', Boolean(mockedEntry))
check(
  'runtime log: requestBody del POST',
  postEntry?.requestBody === '{"a":1}',
  JSON.stringify(postEntry),
)
check(
  'runtime log: requestBody del POST con objeto Request',
  requestObjectEntry?.requestBody === '{"photo":1}',
  JSON.stringify(requestObjectEntry),
)

// ───────────────────────── F. Settings: edición, CRUD, validación
await settings.bringToFront()
await settings.waitForTimeout(300)
const alphaCard = settings.locator('[data-scenario-id="alpha"]')
await alphaCard.getByRole('button', { name: 'Edit', exact: true }).click()
await settings.waitForTimeout(300)
const saveButton = alphaCard.getByRole('button', { name: 'Save' })
check('guardar deshabilitado sin cambios', await saveButton.isDisabled())
await alphaCard.locator('.card__header input').first().fill('Alpha renombrada')
check('guardar habilitado al editar', !(await saveButton.isDisabled()))
await saveButton.click()
await settings.waitForTimeout(700)
check('snackbar de guardado', await settings.locator('#snackbar').isVisible())
check(
  'guardado persistido en fichero',
  (await readOpfs(['scenarios', 'alpha.yaml'])).includes('Alpha renombrada'),
)
check(
  'vuelve a modo lectura tras guardar',
  (await settings.locator('[data-scenario-id="alpha"].card--read').count()) === 1,
)

await settings.locator('[data-scenario-id="bravo"]').getByRole('button', { name: 'Edit', exact: true }).click()
await settings.waitForTimeout(200)
await settings.locator('[data-scenario-id="bravo"]').getByRole('button', { name: 'Cancel' }).click()
await settings.waitForTimeout(200)
check(
  'cancelar vuelve a lectura',
  (await settings.locator('[data-scenario-id="bravo"].card--read').count()) === 1,
)

await settings.locator('#new-scenario').click()
const newCard = settings.locator('#scenario-list .card').first()
await newCard.locator('.card__header input').first().fill('Creado en e2e')
await newCard.getByRole('button', { name: 'Add mock' }).click()
await newCard.locator('.mock .field input[type=text]:not(.mock__name)').first().fill('/api/nuevo/')
await newCard.getByRole('button', { name: 'Save' }).click()
await settings.waitForTimeout(800)
check(
  'crear escenario escribe fichero con slug',
  (await readOpfs(['scenarios', 'creado-en-e2e.yaml'])).includes('/api/nuevo/'),
)

await settings.locator('[data-scenario-id="creado-en-e2e"]').getByRole('button', { name: 'Edit', exact: true }).click()
await settings.waitForTimeout(200)
await settings.locator('[data-scenario-id="creado-en-e2e"]').getByRole('button', { name: 'Duplicate' }).click()
await settings.waitForTimeout(800)
check(
  'duplicar crea copia',
  (await settings.locator('[data-scenario-id="creado-en-e2e-copia"]').count()) === 1,
)
await settings.locator('[data-scenario-id="creado-en-e2e"]').getByRole('button', { name: 'Delete', exact: true }).click()
await settings.waitForTimeout(800)
check(
  'eliminar borra el escenario',
  (await settings.locator('[data-scenario-id="creado-en-e2e"]').count()) === 0,
)

// validación de variables
const bannerItem = settings.locator('.banner__item', { hasText: '{{nope}}' })
check('banner de validación con el problema', (await bannerItem.count()) === 1)
await bannerItem.click()
await settings.waitForTimeout(500)
check(
  'click en aviso abre edición y resalta',
  (await settings.locator('[data-scenario-id="badvar"] .mock--highlight').count()) === 1,
)
check(
  'input en rojo por variable inexistente',
  (await settings.locator('[data-scenario-id="badvar"] .input--var-error').count()) === 1,
)
await settings.locator('[data-scenario-id="badvar"]').getByRole('button', { name: 'Cancel' }).click()
await settings.waitForTimeout(300)

// ───────────────────────── G. Archivar
await settings.locator('[data-scenario-id="arch"]').getByRole('button', { name: 'Archive', exact: true }).click()
await settings.waitForTimeout(800)
check(
  'archivado sale de la lista',
  (await settings.locator('#scenario-list [data-scenario-id="arch"]').count()) === 0,
)
check(
  'sección archivados con contador',
  (await settings.locator('#archived-toggle').textContent()).includes('(1)'),
)
check('archivado deja de interceptar', (await getJson('/api/arch/')).body.real === true)
await settings.locator('#archived-toggle').click()
await settings.locator('#archived-list').getByRole('button', { name: 'Unarchive' }).click()
await settings.waitForTimeout(800)
check(
  'desarchivar lo devuelve',
  (await settings.locator('#scenario-list [data-scenario-id="arch"]').count()) === 1,
)

// ───────────────────────── H. Reorder por drag
async function dragHandleTo(handleLocator, targetLocator, targetYRatio = 0.9) {
  await handleLocator.scrollIntoViewIfNeeded()
  await settings.waitForTimeout(200)
  const handleBox = await handleLocator.boundingBox()
  const targetBox = await targetLocator.boundingBox()
  await settings.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await settings.mouse.down()
  await settings.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height * targetYRatio,
    { steps: 10 },
  )
  await settings.mouse.up()
}
const firstId = await settings
  .locator('#scenario-list [data-scenario-id]')
  .first()
  .getAttribute('data-scenario-id')
const secondCard = settings.locator('#scenario-list [data-scenario-id]').nth(1)
await dragHandleTo(
  settings.locator(`[data-scenario-id="${firstId}"] .card__drag`),
  secondCard,
)
await settings.waitForTimeout(900)
check(
  'drag de escenario persiste order',
  (await readOpfs(['project.yaml'])).includes('order:'),
)
check(
  'orden cambiado en la lista',
  (await settings
    .locator('#scenario-list [data-scenario-id]')
    .first()
    .getAttribute('data-scenario-id')) !== firstId,
)

await settings.locator('[data-scenario-id="permock"]').getByRole('button', { name: 'Edit', exact: true }).click()
await settings.waitForTimeout(300)
const mockUrls = () =>
  settings
    .locator('[data-scenario-id="permock"] .mock .field input[type=text]:not(.mock__name)')
    .evaluateAll((inputs) => inputs.map((input) => input.value))
const beforeOrder = await mockUrls()
await dragHandleTo(
  settings.locator('[data-scenario-id="permock"] .mock__drag').first(),
  settings.locator('[data-scenario-id="permock"] .mock').nth(1),
)
await settings.waitForTimeout(300)
const afterOrder = await mockUrls()
check(
  'drag de mock reordena y habilita guardar',
  afterOrder[0] === beforeOrder[1] &&
    !(await settings.locator('[data-scenario-id="permock"]').getByRole('button', { name: 'Save' }).isDisabled()),
  `${beforeOrder} → ${afterOrder}`,
)
await settings.locator('[data-scenario-id="permock"]').getByRole('button', { name: 'Cancel' }).click()

// ───────────────────────── I. WebSockets: modo, emitir, capturas de frames
await app.bringToFront()
await popup.reload()
await popup.waitForTimeout(700)
await popup.locator('#segment-websockets').click()
await popup.waitForTimeout(400)
check(
  'modo websockets: mensajes guardados como lista principal',
  (await popup.locator('#ws-main').isVisible()) &&
    !(await popup.locator('#mocks-main').isVisible()),
)
const savedRow = popup.locator('.ws-saved-row').first()
const savedRowText = await savedRow.textContent()
check(
  'mensaje guardado lista canal y body',
  savedRowText.includes('tasks:e2e') && savedRowText.includes('"n"'),
  savedRowText,
)
check(
  'mensaje guardado conserva el nombre como tooltip',
  (await savedRow.getAttribute('title')) === 'New task push',
)
await savedRow.locator('.ws-saved-row__send').click()
await popup.waitForTimeout(400)
const savedFrame = await app.evaluate(() =>
  window.__wsMessages.at(-1) ? JSON.parse(window.__wsMessages.at(-1)) : null,
)
check(
  'mensaje guardado entrega el sobre',
  savedFrame?.push?.channel === 'tasks:e2e' && savedFrame?.push?.pub?.data?.n === 1,
  JSON.stringify(savedFrame),
)
check(
  'resultado de envío visible',
  (await popup.locator('#ws-result').textContent()).includes('sent to 1'),
)
const rawRow = popup.locator('.ws-saved-row').nth(1)
check(
  'frame crudo titulado con su nombre',
  (await rawRow.locator('.ws-saved-row__channel').textContent()) === 'Plain refresh',
)
await rawRow.locator('.ws-saved-row__send').click()
await popup.waitForTimeout(400)
check(
  'frame crudo entregado sin sobre',
  await app.evaluate(() => window.__wsMessages.at(-1) === 'plain-frame'),
)
if (!(await popup.locator('#network-body').isVisible())) {
  await popup.locator('#network-toggle').click()
  await popup.waitForTimeout(200)
}
check(
  'network en modo ws: título Active websockets',
  (await popup.locator('.network__subtitle').first().textContent()) ===
    'Active websockets',
)
const socketRow = popup.locator('.ws-socket').first()
check(
  'socket listado con su url',
  (await socketRow.textContent()).includes('/connection/websocket'),
)
const inFrameRow = popup.locator('.ws-frame-row', { hasText: 'welcome' }).first()
check(
  'frame entrante capturado con dirección',
  (await inFrameRow.locator('.ws-frame-row__direction').textContent()) === '↓',
)
const outFrameRow = popup.locator('.ws-frame-row', { hasText: 'connect' }).first()
check(
  'frame saliente capturado con dirección',
  (await outFrameRow.locator('.ws-frame-row__direction').textContent()) === '↑',
)
check(
  'frames inyectados no se capturan',
  (await popup.locator('.ws-frame-row', { hasText: 'tasks:e2e' }).count()) === 0,
)
await inFrameRow.locator('.capture-row__add').click()
await popup.waitForTimeout(900)
check(
  'frame capturado guardado en websockets.yaml',
  (await readOpfs(['websockets.yaml'])).includes('welcome'),
)
check(
  'botón de frame pasa a flecha',
  (await inFrameRow.locator('.capture-row__add').textContent()) === '→',
)
// una alarma de sync a mitad de sesión no debe llevarse por delante los logs
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'mocker:sync' }))
await popup.waitForTimeout(600)
const wsRuntimeLog = JSON.parse(await readOpfs(['.runtime', 'websockets.json']))
check(
  'websockets.json con frames en ambas direcciones',
  typeof wsRuntimeLog.updatedAt === 'string' &&
    wsRuntimeLog.frames.some((frame) => frame.direction === 'in') &&
    wsRuntimeLog.frames.some((frame) => frame.direction === 'out'),
)
await popup.locator('#segment-mocks').click()
await popup.waitForTimeout(300)
check('vuelta al modo mocks', await popup.locator('#mocks-main').isVisible())

// ───────────────────────── I2. Settings: editor de mensajes WS
await settings.bringToFront()
await settings.reload()
await settings.waitForTimeout(500)
await settings.locator('#tab-websockets').click()
await settings.waitForTimeout(300)
check('tab websockets con los mensajes', (await settings.locator('#ws-message-list .card').count()) === 3)
check('guardar ws deshabilitado sin cambios', await settings.locator('#ws-save').isDisabled())
await settings.locator('#ws-message-list .card__header input').first().fill('Renamed push')
check('guardar ws habilitado al editar', !(await settings.locator('#ws-save').isDisabled()))
await settings.locator('#ws-save').click()
await settings.waitForTimeout(700)
check(
  'websockets.yaml persistido',
  (await readOpfs(['websockets.yaml'])).includes('Renamed push'),
)
await settings.locator('#tab-scenarios').click()

// ───────────────────────── J. Docs y panel de DevTools
await settings.locator('#tab-docs').click()
check('tab de docs visible', await settings.locator('.docs h2').isVisible())
await settings.locator('#tab-scenarios').click()

const appTabId = await settings.evaluate((port) =>
  chrome.tabs
    .query({ url: `http://localhost:${port}/` })
    .then((tabs) => tabs[0]?.id),
  PORT,
)
const panel = await context.newPage()
await panel.goto(`chrome-extension://${extensionId}/popup.html?tab=${appTabId}`)
await panel.waitForTimeout(600)
check(
  'vista de panel (?tab=) con capturas de esa pestaña',
  (await panel.evaluate(() => document.body.classList.contains('panel'))) &&
    (await panel.locator('#network-section').count()) === 1,
)

// ───────────────────────── K. Logs de runtime: purga por sesión y volcado
// Sesión nueva de navegador: storage.session viene vacío, el log queda a cero.
await serviceWorker.evaluate(async () => {
  await chrome.storage.session.remove([
    'runtimeLogsCleared',
    'requests',
    'wsFrames',
  ])
})
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'mocker:sync' }))
await popup.waitForTimeout(800)
const purgedRequests = JSON.parse(await readOpfs(['.runtime', 'requests.json']))
const purgedFrames = JSON.parse(await readOpfs(['.runtime', 'websockets.json']))
check(
  'logs de runtime purgados al empezar sesión',
  purgedRequests.requests.length === 0 && purgedFrames.frames.length === 0,
)

// Conectar a mitad de sesión (proyecto nuevo o reconexión) vuelca lo ya
// capturado, sin esperar a la siguiente petición.
await serviceWorker.evaluate(async () => {
  await chrome.storage.session.remove('runtimeLogsCleared')
  await chrome.storage.session.set({
    requests: [
      {
        method: 'GET',
        url: 'http://localhost/api/pre-connect/',
        status: 200,
        at: Date.now(),
      },
    ],
  })
})
await popup.evaluate(() =>
  chrome.runtime.sendMessage({ type: 'mocker:sync', flushLogs: true }),
)
await popup.waitForTimeout(800)
const flushedRequests = JSON.parse(
  await readOpfs(['.runtime', 'requests.json']),
)
check(
  'conectar a mitad de sesión vuelca las capturas previas',
  flushedRequests.requests.some((request) =>
    request.url.includes('/api/pre-connect/'),
  ),
  JSON.stringify(flushedRequests.requests),
)

// ───────────────────────── L. Proyecto nuevo en una carpeta cualquiera
// (deja el handle apuntando a otra carpeta: va al final de la batería)
await settings.bringToFront()
await settings.reload()
await settings.waitForTimeout(500)
await settings.evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry('scratch', { recursive: true })
  } catch {
    // primera ejecución
  }
  const empty = await root.getDirectoryHandle('scratch', { create: true })
  window.showDirectoryPicker = async () => empty
})
await settings.locator('#new-project').click()
await settings.waitForTimeout(1000)

const readScratch = (parts) =>
  settings.evaluate(async (segments) => {
    const root = await navigator.storage.getDirectory()
    let dir = await root.getDirectoryHandle('scratch')
    for (const segment of segments.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(segment)
    }
    const file = await dir.getFileHandle(segments.at(-1))
    return (await file.getFile()).text()
  }, parts)

check(
  'proyecto nuevo escribe .mocks/project.yaml con el nombre de la carpeta',
  (await readScratch(['.mocks', 'project.yaml'])).includes('name: scratch'),
)
check(
  'proyecto nuevo crea scenarios/ y .gitignore del runtime',
  (await settings.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const mocks = await (
      await root.getDirectoryHandle('scratch')
    ).getDirectoryHandle('.mocks')
    await mocks.getDirectoryHandle('scenarios')
    return true
  })) && (await readScratch(['.mocks', '.gitignore'])).includes('.runtime/'),
)
check(
  'proyecto nuevo queda conectado y vacío',
  (await settings.locator('#connection-status').getAttribute('class')).includes(
    'status-pill--ok',
  ) && (await settings.locator('#scenario-list .card').count()) === 0,
)
// idempotente: volver a pulsar sobre la misma carpeta la importa sin error
await settings.locator('#new-project').click()
await settings.waitForTimeout(1000)
check(
  'proyecto nuevo sobre carpeta ya inicializada la importa',
  (await settings.locator('#connection-status').getAttribute('class')).includes(
    'status-pill--ok',
  ) && (await settings.locator('#access-banner').isHidden()),
)

// ───────────────────────── resumen
await context.close()
server.close()
const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks OK`)
if (failed.length > 0) {
  console.log('FALLOS:', failed.map((result) => result.name).join(' | '))
  process.exit(1)
}
