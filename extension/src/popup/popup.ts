import {
  getAccessState,
  reloadSnapshot,
  requestAccess,
  updateScenario,
  type AccessState,
  type WriteResult,
} from '../lib/filesystem'
import {
  EMPTY_STATE,
  isMockActive,
  selectedEnvironment,
  type CapturedRequest,
  type Mock,
  type MockerState,
  type Scenario,
} from '../lib/state'

const MAX_VISIBLE_CAPTURES = 20

const expandedScenarios = new Set<string>()
const addedRequests = new Map<string, { scenarioId: string; mockUrl: string }>()
let activeTabId: number | undefined
let activeOrigin: string | undefined
let networkOpen = false
let destinationScenarioId = ''
let accessState: AccessState = 'no-project'

function requestKey(request: CapturedRequest): string {
  return `${request.at}|${request.method}|${request.url}`
}

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

async function getCounts(): Promise<Record<string, number>> {
  const { counts } = await chrome.storage.session.get('counts')
  return (counts as Record<string, number> | undefined) ?? {}
}

async function getCapturedRequests(): Promise<CapturedRequest[]> {
  const { requests } = await chrome.storage.session.get('requests')
  return (requests as CapturedRequest[] | undefined) ?? []
}

async function patchState(patch: Partial<MockerState>) {
  const state = await getState()
  await chrome.storage.local.set({ state: { ...state, ...patch } })
}

async function toggleScenario(scenarioId: string, active: boolean) {
  const state = await getState()
  await patchState({
    activation: {
      ...state.activation,
      [scenarioId]: { active, activatedAt: Date.now() },
    },
  })
}

async function toggleMock(
  scenarioId: string,
  mockIndex: number,
  active: boolean,
) {
  const state = await getState()
  await patchState({
    mockActivation: {
      ...(state.mockActivation ?? {}),
      [scenarioId]: {
        ...(state.mockActivation?.[scenarioId] ?? {}),
        [mockIndex]: active,
      },
    },
  })
}

function buildToggle(
  checked: boolean,
  onChange: (checked: boolean) => void,
  modifier?: string,
): HTMLInputElement {
  const toggle = document.createElement('input')
  toggle.type = 'checkbox'
  toggle.className = modifier ? `toggle toggle--${modifier}` : 'toggle'
  toggle.checked = checked
  toggle.addEventListener('click', (event) => event.stopPropagation())
  toggle.addEventListener('change', () => onChange(toggle.checked))
  return toggle
}

function buildMockRow(
  state: MockerState,
  scenario: Scenario,
  mockIndex: number,
): HTMLElement {
  const mock = scenario.mocks[mockIndex]
  const row = document.createElement('li')
  row.className = 'mock-row'

  const label = document.createElement('span')
  label.className = 'mock-row__label'
  label.textContent = mock.name
    ? `${mock.method.toUpperCase()} · ${mock.name}`
    : `${mock.method.toUpperCase()} ${mock.url}`
  label.title = `${mock.method.toUpperCase()} ${mock.url}`

  const status = document.createElement('span')
  status.className =
    mock.status >= 400
      ? 'mock-row__status mock-row__status--error'
      : 'mock-row__status'
  status.textContent = String(mock.status)

  row.append(
    label,
    status,
    buildToggle(
      isMockActive(state, scenario.id, mockIndex),
      (checked) => void toggleMock(scenario.id, mockIndex, checked),
      'small',
    ),
  )
  return row
}

