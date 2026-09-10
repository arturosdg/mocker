// Builds the Chrome Web Store assets (docs/store/*.png) from the same demo
// project as the README screenshots: captures the real UI at 2x with the
// built extension, then composes the store panels (1280x800) and the promo
// tiles (440x280, 1400x560) at exactly the sizes the store expects.
// Usage: npm run store-assets
// Chrome: MOCKER_CHROME env var, Playwright's cached Chromium, or the
// system 'chrome' channel.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

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

const PORT = 8151
const DEMO_HOST = 'app.local'
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<html><body>demo<script>
      const socket = new WebSocket(
        'ws://' + location.host + '/connection/websocket',
      )
      socket.onopen = () => socket.send('{"connect":{"name":"js"},"id":1}')
    </script></body></html>`)
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ real: true }))
})
server.on('upgrade', async (request, socket) => {
  const { createHash } = await import('node:crypto')
  const accept = createHash('sha1')
    .update(
      `${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
    )
    .digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )
  const frame = (text) => {
    const payload = Buffer.from(text)
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  }
  // el navegador cierra el socket de golpe al terminar: sin esto el ECONNRESET
  // tumba el script
  socket.on('error', () => {})
  socket.on('data', () => {
    socket.write(frame('{"id":1,"connect":{"client":"demo","version":"5"}}'))
    socket.write(
      frame('{"push":{"channel":"items:demo","pub":{"data":{"count":2}}}}'),
    )
  })
})
await new Promise((resolve) => server.listen(PORT, resolve))

const docsPath = import.meta.dirname
const storePath = path.join(docsPath, 'store')
mkdirSync(storePath, { recursive: true })
const rawPath = mkdtempSync(path.join(tmpdir(), 'mocker-store-raw-'))
const extensionPath = path.resolve(docsPath, '../extension/dist')

const context = await chromium.launchPersistentContext(
  mkdtempSync(path.join(tmpdir(), 'mocker-store-')),
  {
    ...resolveChrome(),
    headless: false,
    deviceScaleFactor: 2,
    args: [
      '--headless=new',
      '--hide-scrollbars',
      // el popup rotula el dominio de la pestaña: que sea presentable
      `--host-resolver-rules=MAP ${DEMO_HOST} 127.0.0.1:${PORT}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      ...(process.env.CI ? ['--no-sandbox'] : []),
    ],
  },
)
let [serviceWorker] = context.serviceWorkers()
if (!serviceWorker) {
  serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 })
}
const extensionId = new URL(serviceWorker.url()).host

const settings = await context.newPage()
await settings.setViewportSize({ width: 1040, height: 820 })
await settings.goto(`chrome-extension://${extensionId}/options.html`)
await settings.waitForTimeout(600)

// ── demo project, written straight into OPFS and picked by the fake picker
await settings.evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry('demo', { recursive: true })
  } catch {
    // first run
  }
  const mocks = await root.getDirectoryHandle('demo', { create: true })
  const write = async (dir, name, content) => {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }
  await write(
    mocks,
    'project.yaml',
    `name: storefront
environments:
  local:
    api: ''
  staging:
    api: https://api.staging.example.com
`,
  )
  const scenarios = await mocks.getDirectoryHandle('scenarios', { create: true })
  await write(
    scenarios,
    'save-error.yaml',
    `name: Save error
description: The POST fails with a 500 after 400 ms
mocks:
  - name: Broken save
    method: POST
    url: '{{api}}/api/items/'
    status: 500
    delay: 400
    response:
      errors:
        - internal error
  - method: GET
    url: '{{api}}/api/items/'
    status: 200
    response:
      items:
        - id: 1
          name: Example
`,
  )
  await write(
    scenarios,
    'empty-list.yaml',
    `name: Empty list
description: The listing returns no elements
mocks:
  - name: Listing with no items
    method: GET
    url: '{{api}}/api/items/'
    status: 200
    response: []
`,
  )
  await write(
    scenarios,
    'expired-session.yaml',
    `name: Expired session
description: Every authenticated call returns a 401
mocks:
  - method: GET
    url: /api/users/me/
    status: 401
    response:
      detail: Authentication credentials were not provided.
`,
  )
  await write(
    scenarios,
    'slow-network.yaml',
    `name: Slow network
description: Every listing answers after 3 s
mocks:
  - name: Three second listing
    method: GET
    url: /api/items/
    status: 200
    delay: 3000
    response:
      items: []
`,
  )
  await write(
    mocks,
    'websockets.yaml',
    `messages:
  - name: Item count push
    channel: items:demo
    data:
      count: 2
  - name: Refresh signal
    data:
      type: refresh
`,
  )
  window.showDirectoryPicker = async () => mocks
})
await settings.locator('#connection-status').click()
await settings.waitForTimeout(1000)

