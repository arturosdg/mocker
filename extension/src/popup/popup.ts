import {
  EMPTY_STATE,
  selectedEnvironment,
  type MockerState,
} from '../lib/state'

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

async function getCounts(): Promise<Record<string, number>> {
  const { counts } = await chrome.storage.session.get('counts')
  return (counts as Record<string, number> | undefined) ?? {}
}

async function toggleScenario(scenarioId: string, active: boolean) {
  const state = await getState()
  const activation = {
    ...state.activation,
    [scenarioId]: { active, activatedAt: Date.now() },
  }
  await chrome.storage.local.set({ state: { ...state, activation } })
}

async function selectEnvironment(environment: string) {
  const state = await getState()
  await chrome.storage.local.set({ state: { ...state, environment } })
}

function renderConnection(state: MockerState) {
  const status = document.getElementById('connection-status')!
  status.textContent = state.connected ? 'daemon' : 'sin daemon'
  status.className = state.connected
    ? 'header__status header__status--connected'
    : 'header__status header__status--disconnected'
}

function renderToolbar(state: MockerState) {
  const projectName = document.getElementById('project-name')!
  projectName.textContent = state.project?.name ?? '—'

  const select = document.getElementById(
    'environment-select',
  ) as HTMLSelectElement
  const environments = Object.keys(state.project?.environments ?? {})
  select.hidden = environments.length === 0
  select.replaceChildren(
    ...environments.map((name) => {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      return option
    }),
  )
  const current = selectedEnvironment(state)
  if (current) select.value = current
}

function renderScenarios(state: MockerState, counts: Record<string, number>) {
  const list = document.getElementById('scenario-list')!
  const emptyMessage = document.getElementById('empty-message')!

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
    ...state.scenarios.map((scenario) => {
      const item = document.createElement('li')
      item.className = 'scenario'

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

      const toggle = document.createElement('input')
      toggle.type = 'checkbox'
      toggle.className = 'scenario__toggle'
      toggle.checked = state.activation[scenario.id]?.active ?? false
      toggle.addEventListener('change', () => {
        void toggleScenario(scenario.id, toggle.checked)
      })

      item.append(info, badge, toggle)
      return item
    }),
  )
}

async function render() {
  const [state, counts] = await Promise.all([getState(), getCounts()])
  renderConnection(state)
  renderToolbar(state)
  renderScenarios(state, counts)
}

document
  .getElementById('environment-select')!
  .addEventListener('change', (event) => {
    void selectEnvironment((event.target as HTMLSelectElement).value)
  })

chrome.storage.onChanged.addListener(() => {
  void render()
})

void render()