function buildScenarioItem(
  state: MockerState,
  scenario: Scenario,
  counts: Record<string, number>,
): HTMLElement {
  const item = document.createElement('li')
  item.className = 'scenario'

  const row = document.createElement('div')
  row.className = 'scenario__row'
  row.title = 'Show mocks'
  row.addEventListener('click', () => {
    if (expandedScenarios.has(scenario.id)) {
      expandedScenarios.delete(scenario.id)
    } else {
      expandedScenarios.add(scenario.id)
    }
    void render()
  })

  const expandIndicator = document.createElement('span')
  expandIndicator.className = 'scenario__expand'
  expandIndicator.textContent = expandedScenarios.has(scenario.id) ? '▾' : '▸'

  const info = document.createElement('div')
  info.className = 'scenario__info'
  const name = document.createElement('div')
  name.className = 'scenario__name'
  name.textContent = scenario.name
  info.append(name)
  if (scenario.description) {
    const description = document.createElement('div')
    description.className = 'scenario__description'
    description.textContent = scenario.description
    info.append(description)
  }

  const count = counts[scenario.id]
  const badge = document.createElement('span')
  badge.className = 'scenario__count'
  badge.textContent = String(count ?? 0)
  badge.hidden = !count

  row.append(
    expandIndicator,
    info,
    badge,
    buildToggle(
      state.activation[scenario.id]?.active ?? false,
      (checked) => void toggleScenario(scenario.id, checked),
    ),
  )
  item.append(row)

  if (expandedScenarios.has(scenario.id)) {
    const mockList = document.createElement('ul')
    mockList.className = 'mocks'
    mockList.replaceChildren(
      ...scenario.mocks.map((_mock, mockIndex) =>
        buildMockRow(state, scenario, mockIndex),
      ),
    )
    item.append(mockList)
  }

  return item
}

function renderConnection() {
  const status = document.getElementById('connection-status')!
  if (accessState === 'granted') {
    status.textContent = '✓'
    status.title = 'Project synced'
    status.className = 'status-pill status-pill--ok'
  } else if (accessState === 'needs-permission') {
    status.textContent = '⚠'
    status.title =
      'Chrome expired the folder permission — click to reconnect'
    status.className = 'status-pill status-pill--warn status-pill--clickable'
  } else {
    status.textContent = '⚠'
    status.title = 'No project — click to import your .mocks folder'
    status.className = 'status-pill status-pill--error status-pill--clickable'
  }
}

async function handleConnectionClick() {
  if (accessState === 'needs-permission') {
    const granted = await requestAccess()
    if (granted) {
      await reloadSnapshot()
      await render()
      return
    }
  }
  if (accessState !== 'granted') {
    void chrome.runtime.openOptionsPage()
  }
}

