import {
  getAccessState,
  reloadSnapshot,
  writeRuntimeRequestsLog,
} from './lib/filesystem'

async function syncFromDisk() {
  if ((await getAccessState()) === 'granted') {
    await reloadSnapshot()
  }
}

chrome.alarms.create('mocker-sync', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'mocker-sync') void syncFromDisk()
})
chrome.runtime.onStartup.addListener(() => void syncFromDisk())
chrome.runtime.onInstalled.addListener(() => void syncFromDisk())
void syncFromDisk()

const MAX_CAPTURED_REQUESTS = 50

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
})
