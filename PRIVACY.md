# Privacy Policy — Mocker

_Last updated: 10 September 2026_

Mocker is a Chrome extension for developers that serves fake API responses to
the page you are working on, from YAML files in a folder you choose.

**Mocker does not collect, store or transmit personal data.** It has no
backend, no account system, and no analytics or telemetry of any kind. There
is nowhere for your data to go: the extension has no server to send it to.

## What Mocker accesses, and why

| What | Why | Where it stays |
| --- | --- | --- |
| The network requests of the tabs where it is enabled (URL, method, request body, response status and body) | To decide whether a request matches one of your mocks and to serve the response you defined, and to show you the tab's traffic so you can turn a real request into a new mock | In memory for the current browser session, and in the log file described below |
| The folder you select through Chrome's folder picker | To read your scenarios and to write the ones you create or edit from the extension | On your disk, in that folder |
| Extension settings (which scenarios and mocks are active, the selected environment, the per-domain off switch) | To remember your setup between sessions | In Chrome's local extension storage, on your device |

## What Mocker writes

Inside the folder you selected, and nowhere else:

- `project.yaml` and `scenarios/*.yaml` — the mocks you create or edit.
- `websockets.yaml` — the WebSocket messages you save.
- `.runtime/requests.json` and `.runtime/websockets.json` — a log of the last
  200 requests and WebSocket frames it captured, so that you (or a coding
  agent working on your behalf) can see what the application actually called.
  **This log is cleared at the start of every browser session.**

Access to that folder is granted by you explicitly, through Chrome's own
folder picker (the File System Access API). Mocker cannot read anything
outside it. Chrome expires that permission at the end of each browser
session, and it is you who restores it.

## Permissions

- **`storage`** — the extension settings listed above, plus the buffer of
  requests captured during the current session.
- **`alarms`** — a periodic check that re-reads your folder, so changes made
  outside the browser show up in the extension.
- **Access to all websites (`<all_urls>`)** — you decide which page you are
  testing, and those hosts cannot be known in advance: they are localhost
  ports, staging domains and internal applications that differ per project.
  Mocker therefore needs to be able to intercept on any page you enable it
  on. It only patches `fetch`, `XMLHttpRequest` and `WebSocket` inside the
  page; nothing is transmitted off your device, and you can switch any domain
  off from the popup.

## What Mocker never does

- It does not send your data anywhere, to us or to anyone else.
- It does not sell or share data with third parties.
- It does not use your data for advertising, profiling, credit assessment or
  lending purposes.
- It does not run remote code: everything it executes ships inside the
  extension package.

## Changes

If this policy ever changes, the new version will be published in this file
and the date above will be updated.

## Contact

Questions or concerns: <https://github.com/arturosdg/mocker/issues>
