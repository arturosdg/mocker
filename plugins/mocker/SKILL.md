---
name: mocker
description: >-
  Mock API responses in the browser through the mocker Chrome extension by
  editing YAML files in the project's .mocks/ folder (any folder, not
  necessarily a repo) and verifying matches via
  .mocks/.runtime/requests.json. Use when the user asks to mock the network,
  fake or intercept HTTP calls, return a fixed response for an endpoint,
  simulate a backend error (500, 401, timeout/delay), create or edit mock
  scenarios, or check which requests were intercepted. Keywords: mocker, mock,
  mockear la red, escenario de mocks, interceptar llamadas.
---

# mocker — file-driven network mocks

mocker is a Chrome extension that intercepts `fetch`/XHR and serves responses
defined in YAML inside a `.mocks/` folder the user connects from the
extension — usually the app's repo, but any folder works. Your interface as an
agent is **files**: you write scenarios under `.mocks/` and read the log at
`.mocks/.runtime/requests.json`. There is no CLI and no server.

## Locate the project

A mock project is any folder with `project.yaml` inside a `.mocks/`
directory — it does **not** have to be a git repo or the folder you are
working in. Resolve it in this order and stop at the first hit:

1. `.mocks/project.yaml` in the working directory (or the repo root above
   it). This is the usual case when mocking the app you are developing.
2. The path saved in `~/.mocker/agent.json`
   (`{ "projectPath": "/abs/path/to/.mocks" }`) — check the directory still
   exists.
3. Ask the user: *"which folder did you connect in the mocker extension?
   (absolute path)"*. Chrome's File System Access API only gives the
   extension the folder **name**, never its path, so the extension cannot
   tell you and there is nothing to look up — asking is the only way.
   **Never scan the disk hunting for `.mocks/` folders.** Save the answer to
   `~/.mocker/agent.json` (append `.mocks` if the user gave you the parent
   folder) and reuse it from then on.

If the folder has no `project.yaml` yet, either create the layout yourself
(`project.yaml` with a `name`, an empty `scenarios/`, and a `.mocks/.gitignore`
containing `.runtime/`) or tell the user to click **New project** in the
extension settings and pick that folder — both produce the same result.

Before writing mocks, check the setup once: the extension must be installed
and the folder connected (green pill in the popup or the settings header). If
`.runtime/requests.json` is missing, the folder was never connected — say so
instead of guessing.

## File formats

```
.mocks/
├── project.yaml            # name + environments (optional)
└── scenarios/
    └── <id>.yaml           # one file = one scenario
```

`project.yaml`:

```yaml
name: my-app
order:                # optional: scenario order in the UI
  - empty-list
environments:         # optional: {{x}} variables for urls
  local:
    api: ''           # empty = the url stays a bare pathname
  staging:
    api: https://api.staging.example.com
```

Scenario (`scenarios/<id>.yaml`) — the file name is the id, kebab-case, and
is never renamed:

```yaml
name: Save error                # required
description: The POST fails     # optional
archived: true                  # optional: hides and deactivates it
mocks:
  - name: Broken save           # optional
    method: POST                # GET/POST/PUT/PATCH/DELETE/HEAD
    url: /api/items/            # see matching
    status: 500                 # required
    delay: 400                  # optional, ms
    headers:                    # optional
      x-custom: value
    response:                   # body: YAML/JSON or plain text
      errors:
        - internal error
```

Bodies use the API's raw shape (e.g. snake_case if the API responds
snake_case) — mocker transforms nothing.

## URL matching

Do not write the host unless you need it. A mock matches by full url,
`origin+pathname` or `pathname`, ignoring trailing slashes and the query
string:

- `/api/items/` matches `https://any-host/api/items/?page=2`
- `api/items` (no leading slash) matches as a pathname fragment
- `*` is a wildcard: `/api/items/*/photos/`
- `{{variable}}` resolves with the active environment — its strong case is
  separating two hosts that share a pathname; then use a full url with a
  host variable

## Workflow

1. Write or edit the scenario YAML. The extension picks up changes every
   ~30s, or instantly when the user opens the popup or the settings page —
   tell them "open the mocker popup" to force a sync.
