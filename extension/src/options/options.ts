import {
  EMPTY_STATE,
  isMockActive,
  type Mock,
  type MockerState,
  type Scenario,
} from '../lib/state'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

interface WriteResult {
  ok: boolean
  id?: string
  error?: string
}

let hasUnsavedEdits = false
let lastRenderedSnapshot = ''
const mockReaders = new WeakMap<Element, () => Mock>()

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

async function patchState(patch: Partial<MockerState>) {
  const state = await getState()
  await chrome.storage.local.set({ state: { ...state, ...patch } })
}

function writeToDaemon(payload: object): Promise<WriteResult> {
  return chrome.runtime.sendMessage({ type: 'mocker:write', payload })
}

function markEdited() {
  hasUnsavedEdits = true
}

function snapshotKey(state: MockerState): string {
  return JSON.stringify({ project: state.project, scenarios: state.scenarios })
}

function parseResponse(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function formatResponse(response: unknown): string {
  if (response === null || response === undefined) return ''
  if (typeof response === 'string') return response
  return JSON.stringify(response, null, 2)
}

function autoGrow(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight + 2}px`
}

function buildField(
  label: string,
  input: HTMLElement,
  modifier?: string,
): HTMLElement {
  const field = document.createElement('label')
  field.className = modifier ? `field field--${modifier}` : 'field'
  const caption = document.createElement('span')
  caption.className = 'field__label'
  caption.textContent = label
  field.append(caption, input)
  return field
}

function buildTextInput(value: string, placeholder = ''): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  input.addEventListener('input', markEdited)
  return input
}

function buildNumberInput(value: number | undefined): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'number'
  input.value = value === undefined ? '' : String(value)
  input.addEventListener('input', markEdited)
  return input
}

function buildMethodSelect(value: string): HTMLSelectElement {
  const select = document.createElement('select')
  select.replaceChildren(
    ...HTTP_METHODS.map((method) => {
      const option = document.createElement('option')
      option.value = method
      option.textContent = method
      return option
    }),
  )
  select.value = HTTP_METHODS.includes(value.toUpperCase())
    ? value.toUpperCase()
    : 'GET'
  select.addEventListener('change', markEdited)
  return select
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
  toggle.addEventListener('change', () => onChange(toggle.checked))
  return toggle
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

function renumberMocks(mocksContainer: HTMLElement) {
  ;[...mocksContainer.children].forEach((mockEditor, index) => {
    const title = mockEditor.querySelector('.mock__title')
    if (title) title.textContent = `Mock ${index + 1}`
  })
}

interface SavedMockContext {
  state: MockerState
  scenarioId: string
  mockIndex: number
}

function buildMockEditor(
  mock: Mock,
  mockNumber: number,
  saved?: SavedMockContext,
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'mock'

  const title = document.createElement('span')
  title.className = 'mock__title'
  title.textContent = `Mock ${mockNumber}`

  const nameInput = buildTextInput(mock.name ?? '', 'Nombre (opcional)')
  nameInput.className = 'mock__name'

  const headerActions = document.createElement('span')
  headerActions.className = 'mock__header-actions'

  if (saved) {
    headerActions.append(
      buildToggle(
        isMockActive(saved.state, saved.scenarioId, saved.mockIndex),
        (checked) =>
          void toggleMock(saved.scenarioId, saved.mockIndex, checked),
        'small',
      ),
    )
  }

  const removeButton = document.createElement('button')
  removeButton.className = 'button button--danger button--small'
  removeButton.textContent = 'Quitar'
  removeButton.addEventListener('click', () => {
    markEdited()
    const mocksContainer = container.parentElement
    container.remove()
    if (mocksContainer) renumberMocks(mocksContainer)
  })
  headerActions.append(removeButton)

  const header = document.createElement('div')
  header.className = 'mock__header'
  header.append(title, nameInput, headerActions)

  const methodSelect = buildMethodSelect(mock.method)
  const urlInput = buildTextInput(mock.url, '{{host}}/api/…')
  const statusInput = buildNumberInput(mock.status)
  const delayInput = buildNumberInput(mock.delay)

  const firstRow = document.createElement('div')
  firstRow.className = 'mock__row'
  firstRow.append(
    buildField('Método', methodSelect, 'method'),
    buildField('URL', urlInput),
    buildField('Status', statusInput, 'status'),
    buildField('Delay ms', delayInput, 'delay'),
  )

  const responseInput = document.createElement('textarea')
  responseInput.value = formatResponse(mock.response)
  responseInput.placeholder = '{ "campo": "valor" } — JSON o texto plano'
  responseInput.addEventListener('input', () => {
    markEdited()
    autoGrow(responseInput)
  })

  container.append(header, firstRow, buildField('Respuesta', responseInput))

  mockReaders.set(container, () => {
    const delay = Number(delayInput.value)
    const name = nameInput.value.trim()
    return {
      ...(name ? { name } : {}),
      method: methodSelect.value,
      url: urlInput.value.trim(),
      status: Number(statusInput.value),
      ...(delay > 0 ? { delay } : {}),
      response: parseResponse(responseInput.value),
    }
  })

  return container
}

const variableReaders = new WeakMap<Element, () => [string, string]>()
const environmentReaders = new WeakMap<
  Element,
  () => { name: string; variables: Record<string, string> }
>()

function buildVariableRow(key: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'environment__row'

  const keyInput = buildTextInput(key, 'variable')
  const valueInput = buildTextInput(value, 'valor (vacío = solo pathname)')

  const removeButton = document.createElement('button')
  removeButton.className = 'button button--danger button--small'
  removeButton.textContent = 'Quitar'
  removeButton.addEventListener('click', () => {
    markEdited()
    row.remove()
  })

  row.append(
    buildField('Variable', keyInput, 'variable'),
    buildField('Valor', valueInput),
    removeButton,
  )
  variableReaders.set(row, () => [keyInput.value.trim(), valueInput.value])
  return row
}

function buildEnvironmentEditor(
  name: string,
  variables: Record<string, string>,
): HTMLElement {
  const container = document.createElement('div')
  container.className = 'environment'

  const nameInput = buildTextInput(name, 'nombre del entorno')
  nameInput.className = 'environment__name'

  const removeButton = document.createElement('button')
  removeButton.className = 'button button--danger button--small'
  removeButton.textContent = 'Quitar entorno'
  removeButton.addEventListener('click', () => {
    markEdited()
    container.remove()
  })

  const header = document.createElement('div')
  header.className = 'environment__header'
  header.append(nameInput, removeButton)

  const rowsContainer = document.createElement('div')
  rowsContainer.className = 'environment__rows'
  rowsContainer.replaceChildren(
    ...Object.entries(variables).map(([key, value]) =>
      buildVariableRow(key, value),
    ),
  )

  const addVariableButton = document.createElement('button')
  addVariableButton.className = 'button button--small'
  addVariableButton.textContent = 'Añadir variable'
  addVariableButton.addEventListener('click', () => {
    markEdited()
    rowsContainer.append(buildVariableRow('', ''))
  })

  container.append(header, rowsContainer, addVariableButton)
  environmentReaders.set(container, () => ({
    name: nameInput.value.trim(),
    variables: Object.fromEntries(
      [...rowsContainer.children]
        .map((row) => variableReaders.get(row)!())
        .filter(([key]) => key),
    ),
  }))
  return container
}

function buildProjectCard(state: MockerState): HTMLElement | null {
  const project = state.project
  if (!project) return null

  const card = document.createElement('section')
  card.className = 'card'

  const idLabel = document.createElement('span')
  idLabel.className = 'card__id'
  idLabel.textContent = 'project.yaml'

  const top = document.createElement('div')
  top.className = 'card__top'
  top.append(idLabel)
  card.append(top)

  const nameInput = buildTextInput(project.name, 'Nombre del proyecto')

  const targetsInput = document.createElement('textarea')
  targetsInput.value = project.targets.join('\n')
  targetsInput.placeholder = 'https://localhost:3000 (una URL por línea)'
  targetsInput.addEventListener('input', () => {
    markEdited()
    autoGrow(targetsInput)
  })

  const header = document.createElement('div')
  header.className = 'card__header'
  header.append(
    buildField('Nombre', nameInput),
    buildField('Targets (una URL por línea)', targetsInput),
  )

  const environmentsTitle = document.createElement('div')
  environmentsTitle.className = 'card__mocks-title'
  environmentsTitle.textContent = 'Entornos'

  const environmentsContainer = document.createElement('div')
  environmentsContainer.className = 'card__mocks'
  environmentsContainer.replaceChildren(
    ...Object.entries(project.environments ?? {}).map(([name, variables]) =>
      buildEnvironmentEditor(name, variables),
    ),
  )

  const addEnvironmentButton = document.createElement('button')
  addEnvironmentButton.className = 'button'
  addEnvironmentButton.textContent = 'Añadir entorno'
  addEnvironmentButton.addEventListener('click', () => {
    markEdited()
    environmentsContainer.append(buildEnvironmentEditor('', {}))
  })

  const errorMessage = document.createElement('p')
  errorMessage.className = 'card__error'
  errorMessage.hidden = true

  const saveButton = document.createElement('button')
  saveButton.className = 'button button--primary'
  saveButton.textContent = 'Guardar'
  saveButton.addEventListener('click', async () => {
    const environments = Object.fromEntries(
      [...environmentsContainer.children]
        .map((environment) => environmentReaders.get(environment)!())
        .filter(({ name }) => name)
        .map(({ name, variables }) => [name, variables]),
    )
    const result = await writeToDaemon({
      type: 'project_update',
      project: {
        name: nameInput.value.trim(),
        targets: targetsInput.value
          .split('\n')
          .map((target) => target.trim())
          .filter(Boolean),
        environments,
      },
    })
    if (!result.ok) {
      errorMessage.textContent = result.error ?? 'Error desconocido'
      errorMessage.hidden = false
      return
    }
    hasUnsavedEdits = false
    await render()
  })

  const footer = document.createElement('div')
  footer.className = 'card__footer'
  footer.append(document.createElement('div'), saveButton)

  card.append(
    header,
    environmentsTitle,
    environmentsContainer,
    addEnvironmentButton,
    errorMessage,
    footer,
  )
  return card
}

function buildScenarioCard(
  state: MockerState,
  scenario: Scenario | null,
): HTMLElement {
  const card = document.createElement('section')
  card.className = 'card'

  if (scenario) {
    const idLabel = document.createElement('span')
    idLabel.className = 'card__id'
    idLabel.textContent = `${scenario.id}.yaml`

    const top = document.createElement('div')
    top.className = 'card__top'
    top.append(
      idLabel,
      buildToggle(
        state.activation[scenario.id]?.active ?? false,
        (checked) => void toggleScenario(scenario.id, checked),
      ),
    )
    card.append(top)
  }

  const nameInput = buildTextInput(scenario?.name ?? '', 'Nombre del escenario')
  const descriptionInput = buildTextInput(
    scenario?.description ?? '',
    'Descripción (opcional)',
  )

  const header = document.createElement('div')
  header.className = 'card__header'
  header.append(
    buildField('Nombre', nameInput),
    buildField('Descripción', descriptionInput),
  )

  const mocksTitle = document.createElement('div')
  mocksTitle.className = 'card__mocks-title'
  mocksTitle.textContent = 'Mocks'

  const mocksContainer = document.createElement('div')
  mocksContainer.className = 'card__mocks'
  mocksContainer.replaceChildren(
    ...(scenario?.mocks ?? []).map((mock, index) =>
      buildMockEditor(
        mock,
        index + 1,
        scenario
          ? { state, scenarioId: scenario.id, mockIndex: index }
          : undefined,
      ),
    ),
  )

  const errorMessage = document.createElement('p')
  errorMessage.className = 'card__error'
  errorMessage.hidden = true

  const addMockButton = document.createElement('button')
  addMockButton.className = 'button'
  addMockButton.textContent = 'Añadir mock'
  addMockButton.addEventListener('click', () => {
    markEdited()
    mocksContainer.append(
      buildMockEditor(
        { method: 'GET', url: '', status: 200 },
        mocksContainer.children.length + 1,
      ),
    )
  })

  const saveButton = document.createElement('button')
  saveButton.className = 'button button--primary'
  saveButton.textContent = 'Guardar'
  saveButton.addEventListener('click', async () => {
    const payload = {
      name: nameInput.value.trim(),
      ...(descriptionInput.value.trim()
        ? { description: descriptionInput.value.trim() }
        : {}),
      mocks: [...mocksContainer.children].map((mockEditor) =>
        mockReaders.get(mockEditor)!(),
      ),
    }
    const result = await writeToDaemon(
      scenario
        ? { type: 'scenario_update', id: scenario.id, scenario: payload }
        : { type: 'scenario_create', scenario: payload },
    )
    if (!result.ok) {
      errorMessage.textContent = result.error ?? 'Error desconocido'
      errorMessage.hidden = false
      return
    }
    hasUnsavedEdits = false
    await render()
  })

  const footerActions = document.createElement('div')
  footerActions.className = 'card__footer-side'

  if (scenario) {
    const duplicateButton = document.createElement('button')
    duplicateButton.className = 'button'
    duplicateButton.textContent = 'Duplicar'
    duplicateButton.addEventListener('click', async () => {
      const result = await writeToDaemon({
        type: 'scenario_create',
        scenario: {
          name: `${scenario.name} (copia)`,
          ...(scenario.description
            ? { description: scenario.description }
            : {}),
          mocks: scenario.mocks,
        },
      })
      if (!result.ok) {
        errorMessage.textContent = result.error ?? 'Error desconocido'
        errorMessage.hidden = false
      }
    })

    const deleteButton = document.createElement('button')
    deleteButton.className = 'button button--danger'
    deleteButton.textContent = 'Eliminar'
    deleteButton.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el escenario "${scenario.name}"?`)) return
      const result = await writeToDaemon({
        type: 'scenario_delete',
        id: scenario.id,
      })
      if (!result.ok) {
        errorMessage.textContent = result.error ?? 'Error desconocido'
        errorMessage.hidden = false
      }
    })

    footerActions.append(duplicateButton, deleteButton)
  }

  const footer = document.createElement('div')
  footer.className = 'card__footer'
  footer.append(footerActions, saveButton)

  card.append(
    header,
    mocksTitle,
    mocksContainer,
    errorMessage,
    addMockButton,
    footer,
  )
  return card
}

