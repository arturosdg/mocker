import {
  isOriginDisabled,
  resolveActiveMocks,
  type MockerState,
} from './lib/state'

function pushMocks(state: MockerState | undefined) {
  if (!state) return
  const originDisabled = isOriginDisabled(state, location.origin)
  window.postMessage(
    {
      source: 'mocker-extension',
      type: 'mocks',
      mocks: originDisabled ? [] : resolveActiveMocks(state),
      capturing: !originDisabled,
    },
    '*',
  )
}

async function readAndPush() {
  const { state } = await chrome.storage.local.get('state')
  pushMocks(state as MockerState | undefined)
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
    safeSendMessage({ type: 'mocker:matched', scenarioId: data.scenarioId })
  }
  if (data.type === 'request') {
    safeSendMessage({ type: 'mocker:request', request: data.request })
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
    pushMocks(changes.state.newValue as MockerState | undefined)
  }
})

void readAndPush()
