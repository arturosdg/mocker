export interface Mock {
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
  mocks: Mock[]
}

export interface Project {
  name: string
  targets: string[]
  environments?: Record<string, Record<string, string>>
}

export interface Snapshot {
  type: 'snapshot'
  project: Project
  scenarios: Scenario[]
}
