import {
  EMPTY_STATE,
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

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

function writeToDaemon(payload: object): Promise<WriteResult> {
  return chrome.runtime.sendMessage({ type: 'mocker:write', payload })
}

function markEdited() {
  hasUnsavedEdits = true
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

function renumberMocks(mocksContainer: HTMLElement) {
  ;[...mocksContainer.children].forEach((mockEditor, index) => {
    const title = mockEditor.querySelector('.mock__title')
    if (title) title.textContent = `Mock ${index + 1}`
  })
}

function buildMockEditor(mock: Mock, mockNumber: number): HTMLElement {
  const container = document.createElement('div')
  container.className = 'mock'

  const title = document.createElement('span')
  title.className = 'mock__title'
  title.textContent = `Mock ${mockNumber}`

  const removeButton = document.createElement('button')
  removeButton.className = 'button button--danger button--small'
  removeButton.textContent = 'Quitar'
  removeButton.addEventListener('click', () => {
    markEdited()
    const mocksContainer = container.parentElement
    container.remove()
    if (mocksContainer) renumberMocks(mocksContainer)
  })

  const header = document.createElement('div')
  header.className = 'mock__header'
  header.append(title, removeButton)

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
  responseInput.addEventListener('input', markEdited)

  container.append(header, firstRow, buildField('Respuesta', responseInput))
  return container
}

function readMock(container: HTMLElement): Mock {
  const [methodSelect] = container.getElementsByTagName('select')
  const [urlInput, statusInput, delayInput] =
    container.getElementsByTagName('input')
  const [responseInput] = container.getElementsByTagName('textarea')

  const delay = Number(delayInput.value)
  return {
    method: methodSelect.value,
    url: urlInput.value.trim(),
    status: Number(statusInput.value),
    ...(delay > 0 ? { delay } : {}),
    response: parseResponse(responseInput.value),
  }
}

function buildScenarioCard(scenario: Scenario | null): HTMLElement {
  const card = document.createElement('section')
  card.className = 'card'

  if (scenario) {
    const idLabel = document.createElement('div')
    idLabel.className = 'card__id'
    idLabel.textContent = `${scenario.id}.yaml`
    card.append(idLabel)
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
      buildMockEditor(mock, index + 1),
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
        readMock(mockEditor as HTMLElement),
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

async function render() {
  const state = await getState()
  renderConnection(state)
  document.getElementById('project-name')!.textContent =
    state.project?.name ?? '—'

  const list = document.getElementById('scenario-list')!
  const emptyMessage = document.getElementById('empty-message')!
  emptyMessage.hidden = state.scenarios.length > 0
  emptyMessage.textContent = state.connected
    ? 'No hay escenarios. Crea el primero con "Nuevo escenario".'
    : 'Arranca el daemon apuntando a un repo con .mocks/ para empezar.'

  list.replaceChildren(
    ...state.scenarios.map((scenario) => buildScenarioCard(scenario)),
  )
  document.getElementById('stale-banner')!.hidden = true
  hasUnsavedEdits = false
}

document.getElementById('new-scenario')!.addEventListener('click', () => {
  markEdited()
  const list = document.getElementById('scenario-list')!
  list.prepend(buildScenarioCard(null))
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return
  if (hasUnsavedEdits) {
    const state = changes.state.newValue as MockerState | undefined
    if (state) renderConnection(state)
    document.getElementById('stale-banner')!.hidden = false
    return
  }
  void render()
})

void render()