function renderOriginToggle(state: MockerState) {
  const group = document.getElementById('origin-group')!
  const isHttpOrigin =
    activeOrigin !== undefined && /^https?:\/\//.test(activeOrigin)
  group.hidden = !isHttpOrigin
  if (!isHttpOrigin || !activeOrigin) return

  const host = activeOrigin.replace(/^https?:\/\//, '')
  const label = document.getElementById('origin-label')!
  label.textContent = host
  label.title = `Mocking on ${activeOrigin}`
  const toggle = document.getElementById('origin-toggle') as HTMLInputElement
  toggle.title = `Mocking on ${host}`
  toggle.checked = !(state.disabledOrigins ?? []).includes(activeOrigin)
}

async function toggleOrigin(enabled: boolean) {
  if (!activeOrigin) return
  const state = await getState()
  const disabledOrigins = new Set(state.disabledOrigins ?? [])
  if (enabled) {
    disabledOrigins.delete(activeOrigin)
  } else {
    disabledOrigins.add(activeOrigin)
  }
  await patchState({ disabledOrigins: [...disabledOrigins] })
}

function renderToolbar(state: MockerState) {
  document.getElementById('project-name')!.textContent =
    state.project?.name ?? '—'

  const select = document.getElementById(
    'environment-select',
  ) as HTMLSelectElement
  const environments = Object.keys(state.project?.environments ?? {})
  document.getElementById('environment-group')!.hidden =
    environments.length === 0
  select.replaceChildren(
    ...environments.map((environmentName) => {
      const option = document.createElement('option')
      option.value = environmentName
      option.textContent = environmentName
      return option
    }),
  )
  const current = selectedEnvironment(state)
  if (current) select.value = current
}

function renderScenarios(state: MockerState, counts: Record<string, number>) {
  const list = document.getElementById('scenario-list')!
  const emptyMessage = document.getElementById('empty-message')!

  const originDisabled =
    activeOrigin !== undefined &&
    (state.disabledOrigins ?? []).includes(activeOrigin)
  list.className = originDisabled ? 'scenarios scenarios--off' : 'scenarios'

  const visibleScenarios = state.scenarios.filter(
    (scenario) => !scenario.archived,
  )

  if (visibleScenarios.length === 0) {
    list.replaceChildren()
    emptyMessage.hidden = false
    emptyMessage.textContent =
      accessState === 'granted'
        ? 'The project has no scenarios in .mocks/scenarios/'
        : "Import your repo's .mocks folder from Configure scenarios"
    return
  }

  emptyMessage.hidden = true
  list.replaceChildren(
    ...visibleScenarios.map((scenario) =>
      buildScenarioItem(state, scenario, counts),
    ),
  )
}

function showNetworkError(message: string) {
  const errorMessage = document.getElementById('network-error')!
  errorMessage.textContent = message
  errorMessage.hidden = false
}

async function addRequestToScenario(
  state: MockerState,
  request: CapturedRequest,
): Promise<WriteResult> {
  const scenario = state.scenarios.find(
    (candidate) => candidate.id === destinationScenarioId,
  )
  if (!scenario) return { ok: false, error: 'Choose a destination scenario' }

  let mockUrl = request.url
  try {
    mockUrl = new URL(request.url).pathname
  } catch {
    // keep the raw url
  }
  const newMock: Mock = {
    method: request.method,
    url: mockUrl,
    status: request.status,
    response: parseCapturedBody(request.body),
  }
  return updateScenario(scenario.id, {
    name: scenario.name,
    ...(scenario.description ? { description: scenario.description } : {}),
    mocks: [...scenario.mocks, newMock],
  })
}

function parseCapturedBody(body: string | undefined): unknown {
  if (!body?.trim()) return null
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function buildCaptureRow(
  state: MockerState,
  request: CapturedRequest,
): HTMLElement {
  const row = document.createElement('li')
  row.className = 'capture-row'

  const method = document.createElement('span')
  method.className = 'capture-row__method'
  method.textContent = request.method.toUpperCase()

  const url = document.createElement('span')
  url.className = 'capture-row__url'
  try {
    url.textContent = new URL(request.url).pathname
  } catch {
    url.textContent = request.url
  }
  url.title = request.url

  const status = document.createElement('span')
  status.className =
    request.status >= 400
      ? 'capture-row__status capture-row__status--error'
      : 'capture-row__status'
  status.textContent = String(request.status)

  row.append(method, url, status)

  if (request.mocked) {
    const badge = document.createElement('span')
    badge.className = 'capture-row__mocked'
    badge.textContent = 'mock'
    row.append(badge)
    return row
  }

  const addButton = document.createElement('button')
  addButton.className = 'capture-row__add'
  addButton.textContent = '+'
  addButton.title = 'Add as a mock to the destination scenario'

  const markAsAdded = () => {
    addButton.textContent = '→'
    addButton.classList.add('capture-row__add--added')
    addButton.title = 'Added — click to configure it'
  }
  if (addedRequests.has(requestKey(request))) markAsAdded()

  addButton.addEventListener('click', async () => {
    const added = addedRequests.get(requestKey(request))
    if (added) {
      const query = new URLSearchParams({
        scenario: added.scenarioId,
        url: added.mockUrl,
      })
      void chrome.tabs.create({
        url: `${chrome.runtime.getURL('options.html')}#${query}`,
      })
      return
    }
    const scenarioId = destinationScenarioId
    const result = await addRequestToScenario(state, request)
    if (!result.ok) {
      showNetworkError(result.error ?? 'Error desconocido')
      return
    }
    let mockUrl = request.url
    try {
      mockUrl = new URL(request.url).pathname
    } catch {
      // keep the raw url
    }
    addedRequests.set(requestKey(request), { scenarioId, mockUrl })
    markAsAdded()
  })
  row.append(addButton)

  return row
}

function renderNetwork(
  state: MockerState,
  requests: CapturedRequest[],
  sockets: TrackedSocketInfo[],
) {
  const section = document.getElementById('network-section')!
  const tabRequests = requests
    .filter(
      (request) =>
        request.tabId !== undefined && request.tabId === activeTabId,
    )
    .slice(0, MAX_VISIBLE_CAPTURES)

  const savedMessages = state.wsMessages ?? []
  const hasContent =
    tabRequests.length > 0 || sockets.length > 0 || savedMessages.length > 0
  section.hidden = !hasContent
  if (!hasContent) return

  document.getElementById('network-title')!.textContent =
    `${networkOpen ? '▾' : '▸'} Network · this tab`
  document.getElementById('network-count')!.textContent = String(
    networkMode === 'requests' ? tabRequests.length : sockets.length,
  )
  document.getElementById('network-body')!.hidden = !networkOpen
  document.getElementById('network-error')!.hidden = true
  if (!networkOpen) return

  document
    .getElementById('segment-requests')!
    .classList.toggle('segment--active', networkMode === 'requests')
  document
    .getElementById('segment-websockets')!
    .classList.toggle('segment--active', networkMode === 'websockets')
  document.getElementById('requests-view')!.hidden =
    networkMode !== 'requests'
  document.getElementById('ws-view')!.hidden = networkMode !== 'websockets'
  if (networkMode === 'websockets') {
    renderWsView(state, sockets)
    return
  }

  const destinationSelect = document.getElementById(
    'network-destination',
  ) as HTMLSelectElement
  destinationSelect.replaceChildren(
    ...state.scenarios.map((scenario) => {
      const option = document.createElement('option')
      option.value = scenario.id
      option.textContent = scenario.name
      return option
    }),
  )
  if (
    destinationScenarioId &&
    state.scenarios.some((scenario) => scenario.id === destinationScenarioId)
  ) {
    destinationSelect.value = destinationScenarioId
  } else {
    destinationScenarioId = state.scenarios[0]?.id ?? ''
  }

  document
    .getElementById('network-list')!
    .replaceChildren(
      ...tabRequests.map((request) => buildCaptureRow(state, request)),
    )
}

interface TrackedSocketInfo {
  url: string
  open: boolean
}

let networkMode: 'requests' | 'websockets' = 'requests'

async function listTabSockets(): Promise<TrackedSocketInfo[]> {
  if (activeTabId === undefined) return []
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: 'mocker:ws-list',
    })
    return (result?.sockets as TrackedSocketInfo[] | undefined) ?? []
  } catch {
    return []
  }
}

