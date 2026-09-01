import {
  EMPTY_STATE,
  isMockActive,
  selectedEnvironment,
  type CapturedRequest,
  type MockerState,
  type Scenario,
} from '../lib/state'

const MAX_VISIBLE_CAPTURES = 20

const expandedScenarios = new Set<string>()
let activeTabId: number | undefined

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

async function selectEnvironment(environment: string) {
  await patchState({ environment })
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

function renderConnection(state: MockerState) {
  const status = document.getElementById('connection-status')!
  status.textContent = state.connected ? '' : 'sin conexión'
  status.title = state.connected
    ? 'Conectado a la CLI de mocker'
    : 'Arranca la CLI para cargar los escenarios: mocker <ruta-del-repo>'
  status.className = state.connected
    ? 'header__status header__status--connected'
    : 'header__status header__status--disconnected'
}

function renderGlobalToggle(state: MockerState) {
  const toggle = document.getElementById('global-toggle') as HTMLInputElement
  toggle.checked = state.enabled !== false
}

function renderToolbar(state: MockerState) {
  const projectName = document.getElementById('project-name')!
  projectName.textContent = state.project?.name ?? '—'

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

  if (state.scenarios.length === 0) {
    list.replaceChildren()
    emptyMessage.hidden = false
    emptyMessage.textContent = state.connected
      ? 'El proyecto no tiene escenarios en .mocks/scenarios/'
      : 'Arranca el daemon: mocker <ruta-del-repo>'
    return
  }

  emptyMessage.hidden = true
  list.replaceChildren(
    ...state.scenarios.map((scenario) =>
      buildScenarioItem(state, scenario, counts),
    ),
  )
}

function buildCaptureRow(request: CapturedRequest): HTMLElement {
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
  }

  return row
}

function renderNetwork(requests: CapturedRequest[]) {
  const section = document.getElementById('network-section')!
  const list = document.getElementById('network-list')!
  const tabRequests = requests
    .filter(
      (request) =>
        request.tabId !== undefined && request.tabId === activeTabId,
    )
    .slice(0, MAX_VISIBLE_CAPTURES)

  section.hidden = tabRequests.length === 0
  list.replaceChildren(...tabRequests.map(buildCaptureRow))
}

async function render() {
  const [state, counts, requests] = await Promise.all([
    getState(),
    getCounts(),
    getCapturedRequests(),
  ])
  renderConnection(state)
  renderGlobalToggle(state)
  renderToolbar(state)
  renderScenarios(state, counts)
  renderNetwork(requests)
}

document.getElementById('open-settings')!.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage()
})

document.getElementById('global-toggle')!.addEventListener('change', (event) => {
  void toggleGlobal((event.target as HTMLInputElement).checked)
})

document
  .getElementById('environment-select')!
  .addEventListener('change', (event) => {
    void selectEnvironment((event.target as HTMLSelectElement).value)
  })

chrome.storage.onChanged.addListener(() => {
  void render()
})

void chrome.tabs
  .query({ active: true, currentWindow: true })
  .then(([activeTab]) => {
    activeTabId = activeTab?.id
    void render()
  })

void render()
