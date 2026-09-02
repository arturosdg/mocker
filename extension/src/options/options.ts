import {
  createScenario as createScenarioFile,
  deleteScenario as deleteScenarioFile,
  getAccessState,
  pickProjectDirectory,
  reloadSnapshot,
  requestAccess,
  updateProject,
  updateScenario as updateScenarioFile,
  type AccessState,
} from '../lib/filesystem'
import {
  EMPTY_STATE,
  isMockActive,
  selectedEnvironment,
  type Mock,
  type MockerState,
  type Project,
  type Scenario,
} from '../lib/state'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

let hasUnsavedEdits = false
let lastRenderedSnapshot = ''
let accessState: AccessState = 'no-project'

interface PendingFocus {
  scenarioId: string
  mockUrl: string
}

function parsePendingFocus(): PendingFocus | null {
  const hash = new URLSearchParams(location.hash.slice(1))
  const scenarioId = hash.get('scenario')
  const mockUrl = hash.get('url')
  if (!scenarioId || !mockUrl) return null
  return { scenarioId, mockUrl }
}

let pendingFocus: PendingFocus | null = parsePendingFocus()
const editingScenarios = new Set<string>()
if (pendingFocus) editingScenarios.add(pendingFocus.scenarioId)
let projectExpanded = false

function applyPendingFocus() {
  if (!pendingFocus) return
  const card = document.querySelector<HTMLElement>(
    `[data-scenario-id="${CSS.escape(pendingFocus.scenarioId)}"]`,
  )
  if (!card) return

  const mockEditors = [...card.querySelectorAll<HTMLElement>('.mock')]
  const target = mockEditors
    .filter((mockEditor) => {
      const mock = mockReaders.get(mockEditor)?.()
      return mock?.url === pendingFocus?.mockUrl
    })
    .at(-1)

  const highlighted = target ?? card
  highlighted.classList.add('mock--highlight')
  highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' })
  pendingFocus = null
}
let environmentsExpanded = false
const mockReaders = new WeakMap<Element, () => Mock>()

interface VariableValidation {
  level: 'ok' | 'warn' | 'error'
  messages: string[]
}

function validateUrlVariables(
  url: string,
  project?: Project,
): VariableValidation | null {
  const tokens = [...url.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])
  const environments = Object.entries(project?.environments ?? {})
  if (tokens.length === 0 || environments.length === 0) return null

  let level: VariableValidation['level'] = 'ok'
  const messages: string[] = []
  for (const token of [...new Set(tokens)]) {
    const missingIn = environments
      .filter(([, variables]) => !(token in variables))
      .map(([name]) => name)
    if (missingIn.length === environments.length) {
      level = 'error'
      messages.push(`{{${token}}} no existe en ningún entorno`)
    } else if (missingIn.length > 0) {
      if (level !== 'error') level = 'warn'
      messages.push(`{{${token}}} falta en: ${missingIn.join(', ')}`)
    }
  }
  return { level, messages }
}

function applyVariableValidation(
  input: HTMLInputElement,
  project?: Project,
) {
  input.classList.remove('input--var-ok', 'input--var-warn', 'input--var-error')
  const result = validateUrlVariables(input.value, project)
  if (!result) {
    input.title = ''
    return
  }
  input.classList.add(`input--var-${result.level}`)
  input.title =
    result.level === 'ok'
      ? 'Variables resueltas en todos los entornos'
      : result.messages.join('\n')
}

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

async function patchState(patch: Partial<MockerState>) {
  const state = await getState()
  await chrome.storage.local.set({ state: { ...state, ...patch } })
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

let snackbarTimeout: number | undefined

function showSnackbar(message: string) {
  const snackbar = document.getElementById('snackbar')!
  snackbar.textContent = message
  snackbar.hidden = false
  window.clearTimeout(snackbarTimeout)
  snackbarTimeout = window.setTimeout(() => {
    snackbar.hidden = true
  }, 2500)
}

function notifyStructuralEdit(container: HTMLElement) {
  container.dispatchEvent(new Event('input', { bubbles: true }))
}

function buildTextInput(value: string, placeholder = ''): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  return input
}

