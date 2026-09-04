# <img src="extension/icons/icon-48.png" alt="" width="28" align="top" /> Mocker

Scenario-based network mocking driven by files in your repo. Mock scenarios
live as YAML in `.mocks/` inside your app's repo (versioned with your
branches, shared through git); the Chrome extension reads and writes that
folder directly via File System Access — no external processes.

```
.mocks/ (in your app's repo)  ←fs→  extension (Chrome MV3)
```

Interception works on any page — no hosts to declare. The **Mocking** toggle
in the popup turns a specific domain (domain+port) off, and the extension
icon turns gray on tabs whose domain is off.

## Screenshots

The popup: per-scenario and per-mock toggles, the per-domain switch, and the
tab's traffic with mocked requests badged:

<img src="docs/popup.png" alt="mocker popup" width="400" />

The settings page, with scenarios in read mode:

<img src="docs/settings.png" alt="mocker settings" width="700" />

And the scenario editor (variable validation, drag to reorder):

<img src="docs/editor.png" alt="scenario editor" width="700" />

## Mock project layout

```
your-app/
└── .mocks/
    ├── project.yaml            # name + environments
    └── scenarios/
        └── empty-list.yaml     # one file = one scenario with its mocks
```

```yaml
# project.yaml
name: my-app
environments:
  local:
    api: https://api.staging.example
```

```yaml
# scenarios/empty-list.yaml
name: Empty list
mocks:
  - method: GET
    url: '{{api}}/api/items/'
    status: 200
    response: []
```

`{{variables}}` resolve with the active environment (picked in the popup or
the settings project card) and exist so hosts are never repeated per mock:
one mock, N environments. An empty value leaves the url as a bare pathname.
With fuzzy matching you will rarely need them — their strong case is
separating two hosts that share a pathname.

## URL matching

No need to write the host. A mock url matches against the full url,
`origin + pathname` or `pathname`, ignoring trailing slashes and the query
string:

- `/api/items/` matches `https://any-host/api/items/?page=2`
- `api/items` (no leading slash) matches as a fragment: any pathname
  containing it
- `*` is a wildcard: `/api/items/*/photos/` matches any id in between

## Usage

```bash
npm install
npm run build
```

1. Load the extension in Chrome: `chrome://extensions` → developer mode →
   "Load unpacked" → `extension/dist/`.
2. Open the settings page and click **Import project**: choose your repo's
   `.mocks/` folder (or the repo containing it). That loads the project and
   all its scenarios.
3. Open the popup and turn scenarios on with their switches.

Chrome expires the folder permission on every new browser session: the
extension detects it and the status pill shows an amber warning — one click
reconnects. Changes made outside (a `git pull`, an agent editing the YAML)
are picked up automatically every 30s and whenever the popup or the settings
page opens.

## For agents

This repo is also a **Claude Code plugin** with the `mocker` skill, which
teaches an agent the whole workflow (file formats, matching, verification).
Two-command install, inside Claude Code:

```
/plugin marketplace add arturosdg/mocker
/plugin install mocker@mocker
```

(Works with the private repo as long as you have git access.) From then on
the agent activates the skill whenever you ask it to mock the network, or
manually with `/mocker`.

An agent works on the same files: it edits the `.mocks/` YAML with its normal
tools and the extension picks the changes up on its own. To close the loop
without a browser, mocker dumps the last 50 captured requests to
`.mocks/.runtime/requests.json` (`{ updatedAt, requests: [...] }`); each
entry carries the call made (method, url, `requestBody`), the response
received (`status`, `body`, both capped at 32KB) and, when mocker intercepted
it, `mocked: true` plus the `scenario`, `mockName` and `mockUrl` that
matched. Entries without `mocked` are real traffic that passed through — raw
material for new mocks. WebSocket frames get the same treatment in
`.mocks/.runtime/websockets.json` (`{ updatedAt, frames: [...] }`), captured
in both directions (`direction: "in" | "out"`) — outgoing subscribe commands
reveal the channels the app listens to, incoming pushes are raw material for
saved messages. Both logs are purged at the start of each browser session.
Add `.mocks/.runtime/` to the repo's `.gitignore`.

## WebSocket pushes (Centrifugo-friendly)

