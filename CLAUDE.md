# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It connects to the M1XEP Ethernet module of an ELK M1 alarm panel.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "arm"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/handlers.js                   the SDK handlers, shared with the tests
src/app.js                        ElkApp: lifecycle, model, devices, states, events, commands
src/elk/frame.js                  lines: length, checksum, bounded line reader (elkm1-lib message.py)
src/elk/protocol.js               requests, decoders, values (elkm1-lib message.py, const.py)
src/elk/client.js                 one TCP/TLS connection: pin, login, requests, watchdog
src/devices.js                    model -> Gladys devices and states (pure)
src/publisher.js                  states and scene events under the Gladys rate limits
src/store.js                      /data: code stop, attempts, pins, refused login hash
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js, src/i18n.js     keys, timings, limits; French and English texts
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, the SDK's fake Gladys + test/helpers/fakeElk.js
scripts/cover.mjs                 the cover, plain Node
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

Safety rules of this integration (see TODO.md "Decisions"): arming is always
allowed and protective (written at once, withdraws the disarms of its area,
never lowers the protection); disarming and the outputs are off by default
(two options, read again right before the write); commands are push buttons,
never switches; a disarm or an output command decides on the state read
from the panel just before it, one at a time; a command is done only when a
later report shows it, and one that may have left is never reported "not
sent"; a user code reported invalid is never sent again by itself; the
certificate of the M1XEP is pinned and a new one is never learned blindly; a
refused login is never retried by itself; the user code and the password are
never logged.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (here the numbers of the panel), never a label.
  Gladys keys devices, their history, scenes and dashboards on them: changing
  one creates a new device and orphans the old one. The same goes for every
  key users store: manifest `config_schema`, `actions`, scene keys, feature
  keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords, user codes or the IC report.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand (0.1.0 was set once, see TODO.md). `test/manifest.test.js` checks
  they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. A secret
  field is "kept by Gladys in its database, never shown again", never said
  to be ciphered (`test/manifest.test.js` checks the words).
- **Units** only from `DEVICE_FEATURE_UNITS_BY_CATEGORY` of the core.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the TLS tests use loopback).
