import { FLAGS_KEY, type ScenarioFlags } from './lib/flags'
import {
  isOriginDisabled,
  resolveActiveMocks,
  type MockerState,
} from './lib/state'

let currentState: MockerState | undefined
let currentFlags: ScenarioFlags = {}

function pushMocks() {
  const state = currentState
  if (!state) return
  const originDisabled = isOriginDisabled(state, location.origin)
  window.postMessage(
    {
      source: 'mocker-extension',
      type: 'mocks',
      mocks: originDisabled ? [] : resolveActiveMocks(state),
      capturing: !originDisabled,
      flags: currentFlags,
    },
    '*',
  )
}

async function readFlags(): Promise<ScenarioFlags> {
  try {
    const stored = await chrome.storage.session.get(FLAGS_KEY)
    return (stored[FLAGS_KEY] as ScenarioFlags | undefined) ?? {}
  } catch {
    // storage.session solo es accesible desde aquí cuando el background ya
    // ha abierto su nivel de acceso
    return {}
  }
}

async function readAndPush() {
  const [{ state }, flags] = await Promise.all([
    chrome.storage.local.get('state'),
    readFlags(),
  ])
  currentState = state as MockerState | undefined
  currentFlags = flags
  pushMocks()
}

function safeSendMessage(message: object) {
  try {
    void chrome.runtime.sendMessage(message).catch(() => {})
  } catch {
    // extension reloaded: this orphaned content script can no longer talk
    // to the service worker until the page is reloaded
  }
}

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.source !== 'mocker-page') return
  if (data.type === 'ready') void readAndPush()
  if (data.type === 'matched') {
    safeSendMessage({
      type: 'mocker:matched',
      scenarioId: data.scenarioId,
      sets: data.sets,
    })
  }
  if (data.type === 'request') {
    safeSendMessage({ type: 'mocker:request', request: data.request })
  }
  if (data.type === 'ws-frame') {
    safeSendMessage({ type: 'mocker:ws-frame', frame: data.frame })
  }
})

const pendingPageRequests = new Map<string, (result: unknown) => void>()

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.source !== 'mocker-page' || data.type !== 'ws-response') return
  const respond = pendingPageRequests.get(data.requestId as string)
  if (respond) {
    pendingPageRequests.delete(data.requestId as string)
    respond(data.result)
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'mocker:ws-list' && message?.type !== 'mocker:ws-emit') {
    return
  }
  const requestId = crypto.randomUUID()
  pendingPageRequests.set(requestId, sendResponse)
  setTimeout(() => {
    if (pendingPageRequests.delete(requestId)) {
      sendResponse({ error: 'No response from the page' })
    }
  }, 2000)
  window.postMessage(
    {
      source: 'mocker-extension',
      type: message.type === 'mocker:ws-list' ? 'ws-list-request' : 'ws-emit',
      requestId,
      urlFragment: message.urlFragment,
      channel: message.channel,
      payload: message.payload,
    },
    '*',
  )
  return true
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) {
    currentState = changes.state.newValue as MockerState | undefined
    pushMocks()
  }
  if (area === 'session' && changes[FLAGS_KEY]) {
    currentFlags =
      (changes[FLAGS_KEY].newValue as ScenarioFlags | undefined) ?? {}
    pushMocks()
  }
})

void readAndPush()