The popup toggles between **Mocks** and **WebSockets** mode. In WebSockets
mode the main list shows the messages saved in `.mocks/websockets.yaml`
(edited from the settings WebSockets tab, shared through git): channel on
top, body below, and a launch button that injects the message as if the
server had pushed it. With a channel, the frame ships in the Centrifugo v2
envelope (`{"push":{"channel":…,"pub":{"data":…}}}`), so a centrifuge client
delivers it to that channel's subscription; without one, the data goes as a
raw frame — useful for any WebSocket app. Injection rides the page's real
connection: the client must be connected (and subscribed, for channels).
The network section below lists the tab's active websockets and its captured
frames — each frame has a + button that saves it as a configured message
(un-wrapping the Centrifugo envelope back into channel + data).

## Mocked requests show in the Console

Every matched request logs to the page console with the original url intact:

```
mocker 16:34:56 GET https://localhost:3000/api/items/ 200 (empty-list)
```

The status is green (2xx/3xx) or red (4xx/5xx), with the serving scenario in
parentheses. Mocked requests do not show in the Network tab (the response is
synthetic and never leaves the page) — the Console and the amber counters in
the popup are the signals that a mock is working.

## Settings page

The popup button (or `chrome://extensions` → Mocker → Options) opens the
settings page in a full tab. Scenarios render in **read mode** (name,
description and compact mock rows with live activation toggles); **Edit**
opens the full form (name, description, mocks with optional name,
method/url/status/delay/response), with Cancel to leave without saving,
create, duplicate, **archive** (archived scenarios leave the lists and stop
intercepting; they live collapsed in the Archived section), **drag to
reorder** (scenario cards in read mode; mocks by their ⠿ handle in edit
mode; scenario order persists in `project.yaml: order`) and delete. The
project card is collapsible too. Activation toggles (scenario and mock) apply
instantly, without saving; the per-domain Mocking toggle lives in the popup.
Renaming = editing the Name field and saving; the file keeps its id so
activation is never lost. The project card edits `project.yaml`: name and the
environments with their variables (collapsible section). Mock urls with
`{{variables}}` validate live: green border while focused when the variable
exists in every environment, amber when it is missing in some, red when it
exists in none, with details in the tooltip and a summary banner on top.

## DevTools panel

Besides the popup, mocker adds a **mocker** panel to Chrome DevTools with the
same information, bound to the inspected tab: scenarios with their toggles
and the network section with its captures and the add button. Use whichever
is more comfortable — they are the same view.

Saving writes the YAML into the repo (you will see the diff in `git status`)
— nothing has storage of its own: everything lives in the files. If the files
change while you are editing, a banner asks you to save or reload instead of
clobbering your edit.

## Tests

`npm run e2e` builds the extension and runs the end-to-end battery (50
checks) against a real Chromium: import and connection states, matching
(pathname, query, fragment, wildcard, variables), fetch/XHR interception with
delay and precedence, scenario/mock/domain toggles, captures and
add-as-mock, the runtime log, editing/CRUD/validation/archiving, drag
reorder, docs and the panel. Set `MOCKER_CHROME` to point at a specific
binary; by default it uses the Playwright-cache Chromium or the system
Chrome.

`npm run screenshots` regenerates the images above (`docs/*.png`) from the
same harness, using a small demo project.

## Releases

Versioning is automated with [release-please](https://github.com/googleapis/release-please):
conventional commits on `main` feed a release PR; merging it tags a version,
publishes a GitHub Release and attaches two zips built by CI —
`mocker-chrome-vX.Y.Z.zip` and `mocker-firefox-vX.Y.Z.zip`. CI also runs
typecheck, both builds and the e2e battery on every PR.

**Firefox caveat**: the Firefox build ships an MV3 event-page manifest
(`background.scripts`, gecko id, FF 128+ for MAIN-world content scripts) and
the interceptor/popup work, but Firefox does not implement the File System
Access API, so importing a project is not possible there yet — the build is
experimental until an alternative import path lands.

## Roadmap

- [x] Automated extension releases (release-please + CI zips for Chrome and
      Firefox).
- [ ] Firefox project import (no File System Access API there — needs an
      alternative such as one-shot directory upload).
- [ ] Chrome Web Store upload from CI.
- [ ] Stable per-mock ids: mock activation is tracked by index today, so
      toggled-off mocks can shift when a scenario is reordered.
- [ ] Query-string matching (deliberately ignored today).
- [ ] Multi-project support (one imported folder at a time).
- [ ] Settings reflecting external activation changes live (today they show
      on the next render to protect in-progress edits).
- [ ] Team onboarding: packaged install without cloning/building.