const now = Date.now()
await settings.evaluate(
  async (activation) => {
    const { state } = await chrome.storage.local.get('state')
    await chrome.storage.local.set({ state: { ...state, activation } })
  },
  {
    'save-error': { active: true, activatedAt: now },
    'expired-session': { active: true, activatedAt: now },
  },
)
await settings.waitForTimeout(400)

// ── a bit of real traffic so the popup and the runtime log have content
const app = await context.newPage()
await app.goto(`http://${DEMO_HOST}/`)
await app.waitForTimeout(600)
await app.evaluate(async () => {
  await fetch('/api/items/', {
    method: 'POST',
    body: '{"name":"Sourdough"}',
  })
  await fetch('/api/users/me/')
  await fetch('/api/items/')
  await fetch('/api/orders/8821/')
})
await app.waitForTimeout(600)

// ── popup, mocks mode with the network section open
const popup = await context.newPage()
await popup.setViewportSize({ width: 400, height: 760 })
await popup.goto(`chrome-extension://${extensionId}/popup.html`)
await app.bringToFront()
await popup.reload()
await popup.waitForTimeout(900)
await popup.locator('.scenario__row', { hasText: 'Save error' }).click()
await popup.waitForTimeout(300)
if (!(await popup.locator('#network-body').isVisible())) {
  await popup.locator('#network-toggle').click()
}
await popup.locator('#network-destination').selectOption({ label: 'Save error' })
await popup.waitForTimeout(400)
const popupClip = async () => ({
  x: 0,
  y: 0,
  width: 400,
  height: Math.ceil(
    await popup
      .locator('.footer')
      .evaluate((node) => node.getBoundingClientRect().bottom),
  ),
})
await popup.screenshot({
  path: path.join(rawPath, 'popup-mocks.png'),
  clip: await popupClip(),
})

// ── settings, read mode with one scenario open
await settings.bringToFront()
await settings.reload()
await settings.waitForTimeout(900)
await settings
  .locator('#scenario-list .card--read .card__mocks-title--toggle')
  .first()
  .click()
await settings.waitForTimeout(300)
await settings.screenshot({ path: path.join(rawPath, 'settings.png') })

// ── scenario editor with one response open
await settings
  .locator('[data-scenario-id="save-error"]')
  .getByRole('button', { name: 'Edit', exact: true })
  .click()
await settings.waitForTimeout(500)
await settings
  .locator('[data-scenario-id="save-error"] .mock .card__mocks-title--toggle')
  .first()
  .click()
await settings.waitForTimeout(300)
await settings
  .locator('[data-scenario-id="save-error"]')
  .scrollIntoViewIfNeeded()
await settings.waitForTimeout(400)
await settings
  .locator('[data-scenario-id="save-error"]')
  .screenshot({ path: path.join(rawPath, 'editor.png') })

// ── the scenario file as it lives on disk, read back from the demo folder
const scenarioYaml = await settings.evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  const scenarios = await (
    await root.getDirectoryHandle('demo')
  ).getDirectoryHandle('scenarios')
  const file = await (await scenarios.getFileHandle('save-error.yaml')).getFile()
  return file.text()
})

// ── the real runtime log the agent reads, straight from the demo folder
const runtimeLog = JSON.parse(
  await settings.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const runtime = await (
      await root.getDirectoryHandle('demo')
    ).getDirectoryHandle('.runtime')
    const file = await (await runtime.getFileHandle('requests.json')).getFile()
    return file.text()
  }),
)

await context.close()
server.close()