2. **Activation is browser state, not yours**: ask the user to turn the
   scenario on with its switch in the popup. When two active scenarios mock
   the same url, the last activated one wins.
3. Ask the user to use the app (or reload the tab), then verify in the
   runtime log.

## WebSocket pushes

`.mocks/websockets.yaml` holds saved server pushes the user can fire from the
popup (WebSockets view). You can write them like any other file:

```yaml
messages:
  - name: New task push
    url: centrifugo          # optional socket url filter
    channel: tasks:123       # optional; empty = raw frame
    data:
      count: 2
```

With a channel, the frame ships in the Centrifugo v2 push envelope; sending
is always a user click (the page must have a live, subscribed connection).

Presence events (`join`/`leave`) use a different envelope than publications,
so simulate them as raw frames: omit `channel` and put the full push envelope
in `data`:

```yaml
  - name: User joins (presence)
    data:
      push:
        channel: presence:demo
        join:
          info:
            user: '42'
            client: demo-client
            conn_info:
              name: Jane Doe
```

## Verification: .mocks/.runtime/requests.json

Last 200 requests from tabs with mocking enabled:

```json
{
  "updatedAt": "2026-09-02T12:00:00.000Z",
  "requests": [
    {
      "at": 1788350000000,
      "origin": "https://localhost:3000",
      "method": "POST",
      "url": "https://localhost:3000/api/items/",
      "requestBody": "{\"name\":\"x\"}",
      "status": 500,
      "body": "{\"errors\":[...]}",
      "mocked": true,
      "scenario": "save-error",
      "mockName": "Broken save",
      "mockUrl": "/api/items/"
    }
  ]
}
```

- `mocked: true` + `scenario`/`mockUrl` → your mock matched.
- No `mocked` → real traffic that passed through: if you expected a match,
  review method/url; if not, its real `body` is material for building the
  mock.
- The file only updates while the user browses with the extension connected;
  a stale `updatedAt` means no new traffic, not a failure.
- Both logs are purged at the start of each browser session — everything in
  them belongs to the current session.

## Verification: .mocks/.runtime/websockets.json

Last 200 WebSocket frames from tabs with mocking enabled, both directions:

```json
{
  "updatedAt": "2026-09-02T12:00:00.000Z",
  "frames": [
    {
      "at": 1788350000000,
      "origin": "https://localhost:3000",
      "url": "wss://push.example.com/connection/websocket",
      "direction": "in",
      "data": "{\"push\":{\"channel\":\"tasks:123\",\"pub\":{\"data\":{\"count\":2}}}}"
    }
  ]
}
```

- `direction: "in"` = received from the server (raw material for saved
  messages in `websockets.yaml`); `"out"` = sent by the page (subscribe
  commands here reveal the channel names the app listens to).
- Frames injected by mocker itself are not captured.

## Setup, when something is missing

- **The extension is not installed**: it is loaded unpacked from the repo —
  `git clone` the repo, `npm install && npm run build`, then
  `chrome://extensions` → developer mode → **Load unpacked** →
  `extension/dist/`. Then Settings → **New project** (any folder) or
  **Import project** (an existing `.mocks/`).
- **This skill is not installed** (the user is reading it from a clone):
  the install is two commands the **user** types in an interactive Claude
  Code terminal — you have no tool for them, and copying `SKILL.md` into
  `~/.claude/skills/` by hand is not the install path:

  ```
  /plugin marketplace add arturosdg/mocker
  /plugin install mocker@mocker
  ```

- **The folder is connected but the log is empty**: Chrome expires the folder
  permission every browser session — the popup shows an amber pill and one
  click reconnects. Connecting mid-session dumps the traffic already captured
  into the log, so there is nothing to re-navigate.

## Common mistakes

- Mock not matching: wrong method, host typo (prefer bare pathnames), or a
  `{{variable}}` missing from the active environment (the UI flags it red).
- Scenario exists but does not intercept: its switch is off, it is archived
  (`archived: true`), or the domain is disabled (popup toggle / gray icon).
- Do not edit activation or touch `chrome.storage`: it is not yours.
