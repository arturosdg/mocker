import type { ResolvedMock } from './lib/state'

const MAX_CAPTURED_BODY_LENGTH = 32768

let mocks: ResolvedMock[] = []
let capturing = true

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.source === 'mocker-extension' && data.type === 'mocks') {
    mocks = data.mocks as ResolvedMock[]
    capturing = data.capturing === true
  }
})

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchesUrl(mockUrl: string, parsed: URL): boolean {
  const candidates = [
    parsed.href,
    parsed.origin + parsed.pathname,
    parsed.pathname,
  ].map(stripTrailingSlashes)

  if (mockUrl.includes('*')) {
    const pattern = new RegExp(
      `^${stripTrailingSlashes(mockUrl).split('*').map(escapeRegExp).join('.*')}$`,
    )
    return candidates.some((candidate) => pattern.test(candidate))
  }

  const target = stripTrailingSlashes(mockUrl)
  if (candidates.includes(target)) return true

  const isFragment = !target.startsWith('http') && !target.startsWith('/')
  return isFragment && stripTrailingSlashes(parsed.pathname).includes(target)
}

function findMock(method: string, url: string): ResolvedMock | undefined {
  const parsed = new URL(url, location.href)
  return mocks.find(
    (mock) =>
      mock.method.toUpperCase() === method.toUpperCase() &&
      matchesUrl(mock.url, parsed),
  )
}

function reportMatched(mock: ResolvedMock) {
  window.postMessage(
    { source: 'mocker-page', type: 'matched', scenarioId: mock.scenarioId },
    '*',
  )
}

interface CapturedRequest {
  method: string
  url: string
  status: number
  mocked?: boolean
  scenario?: string
  mockName?: string
  mockUrl?: string
  body?: string
  requestBody?: string
}

async function readRequestBody(request: Request): Promise<string | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  try {
    const text = await request.clone().text()
    return text ? text.slice(0, MAX_CAPTURED_BODY_LENGTH) : undefined
  } catch {
    return undefined
  }
}

function reportRequest(captured: CapturedRequest) {
  window.postMessage(
    { source: 'mocker-page', type: 'request', request: captured },
    '*',
  )
}

function absoluteUrl(url: string): string {
  return new URL(url, location.href).href
}

function mockBody(mock: ResolvedMock): string {
  return typeof mock.response === 'string'
    ? mock.response
    : JSON.stringify(mock.response ?? null)
}

function logMocked(mock: ResolvedMock, method: string, url: string) {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
  const statusStyle =
    mock.status >= 400
      ? 'color:#ff453a;font-weight:600'
      : 'color:#32d74b;font-weight:600'
  console.log(
    `%cmocker%c ${time} ${method.toUpperCase()} ${url} %c${mock.status}%c (${mock.scenarioId}${mock.name ? ` › ${mock.name}` : ''})`,
    'background:#ffa028;color:#17171c;padding:1px 6px;border-radius:3px;font-weight:700',
    'color:inherit',
    statusStyle,
    'color:#8e8e93',
  )
}

async function captureFetchResponse(
  method: string,
  url: string,
  requestBody: string | undefined,
  clonedResponse: Response,
) {
  try {
    const text = await clonedResponse.text()
    reportRequest({
      method,
      url: absoluteUrl(url),
      status: clonedResponse.status,
      body: text.slice(0, MAX_CAPTURED_BODY_LENGTH),
      requestBody,
    })
  } catch {
    reportRequest({
      method,
      url: absoluteUrl(url),
      status: clonedResponse.status,
      requestBody,
    })
  }
}

const originalFetch = window.fetch.bind(window)

window.fetch = async (input, init) => {
  const request = new Request(input, init)
  const mock = findMock(request.method, request.url)
  const requestBody = capturing ? await readRequestBody(request) : undefined

  if (!mock) {
    const response = await originalFetch(input, init)
    if (capturing) {
      void captureFetchResponse(
        request.method,
        request.url,
        requestBody,
        response.clone(),
      )
    }
    return response
  }

  reportMatched(mock)
  logMocked(mock, request.method, request.url)
  if (capturing) {
    reportRequest({
      method: request.method,
      url: absoluteUrl(request.url),
      status: mock.status,
      mocked: true,
      scenario: mock.scenarioId,
      ...(mock.name ? { mockName: mock.name } : {}),
      mockUrl: mock.url,
      requestBody,
    })
  }
  if (mock.delay) {
    await new Promise((resolve) => setTimeout(resolve, mock.delay))
  }
  return new Response(mockBody(mock), {
    status: mock.status,
    headers: { 'content-type': 'application/json', ...(mock.headers ?? {}) },
  })
}