async function emitWs(
  urlFragment: string,
  channel: string,
  payload: unknown,
): Promise<string> {
  if (activeTabId === undefined) return 'no active tab'
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      type: 'mocker:ws-emit',
      urlFragment,
      channel,
      payload,
    })
    return (
      response?.error ??
      (response?.sent > 0
        ? `sent to ${response.sent} socket${response.sent === 1 ? '' : 's'}`
        : 'no open socket matched')
    )
  } catch {
    return 'the tab did not respond — reload it'
  }
}

function renderWsView(state: MockerState, sockets: TrackedSocketInfo[]) {
  const result = document.getElementById('ws-result')!

  document.getElementById('ws-saved-list')!.replaceChildren(
    ...(state.wsMessages ?? []).map((message) => {
      const row = document.createElement('li')
      row.className = 'ws-saved-row'
      row.title = message.name

      const info = document.createElement('div')
      info.className = 'ws-saved-row__info'

      const channel = document.createElement('span')
      channel.className = 'ws-saved-row__channel'
      channel.textContent = message.channel || 'raw frame'

      const body = document.createElement('span')
      body.className = 'ws-saved-row__body'
      const bodyText =
        typeof message.data === 'string'
          ? message.data
          : JSON.stringify(message.data)
      body.textContent = bodyText
      body.title = bodyText

      info.append(channel, body)

      const send = document.createElement('button')
      send.className = 'ws-saved-row__send'
      send.textContent = '▶'
      send.title = `Send "${message.name}"`
      send.addEventListener('click', async () => {
        result.textContent = await emitWs(
          message.url ?? '',
          message.channel ?? '',
          message.data,
        )
      })

      row.append(info, send)
      return row
    }),
  )

  const urlInput = document.getElementById('ws-url') as HTMLInputElement
  document.getElementById('ws-socket-list')!.replaceChildren(
    ...sockets.map((socket) => {
      const row = document.createElement('li')
      row.className = 'ws-socket'
      row.title = 'Use this socket url in the form'

      const dot = document.createElement('span')
      dot.className = socket.open
        ? 'ws-socket__dot'
        : 'ws-socket__dot ws-socket__dot--closed'

      const url = document.createElement('span')
      url.className = 'ws-socket__url'
      url.textContent = socket.url
      url.title = socket.url

      row.append(dot, url)
      row.addEventListener('click', () => {
        urlInput.value = socket.url
      })
      return row
    }),
  )
}

