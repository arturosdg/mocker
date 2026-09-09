// Regenerates the README screenshots (docs/*.png) from a demo project.
// Launches Chromium with the built extension (extension/dist), fakes the
// folder picker with OPFS, generates a bit of traffic and captures the popup,
// the settings page and the scenario editor. Usage: npm run screenshots
// Chrome: MOCKER_CHROME env var, Playwright's cached Chromium, or the
// system 'chrome' channel.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
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

const PORT = 8131
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><body>demo</body></html>')
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ real: true }))
})
await new Promise((resolve) => server.listen(PORT, resolve))

const docsPath = import.meta.dirname
const extensionPath = path.resolve(docsPath, '../extension/dist')
const context = await chromium.launchPersistentContext(
  mkdtempSync(path.join(tmpdir(), 'mocker-shots-')),
  {
    ...resolveChrome(),
    headless: false,
    deviceScaleFactor: 2,
    args: [
      '--headless=new',
      '--hide-scrollbars',
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
await settings.setViewportSize({ width: 1100, height: 800 })
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
    `name: demo-app
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
await settings.evaluate(async (activation) => {
  const { state } = await chrome.storage.local.get('state')
  await chrome.storage.local.set({ state: { ...state, activation } })
}, {
  'save-error': { active: true, activatedAt: now },
  'expired-session': { active: true, activatedAt: now },
})
await settings.waitForTimeout(400)

// ── a bit of traffic so the popup shows captured requests
const app = await context.newPage()
await app.goto(`http://localhost:${PORT}/`)
await app.waitForTimeout(500)
await app.evaluate(async () => {
  await fetch('/api/items/', { method: 'POST', body: '{"name":"x"}' })
  await fetch('/api/users/me/')
  await fetch('/api/items/')
})
await app.waitForTimeout(500)

// ── popup
const popup = await context.newPage()
await popup.setViewportSize({ width: 400, height: 700 })
await popup.goto(`chrome-extension://${extensionId}/popup.html`)
await app.bringToFront()
await popup.reload()
await popup.waitForTimeout(900)
const saveErrorRow = popup.locator('.scenario__row', { hasText: 'Save error' })
await saveErrorRow.click()
await popup.waitForTimeout(300)
if (!(await popup.locator('#network-body').isVisible())) {
  await popup.locator('#network-toggle').click()
}
await popup.locator('#network-destination').selectOption({ label: 'Save error' })
await popup.waitForTimeout(400)
const popupHeight = Math.ceil(
  await popup.locator('.footer').evaluate((node) => node.getBoundingClientRect().bottom),
)
await popup.screenshot({
  path: path.join(docsPath, 'popup.png'),
  clip: { x: 0, y: 0, width: 400, height: popupHeight },
})

// ── settings, scenarios in read mode (one scenario with its mocks open, the
// rest collapsed as they come by default)
await settings.bringToFront()
await settings.reload()
await settings.waitForTimeout(900)
await settings
  .locator('#scenario-list .card--read .card__mocks-title--toggle')
  .first()
  .click()
await settings.waitForTimeout(300)
await settings.screenshot({ path: path.join(docsPath, 'settings.png') })

// ── scenario editor
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
await settings.screenshot({ path: path.join(docsPath, 'editor.png') })

await context.close()
server.close()
console.log('✓ docs/popup.png, docs/settings.png, docs/editor.png')
