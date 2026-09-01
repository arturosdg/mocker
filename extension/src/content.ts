import { resolveActiveMocks, type MockerState } from './lib/state'

function pushMocks(state: MockerState | undefined) {
  if (!state) return
  window.postMessage(
    {
      source: 'mocker-extension',
      type: 'mocks',
      mocks: resolveActiveMocks(state),
      capturing: state.enabled !== false,
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) {
    pushMocks(changes.state.newValue as MockerState | undefined)
  }
})

void readAndPush()
