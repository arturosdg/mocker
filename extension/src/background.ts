import { EMPTY_STATE, type MockerState } from './lib/state'

const DAEMON_URL = 'ws://localhost:4848'

let socket: WebSocket | null = null

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

async function patchState(patch: Partial<MockerState>) {
  const state = await getState()
  await chrome.storage.local.set({ state: { ...state, ...patch } })
}

function connect() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return
  }

  socket = new WebSocket(DAEMON_URL)

  socket.onopen = () => {
    void patchState({ connected: true })
  }

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data as string)
    if (message.type === 'snapshot') {
      void patchState({
        project: message.project,
        scenarios: message.scenarios,
      })
    }
    if (message.type === 'ack') {
      const respond = pendingWrites.get(message.requestId as string)
      if (respond) {
        pendingWrites.delete(message.requestId as string)
        respond(message)
      }
    }
  }

  socket.onclose = () => {
    socket = null
    void patchState({ connected: false })
  }

  socket.onerror = () => {
    socket?.close()
  }
}

chrome.alarms.create('mocker-reconnect', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mocker-reconnect') connect()
})
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()

const WRITE_TIMEOUT_MILLISECONDS = 5000

const pendingWrites = new Map<string, (ack: unknown) => void>()

const MAX_CAPTURED_REQUESTS = 50

let capturedRequestsQueue: Promise<void> = Promise.resolve()

function appendCapturedRequest(
  request: object,
  origin: string,
  tabId: number | undefined,
) {
  capturedRequestsQueue = capturedRequestsQueue.then(async () => {
    const { requests } = await chrome.storage.session.get('requests')
    const list = (requests as object[] | undefined) ?? []
    list.unshift({ ...request, origin, at: Date.now(), tabId })
    await chrome.storage.session.set({
      requests: list.slice(0, MAX_CAPTURED_REQUESTS),
    })
  })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'mocker:matched') {
    void incrementMatchedCount(message.scenarioId as string)
    return
  }

  if (message?.type === 'mocker:request') {
    appendCapturedRequest(
      message.request as object,
      sender.origin ?? sender.url ?? '',
      sender.tab?.id,
    )
    return
  }

  if (message?.type === 'mocker:write') {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      sendResponse({ ok: false, error: 'El daemon no está conectado' })
      return
    }
    const requestId = crypto.randomUUID()
    pendingWrites.set(requestId, sendResponse)
    setTimeout(() => {
      if (pendingWrites.delete(requestId)) {
        sendResponse({ ok: false, error: 'El daemon no ha respondido' })
      }
    }, WRITE_TIMEOUT_MILLISECONDS)
    socket.send(JSON.stringify({ ...message.payload, requestId }))
    return true
  }
})

async function incrementMatchedCount(scenarioId: string) {
  const { counts } = await chrome.storage.session.get('counts')
  const current = (counts as Record<string, number> | undefined) ?? {}
  await chrome.storage.session.set({
    counts: { ...current, [scenarioId]: (current[scenarioId] ?? 0) + 1 },
  })
}
