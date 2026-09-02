export interface Mock {
  name?: string
  method: string
  url: string
  status: number
  delay?: number
  headers?: Record<string, string>
  response?: unknown
}

export interface Scenario {
  id: string
  name: string
  description?: string
  archived?: boolean
  mocks: Mock[]
}

export interface Project {
  name: string
  order?: string[]
  environments?: Record<string, Record<string, string>>
}

export interface ScenarioActivation {
  active: boolean
  activatedAt: number
}

export interface MockerState {
  connected: boolean
  enabled?: boolean
  disabledOrigins?: string[]
  project?: Project
  scenarios: Scenario[]
  activation: Record<string, ScenarioActivation>
  mockActivation?: Record<string, Record<number, boolean>>
  environment?: string
}

export interface ResolvedMock extends Mock {
  scenarioId: string
}

export interface CapturedRequest {
  method: string
  url: string
  status: number
  mocked?: boolean
  body?: string
  origin: string
  at: number
  tabId?: number
}

export const EMPTY_STATE: MockerState = {
  connected: false,
  scenarios: [],
  activation: {},
}

export function selectedEnvironment(state: MockerState): string | undefined {
  const environments = state.project?.environments
  if (!environments) return undefined
  const names = Object.keys(environments)
  if (state.environment && names.includes(state.environment)) {
    return state.environment
  }
  return names[0]
}

export function isMockActive(
  state: MockerState,
  scenarioId: string,
  mockIndex: number,
): boolean {
  return state.mockActivation?.[scenarioId]?.[mockIndex] !== false
}

export function resolveActiveMocks(state: MockerState): ResolvedMock[] {
  if (state.enabled === false) return []

  const environmentName = selectedEnvironment(state)
  const variables = environmentName
    ? (state.project?.environments?.[environmentName] ?? {})
    : {}

  const activeScenarios = state.scenarios
    .filter((scenario) => !scenario.archived)
    .filter((scenario) => state.activation[scenario.id]?.active)
    .sort(
      (first, second) =>
        state.activation[second.id].activatedAt -
        state.activation[first.id].activatedAt,
    )

  return activeScenarios.flatMap((scenario) =>
    scenario.mocks
      .map((mock, mockIndex) => ({ mock, mockIndex }))
      .filter(({ mockIndex }) => isMockActive(state, scenario.id, mockIndex))
      .map(({ mock }) => ({
        ...mock,
        scenarioId: scenario.id,
        url: substituteVariables(mock.url, variables),
      })),
  )
}

function substituteVariables(
  url: string,
  variables: Record<string, string>,
): string {
  return url.replace(
    /\{\{(\w+)\}\}/g,
    (match, name: string) => variables[name] ?? match,
  )
}