// ── composition: the store wants exact pixel sizes, so the panels render at
// deviceScaleFactor 1 with the 2x captures scaled down inside them
const shot = (name) =>
  `data:image/png;base64,${readFileSync(path.join(rawPath, name)).toString('base64')}`
const logo = `data:image/png;base64,${readFileSync(
  path.resolve(docsPath, '../extension/icons/icon-128.png'),
).toString('base64')}`
const logoSvg = `data:image/svg+xml;base64,${readFileSync(
  path.resolve(docsPath, '../extension/icons/icon.svg'),
).toString('base64')}`

const logEntry = (entry) => ({
  method: entry.method,
  url: entry.url.replace(`http://${DEMO_HOST}`, `https://${DEMO_HOST}`),
  status: entry.status,
  ...(entry.mocked ? { mocked: true, scenario: entry.scenario } : {}),
})
// una entrada mockeada y una de tráfico real: las dos caras del log, y el
// fragmento cierra bien en lugar de cortarse a media llave
const mockedEntry = runtimeLog.requests.find((entry) => entry.mocked)
const passthroughEntry = runtimeLog.requests.find((entry) => !entry.mocked)
const logJson = JSON.stringify(
  {
    updatedAt: runtimeLog.updatedAt,
    requests: [mockedEntry, passthroughEntry].filter(Boolean).map(logEntry),
  },
  null,
  2,
)

// la línea que el interceptor imprime en la consola de la página, con los
// datos de la petición mockeada de verdad en esta ejecución
const consoleLine = {
  time: new Date(mockedEntry.at).toLocaleTimeString('en-GB', { hour12: false }),
  method: mockedEntry.method.toUpperCase(),
  url: mockedEntry.url.replace(`http://${DEMO_HOST}`, `https://${DEMO_HOST}`),
  status: mockedEntry.status,
  scenario: mockedEntry.mockName
    ? `${mockedEntry.scenario} › ${mockedEntry.mockName}`
    : mockedEntry.scenario,
}

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const highlightYaml = (yaml) =>
  escapeHtml(yaml)
    .replace(/^(\s*)(-\s)?([\w.-]+)(:)/gm, '$1$2<span class="k">$3</span>$4')
    .replace(/: (.+)$/gm, (match, value) =>
      /^-?\d+$/.test(value.trim())
        ? `: <span class="n">${value}</span>`
        : `: <span class="s">${value}</span>`,
    )

const highlightJson = (json) =>
  escapeHtml(json).replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (match, string, colon, keyword, number) => {
      if (string && colon) return `<span class="k">${string}</span>${colon}`
      if (string) return `<span class="s">${string}</span>`
      if (keyword) return `<span class="b">${keyword}</span>`
      if (number) return `<span class="n">${number}</span>`
      return match
    },
  )

const STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #17171c;
    color: #e9e9ee;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 85% -20%, rgba(255, 160, 40, 0.18), transparent 60%),
      radial-gradient(80% 70% at 0% 110%, rgba(255, 160, 40, 0.07), transparent 60%),
      #17171c;
  }
  .panel::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .brand {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .brand img { width: 26px; height: 26px; }
  .brand span { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
  .copy { position: relative; }
  .headline {
    font-size: 42px;
    line-height: 1.08;
    font-weight: 700;
    letter-spacing: -0.025em;
  }
  .headline em { font-style: normal; color: #ffa028; }
  .subline {
    margin-top: 14px;
    font-size: 19px;
    line-height: 1.45;
    color: #a9a9b4;
    max-width: 62ch;
  }
  .frame {
    position: relative;
    border-radius: 12px;
    border: 1px solid #33333d;
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    background: #17171c;
  }
  .frame img { display: block; width: 100%; }
  .code {
    position: relative;
    border-radius: 12px;
    border: 1px solid #2b2b34;
    background: #1f1f26;
    box-shadow: 0 30px 70px rgba(0, 0, 0, 0.5);
    padding: 22px 26px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.5;
    color: #c9c9d3;
    white-space: pre;
    overflow: hidden;
  }
  .code .k { color: #a9a9b4; }
  .code .s { color: #ffa028; }
  .code .n,
  .code .b { color: #32d74b; }
  .code .path {
    display: block;
    color: #8e8e98;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 12px;
  }
  .console {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 22px;
    border-radius: 12px;
    border: 1px solid #2b2b34;
    background: #1f1f26;
    padding: 16px 22px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 14px;
    color: #e9e9ee;
  }
  .console__chip {
    background: #ffa028;
    color: #17171c;
    padding: 1px 7px;
    border-radius: 3px;
    font-weight: 700;
  }
  .console__time,
  .console__scenario { color: #8e8e93; }
  .console__url { color: #c9c9d3; }
  .console__status { font-weight: 600; }
  .console__status--ok { color: #32d74b; }
  .console__status--error { color: #ff453a; }

  .tag {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    border: 1px solid rgba(255, 160, 40, 0.35);
    background: rgba(255, 160, 40, 0.1);
    color: #ffa028;
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
`

const panels = [
  {
    name: 'store-1-scenarios.png',
    width: 1280,
    height: 800,
    body: `
      <div class="panel" style="width:1280px;height:800px;padding:56px 64px 0;">
        <div class="brand"><img src="${logo}" alt="" /><span>mocker</span></div>
        <div class="copy" style="margin-top:34px;">
          <h1 class="headline">Fake any API response,<br /><em>from a simple file</em>.</h1>
          <p class="subline">A scenario is a YAML file: turn it on, reload the page, and every request it covers answers the way you wrote it. No proxy, no dev-server flags, no throwaway code in your app.</p>
        </div>
        <div class="frame" style="margin:40px auto 0;width:900px;height:358px;">
          <img src="${shot('settings.png')}" alt="" />
        </div>
      </div>`,
  },
  {
    name: 'store-2-popup.png',
    width: 1280,
    height: 800,
    body: `
      <div class="panel" style="width:1280px;height:800px;padding:56px 64px;flex-direction:row;align-items:center;gap:60px;">
        <div style="flex:1;">
          <div class="brand"><img src="${logo}" alt="" /><span>mocker</span></div>
          <div class="copy" style="margin-top:30px;">
            <h1 class="headline">Flip a scenario,<br /><em>reload the page</em>.</h1>
            <p class="subline">Turn scenarios and single mocks on and off from the toolbar. Every intercepted call is badged, and the tab's real traffic sits right below — one click turns a captured request into a new mock.</p>
          </div>
          <span class="tag" style="margin-top:26px;">No proxy · no code changes · works on any page</span>
        </div>
        <div class="frame" style="width:452px;flex-shrink:0;">
          <img src="${shot('popup-mocks.png')}" alt="" />
        </div>
      </div>`,
  },
  {
    name: 'store-3-editor.png',
    width: 1280,
    height: 800,
    body: `
      <div class="panel" style="width:1280px;height:800px;padding:56px 64px 0;">
        <div class="brand"><img src="${logo}" alt="" /><span>mocker</span></div>
        <div class="copy" style="margin-top:34px;">
          <h1 class="headline">A form for every mock —<br /><em>status, delay, body</em>.</h1>
          <p class="subline">Method, URL, status code, delay and response, with live validation of <code>{{variables}}</code> and drag to reorder. Saving writes the file; editing the file shows up here.</p>
        </div>
        <div class="frame" style="margin:34px auto 0;width:960px;height:460px;">
          <img src="${shot('editor.png')}" alt="" />
        </div>
      </div>`,
  },
  {
    name: 'store-4-files.png',
    width: 1280,
    height: 800,
    body: `
      <div class="panel" style="width:1280px;height:800px;padding:56px 64px;">
        <div class="brand"><img src="${logo}" alt="" /><span>mocker</span></div>
        <div class="copy" style="margin-top:30px;">
          <h1 class="headline">One file per scenario,<br /><em>nothing hidden</em>.</h1>
          <p class="subline">No database, no cloud: a scenario is a plain YAML file you can read, edit by hand and pass to anyone. Every mock that serves a response says so in the page console, with the original url intact.</p>
        </div>
        <div class="code" style="margin-top:30px;">
          <span class="path">.mocks/scenarios/save-error.yaml</span>${highlightYaml(
            scenarioYaml.trimEnd().split('\n').slice(0, 11).join('\n'),
          )}
        </div>
        <div class="console">
          <span class="console__chip">mocker</span>
          <span class="console__time">${consoleLine.time}</span>
          <span>${consoleLine.method}</span>
          <span class="console__url">${consoleLine.url}</span>
          <span class="console__status console__status--${
            consoleLine.status >= 400 ? 'error' : 'ok'
          }">${consoleLine.status}</span>
          <span class="console__scenario">(${consoleLine.scenario})</span>
        </div>
      </div>`,
  },
  {
    name: 'store-5-agents.png',
    width: 1280,
    height: 800,
    body: `
      <div class="panel" style="width:1280px;height:800px;padding:56px 64px;">
        <div class="brand"><img src="${logo}" alt="" /><span>mocker</span></div>
        <div class="copy" style="margin-top:34px;">
          <h1 class="headline">Let your AI agent<br /><em>write the mocks</em>.</h1>
          <p class="subline">Ask for it in plain words. Mocker writes every captured request to a log next to your scenarios, so the agent sees what the app really called, writes the YAML and checks that its mock matched — no browser, no screenshots to paste.</p>
        </div>
        <div class="code" style="margin-top:34px;">
          <span class="path">.mocks/.runtime/requests.json</span>${highlightJson(logJson)}
        </div>
      </div>`,
  },
  {
    name: 'store-icon-128.png',
    width: 128,
    height: 128,
    transparent: true,
    body: `
      <style>body { background: transparent; }</style>
      <div style="width:128px;height:128px;display:flex;align-items:center;justify-content:center;">
        <img src="${logoSvg}" alt="" style="width:96px;height:96px;" />
      </div>`,
  },
  {
    name: 'promo-small-440x280.png',
    width: 440,
    height: 280,
    body: `
      <div class="panel" style="width:440px;height:280px;padding:34px 36px;justify-content:center;">
        <div class="brand" style="font-size:34px;gap:14px;">
          <img src="${logo}" alt="" style="width:46px;height:46px;" />
          <span>mocker</span>
        </div>
        <span style="position:relative;display:block;width:48px;height:3px;border-radius:2px;background:#ffa028;margin:20px 0 18px;"></span>
        <p style="position:relative;font-size:21px;line-height:1.28;font-weight:600;letter-spacing:-0.02em;">
          File-driven network<br />mocking for the browser
        </p>
        <p style="position:relative;margin-top:12px;font-size:14px;color:#a9a9b4;line-height:1.45;">
          Plain YAML files, toggled<br />from the toolbar or by your agent.
        </p>
      </div>`,
  },
  {
    name: 'promo-marquee-1400x560.png',
    width: 1400,
    height: 560,
    body: `
      <div class="panel" style="width:1400px;height:560px;padding:0 0 0 76px;flex-direction:row;align-items:center;gap:64px;">
        <div style="width:560px;flex-shrink:0;">
          <div class="brand" style="font-size:26px;"><img src="${logo}" alt="" style="width:34px;height:34px;" /><span>mocker</span></div>
          <h1 class="headline" style="margin-top:26px;font-size:46px;">Mock the network<br /><em>from a simple file</em>.</h1>
          <p class="subline" style="font-size:18px;">Scenario-based mocking driven by YAML files: no proxy, no code changes, and a request log your AI coding agent can read.</p>
        </div>
        <div class="frame" style="width:700px;height:392px;flex-shrink:0;">
          <img src="${shot('settings.png')}" alt="" />
        </div>
      </div>`,
  },
]

const browser = await chromium.launch(resolveChrome())
for (const panel of panels) {
  const page = await browser.newPage({
    viewport: { width: panel.width, height: panel.height },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<html><head><meta charset="utf-8" /><style>${STYLE}</style></head><body>${panel.body}</body></html>`,
  )
  await page.waitForTimeout(500)
  await page.screenshot({
    path: path.join(storePath, panel.name),
    ...(panel.transparent ? { omitBackground: true } : {}),
  })
  await page.close()
}
await browser.close()

console.log(`✓ ${panels.map((panel) => `docs/store/${panel.name}`).join('\n  ')}`)
