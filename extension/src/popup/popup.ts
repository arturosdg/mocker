import {
  getAccessState,
  reloadSnapshot,
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

async function toggleGlobal(enabled: boolean) {
  await patchState({ enabled })
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
  row.title = 'Ver mocks'
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
    status.textContent = ''
    status.title = 'Proyecto conectado'
  } else if (accessState === 'needs-permission') {
    status.textContent = 'reconectar'
    status.title =
      'Chrome ha caducado el permiso de la carpeta — reconéctala en Configuración'
  } else {
    status.textContent = 'sin proyecto'
    status.title = 'Importa la carpeta .mocks de tu repo desde Configuración'
  }
  status.className =
    accessState === 'granted'
      ? 'header__status header__status--connected'
      : 'header__status header__status--disconnected'
}

function renderGlobalToggle(state: MockerState) {
  const toggle = document.getElementById('global-toggle') as HTMLInputElement
  toggle.checked = state.enabled !== false
}

function renderOriginToggle(state: MockerState) {
  const group = document.getElementById('origin-group')!
  const isHttpOrigin =
    activeOrigin !== undefined && /^https?:\/\//.test(activeOrigin)
  group.hidden = !isHttpOrigin
  if (!isHttpOrigin || !activeOrigin) return

  document.getElementById('origin-label')!.textContent = activeOrigin.replace(
    /^https?:\/\//,
    '',
  )
  const toggle = document.getElementById('origin-toggle') as HTMLInputElement
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

  list.className =
    state.enabled === false ? 'scenarios scenarios--off' : 'scenarios'

  const visibleScenarios = state.scenarios.filter(
    (scenario) => !scenario.archived,
  )

  if (visibleScenarios.length === 0) {
    list.replaceChildren()
    emptyMessage.hidden = false
    emptyMessage.textContent =
      accessState === 'granted'
        ? 'El proyecto no tiene escenarios en .mocks/scenarios/'
        : 'Importa la carpeta .mocks de tu repo en Configurar escenarios'
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
  if (!scenario) return { ok: false, error: 'Elige un escenario destino' }

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
  addButton.title = 'Añadir como mock al escenario destino'

  const markAsAdded = () => {
    addButton.textContent = '→'
    addButton.classList.add('capture-row__add--added')
    addButton.title = 'Añadido — ir a configurarlo'
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

function renderNetwork(state: MockerState, requests: CapturedRequest[]) {
  const section = document.getElementById('network-section')!
  const tabRequests = requests
    .filter(
      (request) =>
        request.tabId !== undefined && request.tabId === activeTabId,
    )
    .slice(0, MAX_VISIBLE_CAPTURES)

  section.hidden = tabRequests.length === 0
  if (tabRequests.length === 0) return

  document.getElementById('network-title')!.textContent =
    `${networkOpen ? '▾' : '▸'} Red · esta pestaña`
  document.getElementById('network-count')!.textContent = String(
    tabRequests.length,
  )
  document.getElementById('network-body')!.hidden = !networkOpen
  document.getElementById('network-error')!.hidden = true
  if (!networkOpen) return

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

async function render() {
  const [state, counts, requests, access] = await Promise.all([
    getState(),
    getCounts(),
    getCapturedRequests(),
    getAccessState(),
  ])
  accessState = access
  renderConnection()
  renderGlobalToggle(state)
  renderOriginToggle(state)
  renderToolbar(state)
  renderScenarios(state, counts)
  renderNetwork(state, requests)
}

document.getElementById('open-settings')!.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

document
  .getElementById('global-toggle')!
  .addEventListener('change', (event) => {
    void toggleGlobal((event.target as HTMLInputElement).checked)
  })

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
  chrome.storage.local.get('popupNetworkOpen'),
]).then(async ([resolvedTabId, { popupNetworkOpen }]) => {
  activeTabId = resolvedTabId
  networkOpen = popupNetworkOpen === true
  activeOrigin = await resolveActiveOrigin()
  void render()
})
