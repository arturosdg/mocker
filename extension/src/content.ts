import {
  isTargetOrigin,
  resolveActiveMocks,
  type MockerState,
} from './lib/state'

function pushMocks(state: MockerState | undefined) {
  if (!state) return
  const mocks = isTargetOrigin(state, location.origin)
    ? resolveActiveMocks(state)
    : []
  window.postMessage(
    { source: 'mocker-extension', type: 'mocks', mocks },
    location.origin,
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
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) {
    pushMocks(changes.state.newValue as MockerState | undefined)
  }
})

void readAndPush()
