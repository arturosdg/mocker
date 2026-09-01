import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'

import type { Mock, Project, Scenario } from './types.js'

export interface ScenarioPayload {
  name: string
  description?: string
  mocks: Mock[]
}

export interface WriteRequest {
  requestId: string
  type:
    | 'scenario_create'
    | 'scenario_update'
    | 'scenario_delete'
    | 'project_update'
  id?: string
  scenario?: ScenarioPayload
  project?: Project
}

export function applyWrite(
  mocksDirectory: string,
  request: WriteRequest,
): string {
  if (request.type === 'project_update') {
    const project = validateProject(request.project)
    writeFileSync(
      path.join(mocksDirectory, 'project.yaml'),
      stringify(project),
    )
    return 'project'
  }

  const scenariosDirectory = path.join(mocksDirectory, 'scenarios')
  mkdirSync(scenariosDirectory, { recursive: true })

  if (request.type === 'scenario_delete') {
    const id = requireId(request)
    unlinkSync(scenarioFile(scenariosDirectory, id))
    return id
  }

  const scenario = validateScenario(request.scenario)

  if (request.type === 'scenario_create') {
    const id = uniqueId(scenariosDirectory, slugify(scenario.name))
    writeScenario(scenariosDirectory, id, scenario)
    return id
  }

  const id = requireId(request)
  if (!existsSync(scenarioFile(scenariosDirectory, id))) {
    throw new Error(`Scenario "${id}" does not exist`)
  }
  writeScenario(scenariosDirectory, id, scenario)
  return id
}

function writeScenario(
  scenariosDirectory: string,
  id: string,
  scenario: ScenarioPayload,
) {
  const content: Omit<Scenario, 'id'> = {
    name: scenario.name,
    ...(scenario.description ? { description: scenario.description } : {}),
    mocks: scenario.mocks,
  }
  writeFileSync(scenarioFile(scenariosDirectory, id), stringify(content))
}

function scenarioFile(scenariosDirectory: string, id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error(`Invalid scenario id "${id}"`)
  }
  return path.join(scenariosDirectory, `${id}.yaml`)
}

function requireId(request: WriteRequest): string {
  if (!request.id) throw new Error('Missing scenario id')
  return request.id
}

function validateScenario(
  scenario: ScenarioPayload | undefined,
): ScenarioPayload {
  if (!scenario?.name?.trim()) throw new Error('Scenario name is required')
  if (!Array.isArray(scenario.mocks)) throw new Error('Mocks must be a list')
  scenario.mocks.forEach((mock, index) => {
    if (!mock.method?.trim()) throw new Error(`Mock ${index + 1}: missing method`)
    if (!mock.url?.trim()) throw new Error(`Mock ${index + 1}: missing url`)
    if (!Number.isInteger(mock.status)) {
      throw new Error(`Mock ${index + 1}: missing status`)
    }
  })
  return scenario
}

function validateProject(project: Project | undefined): Project {
  if (!project?.name?.trim()) throw new Error('Project name is required')
  if (!Array.isArray(project.targets)) {
    throw new Error('Targets must be a list')
  }
  return {
    name: project.name.trim(),
    targets: project.targets.filter((target) => target.trim()),
    ...(project.environments && Object.keys(project.environments).length > 0
      ? { environments: project.environments }
      : {}),
  }
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'escenario'
}

function uniqueId(scenariosDirectory: string, slug: string): string {
  if (!existsSync(scenarioFile(scenariosDirectory, slug))) return slug
  let counter = 2
  while (existsSync(scenarioFile(scenariosDirectory, `${slug}-${counter}`))) {
    counter += 1
  }
  return `${slug}-${counter}`
}
