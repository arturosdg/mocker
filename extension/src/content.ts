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

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.source !== 'mocker-page') return
  if (data.type === 'ready') void readAndPush()
  if (data.type === 'matched') {
    void chrome.runtime.sendMessage({
      type: 'mocker:matched',
      scenarioId: data.scenarioId,
    })
  }
  if (data.type === 'request') {
    void chrome.runtime.sendMessage({
      type: 'mocker:request',
      request: data.request,
    })
  }
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) {
    pushMocks(changes.state.newValue as MockerState | undefined)
  }
})

void readAndPush()