async function sendWebSocketMessage() {
  const result = document.getElementById('ws-result')!
  const channel = (
    document.getElementById('ws-channel') as HTMLInputElement
  ).value.trim()
  const dataText = (
    document.getElementById('ws-data') as HTMLTextAreaElement
  ).value
  if (!dataText.trim()) {
    result.textContent = 'data is required'
    return
  }
  let payload: unknown = dataText
  try {
    payload = JSON.parse(dataText)
  } catch {
    // plain text frame
  }
  result.textContent = await emitWs(
    (document.getElementById('ws-url') as HTMLInputElement).value.trim(),
    channel,
    payload,
  )
}

async function render() {
  const [state, counts, requests, access] = await Promise.all([
    getState(),
    getCounts(),
    getCapturedRequests(),
    getAccessState(),
  ])
  accessState = access
  renderConnection()
  renderOriginToggle(state)
  renderToolbar(state)
  renderScenarios(state, counts)
  renderNetwork(state, requests, await listTabSockets())
}

document.getElementById('open-settings')!.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

document
  .getElementById('connection-status')!
  .addEventListener('click', () => void handleConnectionClick())

document.getElementById('origin-toggle')!.addEventListener('change', (event) => {
  void toggleOrigin((event.target as HTMLInputElement).checked)
})

document
  .getElementById('environment-select')!
  .addEventListener('change', (event) => {
    void patchState({
      environment: (event.target as HTMLSelectElement).value,
    })
  })

document.getElementById('network-toggle')!.addEventListener('click', () => {
  networkOpen = !networkOpen
  void chrome.storage.local.set({ popupNetworkOpen: networkOpen })
  void render()
})

document.getElementById('segment-requests')!.addEventListener('click', () => {
  networkMode = 'requests'
  void chrome.storage.local.set({ popupNetworkMode: networkMode })
  void render()
})

document
  .getElementById('segment-websockets')!
  .addEventListener('click', () => {
    networkMode = 'websockets'
    void chrome.storage.local.set({ popupNetworkMode: networkMode })
    void render()
  })

document.getElementById('ws-send')!.addEventListener('click', () => {
  void sendWebSocketMessage()
})

document
  .getElementById('network-destination')!
  .addEventListener('change', (event) => {
    destinationScenarioId = (event.target as HTMLSelectElement).value
  })

chrome.storage.onChanged.addListener(() => {
  void render()
})

void reloadSnapshot()

async function resolveActiveTabId(): Promise<number | undefined> {
  const tabParam = new URLSearchParams(location.search).get('tab')
  if (tabParam) {
    document.body.classList.add('panel')
    return Number(tabParam)
  }
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })
  return activeTab?.id
}

async function resolveActiveOrigin(): Promise<string | undefined> {
  if (activeTabId === undefined) return undefined
  try {
    const tab = await chrome.tabs.get(activeTabId)
    return tab.url ? new URL(tab.url).origin : undefined
  } catch {
    return undefined
  }
}

void Promise.all([
  resolveActiveTabId(),
  chrome.storage.local.get(['popupNetworkOpen', 'popupNetworkMode']),
]).then(async ([resolvedTabId, { popupNetworkOpen, popupNetworkMode }]) => {
  activeTabId = resolvedTabId
  networkOpen = popupNetworkOpen === true
  if (popupNetworkMode === 'websockets') networkMode = 'websockets'
  activeOrigin = await resolveActiveOrigin()
  void render()
})
