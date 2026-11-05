import {
  getAccessState,
  reloadSnapshot,
  writeRuntimeRequestsLog,
  writeRuntimeStateLog,
  writeRuntimeWsFramesLog,
} from './lib/filesystem'
import {
  addFlags,
  FLAGS_KEY,
  removeScenarioFlags,
  toFlagList,
  type ScenarioFlags,
} from './lib/flags'
import { isOriginDisabled, type MockerState } from './lib/state'

// el content script lee las marcas de escenario de storage.session
void chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  .catch(() => {})

const ICON_ON = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
}
const ICON_OFF = {
  16: 'icons/icon-off-16.png',
  32: 'icons/icon-off-32.png',
  48: 'icons/icon-off-48.png',
}

async function updateActionIcon(tabId: number, url: string | undefined) {
  let disabled = false
  if (url && /^https?:/.test(url)) {
    const { state } = await chrome.storage.local.get('state')
    disabled = state
      ? isOriginDisabled(state as MockerState, new URL(url).origin)
      : false
  }
  try {
    await chrome.action.setIcon({ tabId, path: disabled ? ICON_OFF : ICON_ON })
  } catch {
    // the tab may be gone by now
  }
}

async function updateAllActionIcons() {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id !== undefined) void updateActionIcon(tab.id, tab.url)
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    void updateActionIcon(tabId, tab.url)
  }
})
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => updateActionIcon(tabId, tab.url))
    .catch(() => {})
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) void updateAllActionIcons()
})
void updateAllActionIcons()

// Al ver la carpeta accesible por primera vez en esta sesión de navegador,
// el log en disco se reescribe con lo capturado hasta ahora: al arrancar el
// navegador storage.session está vacío y equivale a purgarlo, pero si la
// carpeta se conecta a mitad de sesión (proyecto nuevo, reconexión, cambio de
// proyecto) el tráfico ya capturado aterriza en el log sin esperar a la
// siguiente petición.
async function syncFromDisk(forceLogFlush = false) {
  if ((await getAccessState()) !== 'granted') return
  const { runtimeLogsCleared } =
    await chrome.storage.session.get('runtimeLogsCleared')
  if (!runtimeLogsCleared || forceLogFlush) {
    await flushRuntimeLogs()
    await chrome.storage.session.set({ runtimeLogsCleared: true })
  }
  await reloadSnapshot()
}

async function flushRuntimeLogs() {
  const stored = await chrome.storage.session.get([
    'requests',
    'wsFrames',
    FLAGS_KEY,
  ])
  await writeRuntimeRequestsLog((stored.requests as unknown[] | undefined) ?? [])
  await writeRuntimeWsFramesLog((stored.wsFrames as unknown[] | undefined) ?? [])
  await writeRuntimeStateLog(
    (stored[FLAGS_KEY] as ScenarioFlags | undefined) ?? {},
  )
}

chrome.alarms.create('mocker-sync', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mocker-sync') void syncFromDisk()
})
chrome.runtime.onStartup.addListener(() => void syncFromDisk())
chrome.runtime.onInstalled.addListener(() => void syncFromDisk())
void syncFromDisk()

const MAX_CAPTURED_REQUESTS = 200

let capturedRequestsQueue: Promise<void> = Promise.resolve()

function appendCapturedRequest(
  request: object,
  origin: string,
  tabId: number | undefined,
) {
  capturedRequestsQueue = capturedRequestsQueue.then(async () => {
    const { requests } = await chrome.storage.session.get('requests')
    const list = (requests as object[] | undefined) ?? []
    list.unshift({ ...request, origin, at: Date.now(), tabId })
    const capped = list.slice(0, MAX_CAPTURED_REQUESTS)
    await chrome.storage.session.set({ requests: capped })
    await writeRuntimeRequestsLog(capped)
  })
}

let capturedWsFramesQueue: Promise<void> = Promise.resolve()

function appendCapturedWsFrame(
  frame: object,
  origin: string,
  tabId: number | undefined,
) {
  capturedWsFramesQueue = capturedWsFramesQueue.then(async () => {
    const { wsFrames } = await chrome.storage.session.get('wsFrames')
    const list = (wsFrames as object[] | undefined) ?? []
    list.unshift({ ...frame, origin, at: Date.now(), tabId })
    const capped = list.slice(0, MAX_CAPTURED_REQUESTS)
    await chrome.storage.session.set({ wsFrames: capped })
    await writeRuntimeWsFramesLog(capped)
  })
}

let flagsQueue: Promise<void> = Promise.resolve()

function updateFlags(change: (current: ScenarioFlags) => ScenarioFlags) {
  flagsQueue = flagsQueue.then(async () => {
    const stored = await chrome.storage.session.get(FLAGS_KEY)
    const current = (stored[FLAGS_KEY] as ScenarioFlags | undefined) ?? {}
    const next = change(current)
    if (next !== current) await chrome.storage.session.set({ [FLAGS_KEY]: next })
  })
}

// Activar un escenario (o reactivarlo) empieza una sesión limpia: sus marcas
// se borran.
function activatedScenarios(
  previous: MockerState | undefined,
  next: MockerState | undefined,
): string[] {
  if (!next) return []
  return Object.entries(next.activation ?? {})
    .filter(
      ([id, activation]) =>
        activation.active &&
        previous?.activation?.[id]?.activatedAt !== activation.activatedAt,
    )
    .map(([id]) => id)
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) {
    const activated = activatedScenarios(
      changes.state.oldValue as MockerState | undefined,
      changes.state.newValue as MockerState | undefined,
    )
    if (activated.length > 0) {
      updateFlags((current) => removeScenarioFlags(current, activated))
    }
  }
  if (area === 'session' && changes[FLAGS_KEY]) {
    void writeRuntimeStateLog(
      (changes[FLAGS_KEY].newValue as ScenarioFlags | undefined) ?? {},
    )
  }
})

async function incrementMatchedCount(scenarioId: string) {
  const { counts } = await chrome.storage.session.get('counts')
  const current = (counts as Record<string, number> | undefined) ?? {}
  await chrome.storage.session.set({
    counts: { ...current, [scenarioId]: (current[scenarioId] ?? 0) + 1 },
  })
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'mocker:sync') {
    void syncFromDisk(message.flushLogs === true)
    return
  }

  if (message?.type === 'mocker:matched') {
    const scenarioId = message.scenarioId as string
    void incrementMatchedCount(scenarioId)
    const sets = toFlagList(message.sets as string[] | undefined)
    if (sets.length > 0) {
      updateFlags((current) => addFlags(current, scenarioId, sets))
    }
    return
  }

  if (message?.type === 'mocker:reset-flags') {
    const scenarioId = message.scenarioId as string
    updateFlags((current) => removeScenarioFlags(current, [scenarioId]))
    return
  }

  if (message?.type === 'mocker:request') {
    appendCapturedRequest(
      message.request as object,
      sender.origin ?? sender.url ?? '',
      sender.tab?.id,
    )
  }

  if (message?.type === 'mocker:ws-frame') {
    appendCapturedWsFrame(
      message.frame as object,
      sender.origin ?? sender.url ?? '',
      sender.tab?.id,
    )
  }
})