function buildNumberInput(value: number | undefined): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'number'
  input.value = value === undefined ? '' : String(value)
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
  project?: Project,
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
    const label = nameInput.value.trim() || urlInput.value.trim() || 'este mock'
    if (!confirm(`¿Quitar ${label} del escenario? Se aplica al guardar.`)) {
      return
    }
    const mocksContainer = container.parentElement
    container.remove()
    if (mocksContainer) {
      renumberMocks(mocksContainer)
      notifyStructuralEdit(mocksContainer)
    }
  })
  headerActions.append(removeButton)

  const header = document.createElement('div')
  header.className = 'mock__header'
  header.append(title, nameInput, headerActions)

  const methodSelect = buildMethodSelect(mock.method)
  const urlInput = buildTextInput(mock.url, '/api/… o {{variable}}/api/…')
  urlInput.addEventListener('input', () =>
    applyVariableValidation(urlInput, project),
  )
  applyVariableValidation(urlInput, project)
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
    const parent = row.parentElement
    row.remove()
    if (parent) notifyStructuralEdit(parent)
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
    if (!confirm(`¿Quitar el entorno "${nameInput.value || 'sin nombre'}"? Se aplica al guardar.`)) {
      return
    }
    const parent = container.parentElement
    container.remove()
    if (parent) notifyStructuralEdit(parent)
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
    rowsContainer.append(buildVariableRow('', ''))
    notifyStructuralEdit(rowsContainer)
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

  const projectToggle = document.createElement('button')
  projectToggle.className = 'card__mocks-title card__mocks-title--toggle'

  const body = document.createElement('div')

  const syncProjectVisibility = () => {
    projectToggle.textContent = `${projectExpanded ? '▾' : '▸'} Proyecto — ${project.name} (project.yaml)`
    body.hidden = !projectExpanded
  }
  projectToggle.addEventListener('click', () => {
    projectExpanded = !projectExpanded
    syncProjectVisibility()
  })

  card.append(projectToggle, body)

  const nameInput = buildTextInput(project.name, 'Nombre del proyecto')

  const header = document.createElement('div')
  header.className = 'card__header'
  header.append(buildField('Nombre', nameInput))

  const environmentCount = Object.keys(project.environments ?? {}).length

  const environmentsTitle = document.createElement('button')
  environmentsTitle.className = 'card__mocks-title card__mocks-title--toggle'

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
    if (!environmentsExpanded) {
      environmentsExpanded = true
    }
    environmentsContainer.append(buildEnvironmentEditor('', {}))
    notifyStructuralEdit(environmentsContainer)
  })

  const syncEnvironmentsVisibility = () => {
    environmentsTitle.textContent = `${environmentsExpanded ? '▾' : '▸'} Entornos (${environmentCount})`
    environmentsContainer.hidden = !environmentsExpanded
    addEnvironmentButton.hidden = !environmentsExpanded
  }
  environmentsTitle.addEventListener('click', () => {
    environmentsExpanded = !environmentsExpanded
    syncEnvironmentsVisibility()
  })
  syncEnvironmentsVisibility()

  const environmentsRow = document.createElement('div')
  environmentsRow.className = 'card__envs-row'
  environmentsRow.append(environmentsTitle)

  const environmentNames = Object.keys(project.environments ?? {})
  if (environmentNames.length > 0) {
    const activeSelect = document.createElement('select')
    activeSelect.className = 'network__destination runtime-control'
    activeSelect.title =
      'Entorno activo: resuelve las {{variables}} de las URLs de los mocks'
    activeSelect.replaceChildren(
      ...environmentNames.map((environmentName) => {
        const option = document.createElement('option')
        option.value = environmentName
        option.textContent = `entorno: ${environmentName}`
        return option
      }),
    )
    const current = selectedEnvironment(state)
    if (current) activeSelect.value = current
    activeSelect.addEventListener('change', () => {
      void patchState({ environment: activeSelect.value })
    })
    environmentsRow.append(activeSelect)
  }

  const errorMessage = document.createElement('p')
  errorMessage.className = 'card__error'
  errorMessage.hidden = true

  const saveButton = document.createElement('button')
  saveButton.className = 'button button--primary'
  saveButton.textContent = 'Guardar'
  saveButton.disabled = true
  saveButton.addEventListener('click', async () => {
    const environments = Object.fromEntries(
      [...environmentsContainer.children]
        .map((environment) => environmentReaders.get(environment)!())
        .filter(({ name }) => name)
        .map(({ name, variables }) => [name, variables]),
    )
    const result = await updateProject({
      name: nameInput.value.trim(),
      environments,
    })
    if (!result.ok) {
      errorMessage.textContent = result.error ?? 'Error desconocido'
      errorMessage.hidden = false
      return
    }
    hasUnsavedEdits = false
    await render()
    showSnackbar('Proyecto guardado')
  })

  const footer = document.createElement('div')
  footer.className = 'card__footer'
  footer.append(document.createElement('div'), saveButton)

  body.append(
    header,
    environmentsRow,
    environmentsContainer,
    addEnvironmentButton,
    errorMessage,
    footer,
  )
  syncProjectVisibility()

  const handleCardEdit = (event: Event) => {
    const target = event.target as HTMLElement
    if (
      target.classList.contains('toggle') ||
      target.classList.contains('runtime-control')
    ) {
      return
    }
    markEdited()
    saveButton.disabled = false
  }
  card.addEventListener('input', handleCardEdit)
  card.addEventListener('change', handleCardEdit)

  return card
}