function renderConnection(state: MockerState) {
  const status = document.getElementById('connection-status')!
  status.textContent = state.connected ? 'daemon' : 'sin daemon'
  status.className = state.connected
    ? 'header__status header__status--connected'
    : 'header__status header__status--disconnected'
}

function renderGlobalToggle(state: MockerState) {
  const toggle = document.getElementById('global-toggle') as HTMLInputElement
  toggle.checked = state.enabled !== false
}

async function render() {
  const state = await getState()
  renderConnection(state)
  renderGlobalToggle(state)
  document.getElementById('project-name')!.textContent =
    state.project?.name ?? '—'

  const projectContainer = document.getElementById('project-container')!
  const projectCard = buildProjectCard(state)
  projectContainer.replaceChildren(...(projectCard ? [projectCard] : []))
  projectContainer
    .querySelectorAll('textarea')
    .forEach((textarea) => autoGrow(textarea as HTMLTextAreaElement))

  const list = document.getElementById('scenario-list')!
  const emptyMessage = document.getElementById('empty-message')!
  emptyMessage.hidden = state.scenarios.length > 0
  emptyMessage.textContent = state.connected
    ? 'No hay escenarios. Crea el primero con "Nuevo escenario".'
    : 'Arranca el daemon apuntando a un repo con .mocks/ para empezar.'

  list.replaceChildren(
    ...state.scenarios.map((scenario) => buildScenarioCard(state, scenario)),
  )
  list
    .querySelectorAll('textarea')
    .forEach((textarea) => autoGrow(textarea as HTMLTextAreaElement))
  document.getElementById('stale-banner')!.hidden = true
  hasUnsavedEdits = false
  lastRenderedSnapshot = snapshotKey(state)
}

document.getElementById('new-scenario')!.addEventListener('click', () => {
  markEdited()
  const list = document.getElementById('scenario-list')!
  const card = buildScenarioCard(EMPTY_STATE, null)
  list.prepend(card)
  card
    .querySelectorAll('textarea')
    .forEach((textarea) => autoGrow(textarea as HTMLTextAreaElement))
})

document
  .getElementById('global-toggle')!
  .addEventListener('change', (event) => {
    void patchState({ enabled: (event.target as HTMLInputElement).checked })
  })

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return
  const state = changes.state.newValue as MockerState | undefined
  if (!state) return
  renderConnection(state)
  renderGlobalToggle(state)
  if (snapshotKey(state) === lastRenderedSnapshot) return
  if (hasUnsavedEdits) {
    document.getElementById('stale-banner')!.hidden = false
    return
  }
  void render()
})

void render()
