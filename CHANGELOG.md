# Changelog

## [1.1.2](https://github.com/arturosdg/mocker/compare/v1.1.1...v1.1.2) (2026-09-08)


### Bug Fixes

* make the Request passthrough fix visible to release-please ([#46](https://github.com/arturosdg/mocker/issues/46)) ([824ad9b](https://github.com/arturosdg/mocker/commit/824ad9b5d62da2019d3fc444748a93a7b93598ed))

## [1.1.1](https://github.com/arturosdg/mocker/compare/v1.1.0...v1.1.1) (2026-09-02)


### Bug Fixes

* transparent corners in extension icons ([#42](https://github.com/arturosdg/mocker/issues/42)) ([f8cab3a](https://github.com/arturosdg/mocker/commit/f8cab3a46c43a5c9f64c9a2c0c359106d23351ee))

## [1.1.0](https://github.com/arturosdg/mocker/compare/v1.0.0...v1.1.0) (2026-09-02)


### Features

* example presence join/leave messages as raw frames ([#38](https://github.com/arturosdg/mocker/issues/38)) ([5342138](https://github.com/arturosdg/mocker/commit/53421385f579f866aa4c19f9c70f285e888bd74d))
* example saved WebSocket messages ([#36](https://github.com/arturosdg/mocker/issues/36)) ([035f9fd](https://github.com/arturosdg/mocker/commit/035f9fdd01a538db017cde7d3b3f4d88ba3147b4))
* popup Mocks/WebSockets modes, WS frame capture and per-session runtime log purge ([#40](https://github.com/arturosdg/mocker/issues/40)) ([9c46730](https://github.com/arturosdg/mocker/commit/9c46730079d550190e34f904d1b49356ed89f1bb))
* popup saved WS messages list channel + body with launch button ([#37](https://github.com/arturosdg/mocker/issues/37)) ([4f239ab](https://github.com/arturosdg/mocker/commit/4f239abb64d4df3f8135a0655973d0213e57a0f3))
* popup WS view is saved messages only, raw frames titled by name ([#39](https://github.com/arturosdg/mocker/issues/39)) ([8e8ac34](https://github.com/arturosdg/mocker/commit/8e8ac344a976a700f6bf1f82f7f93318001e7e4b))
* saved WebSocket messages, settings tab and requests/websockets segments ([#35](https://github.com/arturosdg/mocker/issues/35)) ([f3ecea3](https://github.com/arturosdg/mocker/commit/f3ecea3f16a854b2fe12e7b7e90fe55fcd0b8dcb))
* WebSocket push injection with Centrifugo envelope ([#33](https://github.com/arturosdg/mocker/issues/33)) ([cce0064](https://github.com/arturosdg/mocker/commit/cce0064ded2a7a165526424c7f758ef1ffef41af))


### Bug Fixes

* untrack example runtime log and gitignore .runtime ([#41](https://github.com/arturosdg/mocker/issues/41)) ([5ec7f71](https://github.com/arturosdg/mocker/commit/5ec7f71bd451c4a901c9708377ad060098b5e06c))

## [1.0.0](https://github.com/arturosdg/mocker/compare/v0.1.0...v1.0.0) (2026-09-02)


### ⚠ BREAKING CHANGES

* replace the CLI transport with direct File System Access ([#13](https://github.com/arturosdg/mocker/issues/13))

### Features

* activation toggles in settings, mock names, and UI polish ([#6](https://github.com/arturosdg/mocker/issues/6)) ([5573fe0](https://github.com/arturosdg/mocker/commit/5573fe0bdc5eb29fed4bd7d735586642ae5b8ed2))
* added captures turn into a jump-to-mock arrow, clearer write timeout ([#11](https://github.com/arturosdg/mocker/issues/11)) ([7d18e46](https://github.com/arturosdg/mocker/commit/7d18e463a9415243a9aebc9706aeaf06a029bc0c))
* agent runtime log, reorder, archive, per-origin toggle; drop daemon ([#20](https://github.com/arturosdg/mocker/issues/20)) ([24c0644](https://github.com/arturosdg/mocker/commit/24c0644a9bb82143e0fa9714b0839941085935ad))
* animated drag reorder — dragged item collapses to a summary row ([#22](https://github.com/arturosdg/mocker/issues/22)) ([aefa38e](https://github.com/arturosdg/mocker/commit/aefa38e76641d4f0e8d497247673e95b25ee928a))
* automated releases with release-please and Chrome/Firefox builds ([#31](https://github.com/arturosdg/mocker/issues/31)) ([6026323](https://github.com/arturosdg/mocker/commit/60263236ec3e96e84a133435098403a00757918f))
* connection status becomes a colored pill ([#27](https://github.com/arturosdg/mocker/issues/27)) ([f70b176](https://github.com/arturosdg/mocker/commit/f70b1768f8729c876e7089065762aba3b21ca2f1))
* dark dev-tool identity — amber brand, interceptor icon, dark popup ([#2](https://github.com/arturosdg/mocker/issues/2)) ([85788d3](https://github.com/arturosdg/mocker/commit/85788d3f73511e69e7285a1fbc12f134e264d5b8))
* docs tab in settings with the .mocks file format ([#18](https://github.com/arturosdg/mocker/issues/18)) ([3bdf51f](https://github.com/arturosdg/mocker/commit/3bdf51f9aa489efbde35d629e63a91758d6ca976))
* drag-and-drop reorder via handles, scrub check ([#21](https://github.com/arturosdg/mocker/issues/21)) ([961b529](https://github.com/arturosdg/mocker/commit/961b52928f8bbc2124343bc03e677cf81494254e))
* e2e battery covering every feature (npm run e2e), fix wildcard match ([#28](https://github.com/arturosdg/mocker/issues/28)) ([9735418](https://github.com/arturosdg/mocker/commit/97354187b8430480b7d59b76a31cc403a6ddb7e5))
* environment selector back in the popup, synced with settings ([#19](https://github.com/arturosdg/mocker/issues/19)) ([89fde87](https://github.com/arturosdg/mocker/commit/89fde870562ab72b2412ce9ad352774b872bbc42))
* global kill switch, per-mock toggles and settings button in popup ([#4](https://github.com/arturosdg/mocker/issues/4)) ([4a65406](https://github.com/arturosdg/mocker/commit/4a654065e3799d434f7ba1b7d4e9d9f2b7d8a363))
* log mocked requests in the page console, tweak-style ([#1](https://github.com/arturosdg/mocker/issues/1)) ([aee1e5e](https://github.com/arturosdg/mocker/commit/aee1e5ea185b5b12f5a05209f025e7dab6a97a4c))
* network panel, always-on interception, env-var validation and UI clarity ([#8](https://github.com/arturosdg/mocker/issues/8)) ([0d10931](https://github.com/arturosdg/mocker/commit/0d10931280f9781b84e87c86a756b8e9c0fe4f89))
* per-tab network captures in the popup ([#9](https://github.com/arturosdg/mocker/issues/9)) ([04dfdf9](https://github.com/arturosdg/mocker/commit/04dfdf9391fba3f131df4182b136013f90d0773a))
* project editor in settings, fuzzy url matching, generic example ([#7](https://github.com/arturosdg/mocker/issues/7)) ([bb09b77](https://github.com/arturosdg/mocker/commit/bb09b771433824ea1b40bdb0865686aa4416582e))
* read-mode mock rows always show endpoint, method and status ([#17](https://github.com/arturosdg/mocker/issues/17)) ([3aaf44c](https://github.com/arturosdg/mocker/commit/3aaf44cc90ab9aebf16ef9b4c5c94427fef3958a))
* read/edit mode per scenario, collapsible project, devtools panel ([#16](https://github.com/arturosdg/mocker/issues/16)) ([45ae666](https://github.com/arturosdg/mocker/commit/45ae666a4722420aae71c608d4e091645b7e9ce0))
* replace the CLI transport with direct File System Access ([#13](https://github.com/arturosdg/mocker/issues/13)) ([943ea6c](https://github.com/arturosdg/mocker/commit/943ea6c3e811d3515cc5464672fb11ad5b9adc90))
* richer agent request log and README screenshots ([#23](https://github.com/arturosdg/mocker/issues/23)) ([dd0e307](https://github.com/arturosdg/mocker/commit/dd0e3074804b2b04016787d2ac3e5456e51fa70f))
* save confirmation snackbar, dirty-gated save buttons, remove confirms ([#14](https://github.com/arturosdg/mocker/issues/14)) ([63e47f2](https://github.com/arturosdg/mocker/commit/63e47f2edff0def1a5851ef065d12ffbf6cee9c1))
* settings page with manual scenario management via daemon write API ([#3](https://github.com/arturosdg/mocker/issues/3)) ([c0db2c8](https://github.com/arturosdg/mocker/commit/c0db2c8af77aa23a267faab9ee8396462977140f))
* ship the mocker agent skill as a Claude Code plugin ([#25](https://github.com/arturosdg/mocker/issues/25)) ([ef385a3](https://github.com/arturosdg/mocker/commit/ef385a30b0aeb9cc3ed1da435ecd4418c6a01707))
* single per-domain toggle and state-aware action icon ([#24](https://github.com/arturosdg/mocker/issues/24)) ([7df0176](https://github.com/arturosdg/mocker/commit/7df01763646497970b91cf516ff503d7b52803c6))
* translate the whole product to English, refreshed roadmap ([#30](https://github.com/arturosdg/mocker/issues/30)) ([c646361](https://github.com/arturosdg/mocker/commit/c646361d86b8b65e757aab2f442679c0dd672225))
* url validation banner, green only on focus ([#15](https://github.com/arturosdg/mocker/issues/15)) ([6c1515c](https://github.com/arturosdg/mocker/commit/6c1515c54bfdecc87cc9676266bdc6a61d6f8673))
* walking skeleton — daemon ws + extension MV3 with scenario toggles ([2e0e43d](https://github.com/arturosdg/mocker/commit/2e0e43ddfd0a8427f5169b17c9574c0eda41c27b))
* wider popup, collapsible per-tab network with add-to-scenario ([#10](https://github.com/arturosdg/mocker/issues/10)) ([76c31ee](https://github.com/arturosdg/mocker/commit/76c31eed5bf561f70ba92841bf4047e0b36e9e62))


### Bug Fixes

* keep the local test scenario out of the repo ([#29](https://github.com/arturosdg/mocker/issues/29)) ([72c7ccb](https://github.com/arturosdg/mocker/commit/72c7ccb7c60eb4103e2eb1e43636c0ecc8066aa2))
* make each scenario read as a list of mocks in the settings page ([#5](https://github.com/arturosdg/mocker/issues/5)) ([430fb7f](https://github.com/arturosdg/mocker/commit/430fb7f94f4fa1fa9fa0f246909fb8d2b6c374eb))
* popup header — ellipsized domain with tooltip, actionable sync icon ([#26](https://github.com/arturosdg/mocker/issues/26)) ([af4538c](https://github.com/arturosdg/mocker/commit/af4538c9914da42c5734ab93858370bffe7a6b0d))
* survive extension reloads in orphaned content scripts, reconnect on open ([#12](https://github.com/arturosdg/mocker/issues/12)) ([e2647b6](https://github.com/arturosdg/mocker/commit/e2647b6509bfc33b35fc667cb60dbf1935369e57))
