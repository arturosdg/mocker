import type { ResolvedMock } from './lib/state'

let mocks: ResolvedMock[] = []

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.source === 'mocker-extension' && data.type === 'mocks') {
    mocks = data.mocks as ResolvedMock[]
  }
})

function findMock(method: string, url: string): ResolvedMock | undefined {
  const parsed = new URL(url, location.href)
  const candidates = [
    parsed.href,
    parsed.origin + parsed.pathname,
    parsed.pathname,
  ]
  return mocks.find(
    (mock) =>
      mock.method.toUpperCase() === method.toUpperCase() &&
      candidates.includes(mock.url),
  )
}

function reportMatched(mock: ResolvedMock) {
  window.postMessage(
    { source: 'mocker-page', type: 'matched', scenarioId: mock.scenarioId },
    location.origin,
  )
}

function mockBody(mock: ResolvedMock): string {
  return typeof mock.response === 'string'
    ? mock.response
    : JSON.stringify(mock.response ?? null)
}

function logMocked(mock: ResolvedMock, method: string, url: string) {
  const time = new Date().toLocaleTimeString('es-ES', { hour12: false })
  const statusStyle =
    mock.status >= 400
      ? 'color:#ff453a;font-weight:600'
      : 'color:#34c759;font-weight:600'
  console.log(
    `%cmocker%c ${time} ${method.toUpperCase()} ${url} %c${mock.status}%c (${mock.scenarioId})`,
    'background:#34c759;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600',
    'color:inherit',
    statusStyle,
    'color:#8e8e93',
  )
}

const originalFetch = window.fetch.bind(window)

window.fetch = async (input, init) => {
  const request = new Request(input, init)
  const mock = findMock(request.method, request.url)
  if (!mock) return originalFetch(input, init)

  reportMatched(mock)
  logMocked(mock, request.method, request.url)
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
  if (!mock) return originalSend.call(this, body ?? null)

  reportMatched(mock)
  logMocked(mock, request.method, new URL(request.url, location.href).href)
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

window.postMessage({ source: 'mocker-page', type: 'ready' }, location.origin)