function buildScenarioCard(
  state: MockerState,
  scenario: Scenario | null,
): HTMLElement {
  if (scenario && !editingScenarios.has(scenario.id)) {
    return buildScenarioReadCard(state, scenario)
  }
  return buildScenarioEditCard(state, scenario)
}

async function rebuildScenarioCard(scenarioId: string) {
  const state = await getState()
  const scenario = state.scenarios.find(
    (candidate) => candidate.id === scenarioId,
  )
  const oldCard = document.querySelector(
    `[data-scenario-id="${CSS.escape(scenarioId)}"]`,
  )
  if (!oldCard || !scenario) {
    void render()
    return
  }
  const newCard = buildScenarioCard(state, scenario)
  oldCard.replaceWith(newCard)
  newCard
    .querySelectorAll('textarea')
    .forEach((textarea) => autoGrow(textarea as HTMLTextAreaElement))
}

function buildScenarioReadCard(
  state: MockerState,
  scenario: Scenario,
): HTMLElement {
  const card = document.createElement('section')
  card.className = 'card card--read'
  card.dataset.scenarioId = scenario.id

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

  const name = document.createElement('h3')
  name.className = 'card__name'
  name.textContent = scenario.name

  card.append(top, name)

  if (scenario.description) {
    const description = document.createElement('p')
    description.className = 'card__description'
    description.textContent = scenario.description
    card.append(description)
  }

  const mocksList = document.createElement('div')
  mocksList.className = 'card__read-mocks'
  mocksList.replaceChildren(
    ...scenario.mocks.map((mock, mockIndex) => {
      const row = document.createElement('div')
      row.className = 'read-mock'

      const method = document.createElement('span')
      method.className = 'read-mock__method'
      method.textContent = mock.method.toUpperCase()

      const url = document.createElement('span')
      url.className = 'read-mock__label'
      url.textContent = mock.url
      url.title = `${mock.method.toUpperCase()} ${mock.url}`

      const status = document.createElement('span')
      status.className =
        mock.status >= 400
          ? 'read-mock__status read-mock__status--error'
          : 'read-mock__status'
      status.textContent = String(mock.status)

      const name = document.createElement('span')
      name.className = 'read-mock__name'
      name.textContent = mock.name ?? ''
      name.hidden = !mock.name

      row.append(
        method,
        url,
        name,
        status,
        buildToggle(
          isMockActive(state, scenario.id, mockIndex),
          (checked) => void toggleMock(scenario.id, mockIndex, checked),
          'small',
        ),
      )
      return row
    }),
  )
  card.append(mocksList)

  const editButton = document.createElement('button')
  editButton.className = 'button'
  editButton.textContent = 'Editar'
  editButton.addEventListener('click', () => {
    editingScenarios.add(scenario.id)
    void rebuildScenarioCard(scenario.id)
  })

  const footer = document.createElement('div')
  footer.className = 'card__footer card__footer--read'
  footer.append(editButton)
  card.append(footer)

  return card
}

