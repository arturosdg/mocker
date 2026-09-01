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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'mocker:matched') {
    void incrementMatchedCount(message.scenarioId as string)
  }
})

async function incrementMatchedCount(scenarioId: string) {
  const { counts } = await chrome.storage.session.get('counts')
  const current = (counts as Record<string, number> | undefined) ?? {}
  await chrome.storage.session.set({
    counts: { ...current, [scenarioId]: (current[scenarioId] ?? 0) + 1 },
  })
}
