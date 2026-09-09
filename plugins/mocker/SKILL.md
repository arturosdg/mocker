---
name: mocker
description: >-
  Mock API responses in the browser through the mocker Chrome extension by
  editing YAML files in the repo's .mocks/ directory and verifying matches via
  .mocks/.runtime/requests.json. Use when the user asks to mock the network,
  fake or intercept HTTP calls, return a fixed response for an endpoint,
  simulate a backend error (500, 401, timeout/delay), create or edit mock
  scenarios, or check which requests were intercepted. Keywords: mocker, mock,
  mockear la red, escenario de mocks, interceptar llamadas.
---

# mocker — file-driven network mocks

mocker is a Chrome extension that intercepts `fetch`/XHR and serves responses
defined in YAML inside the app's repo. Your interface as an agent is
**files**: you write scenarios under `.mocks/` and read the request log at
`.mocks/.runtime/requests.json`. There is no CLI and no server.

## Locate the project

Look for a `.mocks/` directory with `project.yaml` at the repo root. If it
does not exist, create it (and suggest adding `.mocks/.runtime/` to the
`.gitignore`). The user must have the extension installed and the project
imported (Settings → Import project); if the runtime log never updates, ask
them to check the green status pill in the popup.

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

## Common mistakes

- Mock not matching: wrong method, host typo (prefer bare pathnames), or a
  `{{variable}}` missing from the active environment (the UI flags it red).
- Scenario exists but does not intercept: its switch is off, it is archived
  (`archived: true`), or the domain is disabled (popup toggle / gray icon).
- Do not edit activation or touch `chrome.storage`: it is not yours.