function buildScenarioEditCard(
  state: MockerState,
  scenario: Scenario | null,
): HTMLElement {
  const card = document.createElement('section')
  card.className = 'card'

  if (scenario) {
    card.dataset.scenarioId = scenario.id
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
        state.project,
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
    mocksContainer.append(
      buildMockEditor(
        { method: 'GET', url: '', status: 200 },
        mocksContainer.children.length + 1,
        state.project,
      ),
    )
    notifyStructuralEdit(mocksContainer)
  })

  const saveButton = document.createElement('button')
  saveButton.className = 'button button--primary'
  saveButton.textContent = 'Guardar'
  saveButton.disabled = true
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
    const result = scenario
      ? await updateScenarioFile(scenario.id, payload)
      : await createScenarioFile(payload)
    if (!result.ok) {
      errorMessage.textContent = result.error ?? 'Error desconocido'
      errorMessage.hidden = false
      return
    }
    if (scenario) editingScenarios.delete(scenario.id)
    hasUnsavedEdits = false
    await render()
    showSnackbar(scenario ? 'Escenario guardado' : 'Escenario creado')
  })

  const cancelButton = document.createElement('button')
  cancelButton.className = 'button'
  cancelButton.textContent = 'Cancelar'
  cancelButton.addEventListener('click', () => {
    if (scenario) {
      editingScenarios.delete(scenario.id)
      void rebuildScenarioCard(scenario.id)
      return
    }
    card.remove()
  })

  const footerActions = document.createElement('div')
  footerActions.className = 'card__footer-side'

  if (scenario) {
    const duplicateButton = document.createElement('button')
    duplicateButton.className = 'button'
    duplicateButton.textContent = 'Duplicar'
    duplicateButton.addEventListener('click', async () => {
      const result = await createScenarioFile({
        name: `${scenario.name} (copia)`,
        ...(scenario.description ? { description: scenario.description } : {}),
        mocks: scenario.mocks,
      })
      if (!result.ok) {
        errorMessage.textContent = result.error ?? 'Error desconocido'
        errorMessage.hidden = false
        return
      }
      showSnackbar('Escenario duplicado')
    })

    const deleteButton = document.createElement('button')
    deleteButton.className = 'button button--danger'
    deleteButton.textContent = 'Eliminar'
    deleteButton.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el escenario "${scenario.name}"?`)) return
      const result = await deleteScenarioFile(scenario.id)
      if (!result.ok) {
        errorMessage.textContent = result.error ?? 'Error desconocido'
        errorMessage.hidden = false
        return
      }
      showSnackbar('Escenario eliminado')
    })

    footerActions.append(duplicateButton, deleteButton)
  }

  const footerMain = document.createElement('div')
  footerMain.className = 'card__footer-side'
  footerMain.append(cancelButton, saveButton)

  const footer = document.createElement('div')
  footer.className = 'card__footer'
  footer.append(footerActions, footerMain)

  card.append(
    header,
    mocksTitle,
    mocksContainer,
    errorMessage,
    addMockButton,
    footer,
  )

  const handleCardEdit = (event: Event) => {
    const target = event.target as HTMLElement
    if (
      target.classList.contains('toggle') ||
      target.classList.contains('runtime-control')
    ) {
      return
    }
    markEdited()
    saveButton.disabled = false
  }
  card.addEventListener('input', handleCardEdit)
  card.addEventListener('change', handleCardEdit)

  return card
}

function renderConnection() {
  const status = document.getElementById('connection-status')!
  if (accessState === 'granted') {
    status.textContent = ''
    status.title = 'Proyecto conectado'
  } else if (accessState === 'needs-permission') {
    status.textContent = 'reconectar'
    status.title = 'Chrome ha caducado el permiso de la carpeta del proyecto'
  } else {
    status.textContent = 'sin proyecto'
    status.title = 'Importa la carpeta .mocks de tu repo'
  }
  status.className =
    accessState === 'granted'
      ? 'header__status header__status--connected'
      : 'header__status header__status--disconnected'
}

async function importProject() {
  const result = await pickProjectDirectory()
  if (!result.ok && result.error !== 'Selección cancelada') {
    renderAccessBanner(result.error)
    return
  }
  await render()
}

async function reconnectProject() {
  const granted = await requestAccess()
  if (!granted) {
    renderAccessBanner('Chrome ha denegado el acceso a la carpeta')
    return
  }
  await reloadSnapshot()
  await render()
}

function renderAccessBanner(errorMessage?: string) {
  const banner = document.getElementById('access-banner')!
  const text = document.getElementById('access-banner-text')!
  const action = document.getElementById(
    'access-banner-action',
  ) as HTMLButtonElement

  if (accessState === 'granted' && !errorMessage) {
    banner.hidden = true
    return
  }

  banner.hidden = false
  if (accessState === 'needs-permission') {
    text.textContent =
      errorMessage ??
      'Chrome ha caducado el permiso de la carpeta del proyecto (pasa en cada sesión nueva del navegador).'
    action.textContent = 'Reconectar carpeta'
    action.onclick = () => void reconnectProject()
  } else {
    text.textContent =
      errorMessage ??
      'Ningún proyecto importado. Elige la carpeta .mocks de tu repo (o el repo que la contiene).'
    action.textContent = 'Importar proyecto'
    action.onclick = () => void importProject()
  }
}

function renderValidationBanner(state: MockerState) {
  const banner = document.getElementById('validation-banner')!

  interface ValidationIssue {
    scenarioId: string
    mockIndex: number
    level: 'warn' | 'error'
    text: string
  }
  const issues: ValidationIssue[] = []
  for (const scenario of state.scenarios) {
    scenario.mocks.forEach((mock, index) => {
      const result = validateUrlVariables(mock.url, state.project)
      if (!result || result.level === 'ok') return
      issues.push({
        scenarioId: scenario.id,
        mockIndex: index,
        level: result.level,
        text: `${scenario.name} · Mock ${index + 1}: ${result.messages.join('; ')}`,
      })
    })
  }

  banner.hidden = issues.length === 0
  if (issues.length === 0) return

  banner.classList.toggle(
    'banner--error',
    issues.some((issue) => issue.level === 'error'),
  )

  const title = document.createElement('div')
  title.className = 'banner__title'
  title.textContent = `Problemas detectados en las URLs (${issues.length}) — pulsa para revisar:`

  banner.replaceChildren(
    title,
    ...issues.map((issue) => {
      const item = document.createElement('button')
      item.className = 'banner__item'
      item.textContent = issue.text
      item.addEventListener('click', async () => {
        if (!editingScenarios.has(issue.scenarioId)) {
          editingScenarios.add(issue.scenarioId)
          await rebuildScenarioCard(issue.scenarioId)
        }
        const card = document.querySelector(
          `[data-scenario-id="${CSS.escape(issue.scenarioId)}"]`,
        )
        const mock = card?.querySelectorAll('.mock')[issue.mockIndex] ?? card
        if (!mock) return
        mock.classList.add('mock--highlight')
        mock.scrollIntoView({ behavior: 'smooth', block: 'center' })
        window.setTimeout(() => mock.classList.remove('mock--highlight'), 2000)
      })
      return item
    }),
  )
}

function renderGlobalToggle(state: MockerState) {
  const toggle = document.getElementById('global-toggle') as HTMLInputElement
  toggle.checked = state.enabled !== false
}

async function render() {
  const [state, access] = await Promise.all([getState(), getAccessState()])
  accessState = access
  renderConnection()
  renderAccessBanner()
  renderValidationBanner(state)
  renderGlobalToggle(state)

  const projectContainer = document.getElementById('project-container')!
  const projectCard = buildProjectCard(state)
  projectContainer.replaceChildren(...(projectCard ? [projectCard] : []))
  projectContainer
    .querySelectorAll('textarea')
    .forEach((textarea) => autoGrow(textarea as HTMLTextAreaElement))

  const list = document.getElementById('scenario-list')!
  const emptyMessage = document.getElementById('empty-message')!
  emptyMessage.hidden = state.scenarios.length > 0
  emptyMessage.textContent =
    accessState === 'granted'
      ? 'No hay escenarios. Crea el primero con "Nuevo escenario".'
      : 'Importa la carpeta .mocks de tu repo para empezar.'

  list.replaceChildren(
    ...state.scenarios.map((scenario) => buildScenarioCard(state, scenario)),
  )
  list
    .querySelectorAll('textarea')
    .forEach((textarea) => autoGrow(textarea as HTMLTextAreaElement))
  document.getElementById('stale-banner')!.hidden = true
  hasUnsavedEdits = false
  lastRenderedSnapshot = snapshotKey(state)
  applyPendingFocus()
}

document.getElementById('new-scenario')!.addEventListener('click', async () => {
  markEdited()
  const state = await getState()
  const list = document.getElementById('scenario-list')!
  const card = buildScenarioCard(state, null)
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
  renderGlobalToggle(state)
  const activeEnvironmentSelect = document.querySelector<HTMLSelectElement>(
    '.card__envs-row select',
  )
  const currentEnvironment = selectedEnvironment(state)
  if (activeEnvironmentSelect && currentEnvironment) {
    activeEnvironmentSelect.value = currentEnvironment
  }
  if (snapshotKey(state) === lastRenderedSnapshot) return
  if (hasUnsavedEdits) {
    document.getElementById('stale-banner')!.hidden = false
    return
  }
  void render()
})

document.getElementById('import-project')!.addEventListener('click', () => {
  void importProject()
})

function selectTab(docs: boolean) {
  document.getElementById('view-scenarios')!.hidden = docs
  document.getElementById('view-docs')!.hidden = !docs
  document
    .getElementById('tab-scenarios')!
    .classList.toggle('tab--active', !docs)
  document.getElementById('tab-docs')!.classList.toggle('tab--active', docs)
}

document
  .getElementById('tab-scenarios')!
  .addEventListener('click', () => selectTab(false))
document
  .getElementById('tab-docs')!
  .addEventListener('click', () => selectTab(true))

void reloadSnapshot().then(() => render())
