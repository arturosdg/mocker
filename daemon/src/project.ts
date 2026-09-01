import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

import type { Project, Scenario, Snapshot } from './types.js'

export function loadSnapshot(mocksDirectory: string): Snapshot {
  const projectFile = path.join(mocksDirectory, 'project.yaml')
  if (!existsSync(projectFile)) {
    throw new Error(`No project.yaml found in ${mocksDirectory}`)
  }
  const project = parse(readFileSync(projectFile, 'utf8')) as Project
  return { type: 'snapshot', project, scenarios: loadScenarios(mocksDirectory) }
}

function loadScenarios(mocksDirectory: string): Scenario[] {
  const scenariosDirectory = path.join(mocksDirectory, 'scenarios')
  if (!existsSync(scenariosDirectory)) return []

  return readdirSync(scenariosDirectory)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => {
      const parsed = parse(
        readFileSync(path.join(scenariosDirectory, file), 'utf8'),
      ) as Omit<Scenario, 'id'>
      return { id: file.replace(/\.ya?ml$/, ''), ...parsed }
    })
}