interface MockableXHR extends XMLHttpRequest {
  mockerRequest?: { method: string; url: string }
}

const originalOpen = XMLHttpRequest.prototype.open
const originalSend = XMLHttpRequest.prototype.send

XMLHttpRequest.prototype.open = function (
  this: MockableXHR,
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
) {
  this.mockerRequest = { method, url: String(url) }
  return originalOpen.call(
    this,
    method,
    url,
    async ?? true,
    username,
    password,
  )
}

XMLHttpRequest.prototype.send = function (
  this: MockableXHR,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  const request = this.mockerRequest
  const mock = request && findMock(request.method, request.url)

  const requestBody =
    capturing && typeof body === 'string'
      ? body.slice(0, MAX_CAPTURED_BODY_LENGTH)
      : undefined

  if (!mock) {
    if (capturing && request) {
      this.addEventListener('load', () => {
        let responseBody: string | undefined
        try {
          responseBody =
            typeof this.responseText === 'string'
              ? this.responseText.slice(0, MAX_CAPTURED_BODY_LENGTH)
              : undefined
        } catch {
          responseBody = undefined
        }
        reportRequest({
          method: request.method,
          url: absoluteUrl(request.url),
          status: this.status,
          body: responseBody,
          requestBody,
        })
      })
    }
    return originalSend.call(this, body ?? null)
  }

  reportMatched(mock)
  logMocked(mock, request.method, absoluteUrl(request.url))
  if (capturing) {
    reportRequest({
      method: request.method,
      url: absoluteUrl(request.url),
      status: mock.status,
      mocked: true,
      scenario: mock.scenarioId,
      ...(mock.name ? { mockName: mock.name } : {}),
      mockUrl: mock.url,
      requestBody,
    })
  }
  const responseText = mockBody(mock)
  setTimeout(() => {
    Object.defineProperty(this, 'readyState', { value: 4 })
    Object.defineProperty(this, 'status', { value: mock.status })
    Object.defineProperty(this, 'responseText', { value: responseText })
    Object.defineProperty(this, 'response', { value: responseText })
    Object.defineProperty(this, 'getAllResponseHeaders', {
      value: () => 'content-type: application/json',
    })
    Object.defineProperty(this, 'getResponseHeader', {
      value: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    })
    this.dispatchEvent(new Event('readystatechange'))
    this.dispatchEvent(new Event('load'))
    this.dispatchEvent(new Event('loadend'))
  }, mock.delay ?? 0)
}

interface TrackedSocket {
  socket: WebSocket
  url: string
}

const trackedSockets: TrackedSocket[] = []

const OriginalWebSocket = window.WebSocket
window.WebSocket = class extends OriginalWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    const tracked = { socket: this, url: String(url) }
    trackedSockets.push(tracked)
    this.addEventListener('close', () => {
      const index = trackedSockets.indexOf(tracked)
      if (index !== -1) trackedSockets.splice(index, 1)
    })
  }
}

function emitToSockets(
  urlFragment: string,
  channel: string,
  data: unknown,
): { sent: number } {
  const frame = channel
    ? JSON.stringify({ push: { channel, pub: { data } } })
    : typeof data === 'string'
      ? data
      : JSON.stringify(data)
  const targets = trackedSockets.filter(
    (tracked) =>
      tracked.socket.readyState === OriginalWebSocket.OPEN &&
      (!urlFragment || tracked.url.includes(urlFragment)),
  )
  for (const tracked of targets) {
    tracked.socket.dispatchEvent(new MessageEvent('message', { data: frame }))
  }
  return { sent: targets.length }
}

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.source !== 'mocker-extension') return
  if (data.type === 'ws-list-request') {
    window.postMessage(
      {
        source: 'mocker-page',
        type: 'ws-response',
        requestId: data.requestId,
        result: {
          sockets: trackedSockets.map((tracked) => ({
            url: tracked.url,
            open: tracked.socket.readyState === OriginalWebSocket.OPEN,
          })),
        },
      },
      '*',
    )
  }
  if (data.type === 'ws-emit') {
    window.postMessage(
      {
        source: 'mocker-page',
        type: 'ws-response',
        requestId: data.requestId,
        result: emitToSockets(
          data.urlFragment as string,
          data.channel as string,
          data.payload,
        ),
      },
      '*',
    )
  }
})

window.postMessage({ source: 'mocker-page', type: 'ready' }, '*')
