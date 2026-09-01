import { parse, stringify } from 'yaml'

import type { Mock, MockerState, Project, Scenario } from './state'
import { EMPTY_STATE } from './state'

const DATABASE_NAME = 'mocker'
const HANDLES_STORE = 'handles'
const DIRECTORY_KEY = 'mocksDirectory'

export type AccessState = 'granted' | 'needs-permission' | 'no-project'

export interface WriteResult {
  ok: boolean
  id?: string
  error?: string
}

export interface ScenarioPayload {
  name: string
  description?: string
  mocks: Mock[]
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(HANDLES_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(HANDLES_STORE, 'readwrite')
    transaction.objectStore(HANDLES_STORE).put(handle, DIRECTORY_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

async function loadDirectoryHandle(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database
      .transaction(HANDLES_STORE, 'readonly')
      .objectStore(HANDLES_STORE)
      .get(DIRECTORY_KEY)
    request.onsuccess = () =>
      resolve(request.result as FileSystemDirectoryHandle | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function getAccessState(): Promise<AccessState> {
  const handle = await loadDirectoryHandle().catch(() => undefined)
  if (!handle) return 'no-project'
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  return permission === 'granted' ? 'granted' : 'needs-permission'
}

export async function requestAccess(): Promise<boolean> {
  const handle = await loadDirectoryHandle().catch(() => undefined)
  if (!handle) return false
  const permission = await handle.requestPermission({ mode: 'readwrite' })
  return permission === 'granted'
}

async function resolveMocksDirectory(
  picked: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    await picked.getFileHandle('project.yaml')
    return picked
  } catch {
    // not the .mocks directory itself; look for a .mocks child
  }
  try {
    const child = await picked.getDirectoryHandle('.mocks')
    await child.getFileHandle('project.yaml')
    return child
  } catch {
    return null
  }
}

export async function pickProjectDirectory(): Promise<WriteResult> {
  let picked: FileSystemDirectoryHandle
  try {
    picked = await window.showDirectoryPicker({
      id: 'mocker-project',
      mode: 'readwrite',
    })
  } catch {
    return { ok: false, error: 'Selección cancelada' }
  }

  const mocksDirectory = await resolveMocksDirectory(picked)
  if (!mocksDirectory) {
    return {
      ok: false,
      error:
        'La carpeta elegida no contiene project.yaml ni una subcarpeta .mocks/ con él',
    }
  }
  await saveDirectoryHandle(mocksDirectory)
  return reloadSnapshot()
}

async function getState(): Promise<MockerState> {
  const { state } = await chrome.storage.local.get('state')
  return (state as MockerState | undefined) ?? EMPTY_STATE
}

async function patchState(patch: Partial<MockerState>) {
  const state = await getState()
  await chrome.storage.local.set({ state: { ...state, ...patch } })
}

export async function markDisconnected() {
  const state = await getState()
  if (state.connected) await patchState({ connected: false })
}

async function readFileText(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<string> {
  const fileHandle = await directory.getFileHandle(name)
  const file = await fileHandle.getFile()
  return file.text()
}

export async function reloadSnapshot(): Promise<WriteResult> {
  const handle = await loadDirectoryHandle().catch(() => undefined)
  if (!handle) {
    await markDisconnected()
    return { ok: false, error: 'No hay proyecto importado' }
  }
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission !== 'granted') {
    await markDisconnected()
    return { ok: false, error: 'Sin permiso sobre la carpeta del proyecto' }
  }

  try {
    const project = parse(await readFileText(handle, 'project.yaml')) as Project
    const scenarios = await readScenarios(handle)
    const state = await getState()
    const changed =
      JSON.stringify({ project: state.project, scenarios: state.scenarios }) !==
      JSON.stringify({ project, scenarios })
    if (changed || !state.connected) {
      await patchState({ project, scenarios, connected: true })
    }
    return { ok: true }
  } catch (error) {
    await markDisconnected()
    return {
      ok: false,
      error: `No se pudo leer el proyecto: ${error instanceof Error ? error.message : error}`,
    }
  }
}

async function readScenarios(
  handle: FileSystemDirectoryHandle,
): Promise<Scenario[]> {
  let scenariosDirectory: FileSystemDirectoryHandle
  try {
    scenariosDirectory = await handle.getDirectoryHandle('scenarios')
  } catch {
    return []
  }

  const scenarios: Scenario[] = []
  for await (const entry of scenariosDirectory.values()) {
    if (entry.kind !== 'file' || !/\.ya?ml$/.test(entry.name)) continue
    const file = await (entry as FileSystemFileHandle).getFile()
    const parsed = parse(await file.text()) as Omit<Scenario, 'id'>
    scenarios.push({ id: entry.name.replace(/\.ya?ml$/, ''), ...parsed })
  }
  return scenarios.sort((first, second) => first.id.localeCompare(second.id))
}

async function requireGrantedDirectory(): Promise<FileSystemDirectoryHandle> {
  const handle = await loadDirectoryHandle().catch(() => undefined)
  if (!handle) throw new Error('No hay proyecto importado')
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission !== 'granted') {
    throw new Error('Sin permiso sobre la carpeta — reconéctala en Configuración')
  }
  return handle
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  content: string,
) {
  const fileHandle = await directory.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

function validateScenario(payload: ScenarioPayload): ScenarioPayload {
  if (!payload.name?.trim()) throw new Error('El escenario necesita un nombre')
  if (!Array.isArray(payload.mocks)) throw new Error('Mocks inválidos')
  payload.mocks.forEach((mock, index) => {
    if (!mock.method?.trim()) throw new Error(`Mock ${index + 1}: falta el método`)
    if (!mock.url?.trim()) throw new Error(`Mock ${index + 1}: falta la URL`)
    if (!Number.isInteger(mock.status)) {
      throw new Error(`Mock ${index + 1}: falta el status`)
    }
  })
  return payload
}

function scenarioFileContent(payload: ScenarioPayload): string {
  return stringify({
    name: payload.name,
    ...(payload.description ? { description: payload.description } : {}),
    mocks: payload.mocks,
  })
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

async function uniqueScenarioId(
  scenariosDirectory: FileSystemDirectoryHandle,
  slug: string,
): Promise<string> {
  const exists = async (candidate: string) => {
    try {
      await scenariosDirectory.getFileHandle(`${candidate}.yaml`)
      return true
    } catch {
      return false
    }
  }
  if (!(await exists(slug))) return slug
  let counter = 2
  while (await exists(`${slug}-${counter}`)) counter += 1
  return `${slug}-${counter}`
}

async function performWrite(
  operation: (handle: FileSystemDirectoryHandle) => Promise<string>,
): Promise<WriteResult> {
  try {
    const handle = await requireGrantedDirectory()
    const id = await operation(handle)
    const reload = await reloadSnapshot()
    if (!reload.ok) return reload
    return { ok: true, id }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function createScenario(payload: ScenarioPayload): Promise<WriteResult> {
  return performWrite(async (handle) => {
    const validated = validateScenario(payload)
    const scenariosDirectory = await handle.getDirectoryHandle('scenarios', {
      create: true,
    })
    const id = await uniqueScenarioId(
      scenariosDirectory,
      slugify(validated.name),
    )
    await writeFile(scenariosDirectory, `${id}.yaml`, scenarioFileContent(validated))
    return id
  })
}

export function updateScenario(
  id: string,
  payload: ScenarioPayload,
): Promise<WriteResult> {
  return performWrite(async (handle) => {
    const validated = validateScenario(payload)
    const scenariosDirectory = await handle.getDirectoryHandle('scenarios')
    await scenariosDirectory.getFileHandle(`${id}.yaml`)
    await writeFile(scenariosDirectory, `${id}.yaml`, scenarioFileContent(validated))
    return id
  })
}

export function deleteScenario(id: string): Promise<WriteResult> {
  return performWrite(async (handle) => {
    const scenariosDirectory = await handle.getDirectoryHandle('scenarios')
    await scenariosDirectory.removeEntry(`${id}.yaml`)
    return id
  })
}

export function updateProject(project: Project): Promise<WriteResult> {
  return performWrite(async (handle) => {
    if (!project.name?.trim()) throw new Error('El proyecto necesita un nombre')
    const content = stringify({
      name: project.name.trim(),
      ...(project.environments && Object.keys(project.environments).length > 0
        ? { environments: project.environments }
        : {}),
    })
    await writeFile(handle, 'project.yaml', content)
    return 'project'
  })
}
