const frame = document.createElement('iframe')
frame.src = `popup.html?tab=${chrome.devtools.inspectedWindow.tabId}`
document.body.append(frame)
