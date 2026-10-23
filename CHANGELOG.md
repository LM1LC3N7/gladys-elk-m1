# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- An arm waiting for a disarm of its area to apply no longer delays the
  arms of the other areas (review 2).

## [0.1.1] - 2026-10-23

### Added

- Local connection to ELK M1 Gold and M1 EZ8 panels through the M1XEP
  Ethernet module: secure port (TLS 1.2 or 1.0, user name and password) or
  non-secure port, with the ASCII protocol of elkm1-lib 2.2.15 (framing,
  checksum, requests, reports, heartbeat watchdog).
- The panel (link, trouble, AC failure, panel battery low, troubles), the
  areas (state, armed, ready, alarm, fire alarm, arm away / stay / night and
  disarm push buttons), the zones (open or motion, trouble, bypassed, alarm,
  or temperature), the outputs (state, turn on / off push buttons) and the
  thermostats (read only), with the names set in the panel.
- Scene triggers `alarm_triggered` (area, zone, kind, fire), `armed`,
  `disarmed`; scene actions `arm` and `disarm`; "Test the connection",
  "Allow a new try of the code" and "Trust the new certificate" buttons.
- State and scene event budgets under the Gladys limits.
- French and English names, messages and guides; a cover generated in plain
  Node (`npm run cover`).

### Security

- Arming always allowed (it protects), never lowering the protection,
  written at once (never queued behind another request), withdrawing the
  disarms of its area still waiting, never blocked by an unreadable state
  nor by the waits between connection attempts (one attempt at once).
- Disarming and the outputs off by default, each behind its own option, read
  when asked, again after the fresh read, and once more right before the
  write; decided on the state read from the panel just before; one at a
  time; written within 3.5 s or not at all; reported done only when a report
  received after the write shows it, else "sent, without confirmation".
- A user code reported invalid by the panel right after a command stops the
  commands, kept across restarts in `/data` (the date only, never the code);
  lifted by a new code or by "Allow a new try of the code".
- Secure port: the certificate of the M1XEP pinned by its SHA-256
  fingerprint (first use, or typed); another one closes the connection
  before anything is written, stops everything and is shown in the status,
  until its fingerprint is typed or "Trust the new certificate" is pressed
  twice. A refused login stops for good; new credentials or a test click try
  once; only a salted hash of the refused credentials is kept, erased at the
  first login that works.
- Connection attempts spaced (10 s to 5 min) and kept in `/data` (written
  at most once a minute); "Test the connection", Discovery, a Gladys
  reconnection or an unchanged configuration never read the panel nor
  reconnect; a late report of an older session publishes nothing.
- Bounded lines, linear parsing, every report checked; a flood or too many
  malformed lines cut the link; no control byte in the files (test); the
  user code and the password never logged.

### Fixed

- An arm never waits for the confirmation of an earlier arm (another area,
  a double press, a scene arming every area): only for its write, each
  against its own deadline (review 1).
- An arm stay or night asked right after a disarm that has not applied yet
  waits for it, then goes (never lowering the protection), instead of being
  refused.
- A lost "ElkRP disconnected" report no longer blocks the commands after a
  reconnection.
- A new alarm of the same kind after the first one ended is announced, even
  within 30 s.
- ElkRP is checked again right before an output command is written.

### Changed

- The old ciphers and the legacy renegotiation are used for TLS 1.0 only;
  the docs say TLS 1.0 is weaker and list every case where an arm is
  refused.

[Unreleased]: https://github.com/LM1LC3N7/gladys-elk-m1/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-elk-m1/releases/tag/v0.1.1
