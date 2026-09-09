import {
  clearRuntimeLogs,
  getAccessState,
  reloadSnapshot,
  writeRuntimeRequestsLog,
  writeRuntimeWsFramesLog,
} from './lib/filesystem'
import { isOriginDisabled, type MockerState } from './lib/state'

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

async function syncFromDisk() {
  if ((await getAccessState()) !== 'granted') return
  const { runtimeLogsCleared } =
    await chrome.storage.session.get('runtimeLogsCleared')
  if (!runtimeLogsCleared) {
    await clearRuntimeLogs()
    await chrome.storage.session.set({ runtimeLogsCleared: true })
  }
  await reloadSnapshot()
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

async function incrementMatchedCount(scenarioId: string) {
  const { counts } = await chrome.storage.session.get('counts')
  const current = (counts as Record<string, number> | undefined) ?? {}
  await chrome.storage.session.set({
    counts: { ...current, [scenarioId]: (current[scenarioId] ?? 0) + 1 },
  })
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'mocker:sync') {
    void syncFromDisk()
    return
  }

  if (message?.type === 'mocker:matched') {
    void incrementMatchedCount(message.scenarioId as string)
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
