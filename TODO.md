# TODO - ELK M1 (M1XEP) v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/fr.md`, `docs/en.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the main
  session posts one recap per wave in /t/10385.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 - core** (2026-10-23): own TCP/TLS client on `node:net`
      and `node:tls` ported from elkm1-lib 2.2.15 (framing, checksum,
      requests, decoders, login of the secure port, heartbeat watchdog);
      panel / area / zone / output / thermostat devices with the panel's
      names; read-only states and push buttons; arming always allowed,
      disarming and outputs opt-in (two options); fresh read before a disarm
      or an output command, confirmation by a later report; certificate
      pinning; refused code, refused login, other certificate and connection
      attempts persisted in `/data`; scene triggers `alarm_triggered`,
      `armed`, `disarmed`; scene actions `arm`, `disarm`; "Test the
      connection", "Allow a new try of the code", "Trust the new
      certificate"; fr/en. Tested against an in-memory panel and a real
      loopback TLS server only (framing checked against elkm1-lib's vectors).
- [x] **Review 1 fixes** (2026-10-23, xhigh review of f7b341d: 1 blocking,
      2 important, 4 minor): see "Decisions after review 1" below; the
      hostile scenarios of the review are kept in `test/review1.test.js`.
- [ ] **Milestone 2 - real panel**: run against a real M1 with an M1XEP
      (TLS 1.2, TLS 1.0, non-secure); capture real lines (anonymised, never a
      code) as fixtures; fix what differs (see below).
- [ ] **Milestone 3 - more**: thermostat setpoints and mode behind an
      `allow_thermostats` option (bounded setpoints, "off" protective, never
      a switch), zone bypass behind its own option, tasks (`tn`) as buttons
      behind an option, alarm memory (AM), the event log (LD), lights.
- [ ] **Milestone 4 - first release**: Docker image check, Release workflow,
      topic, GHCR package public.

## Decisions after review 1

- **B1**: the arms go one after the other up to their write only; the next
  one never waits for the confirmation of the previous one (another area, a
  double press, a scene arming every area); each is checked against its own
  deadline; their confirmations run in parallel. An arm whose time ran out
  behind other arms says so ("other commands took all the time"), never
  "the panel answered too slowly".
- **I1**: an arm asked while a disarm of its area was written less than
  4.5 s ago and the area still reads stronger waits for the disarm to apply
  (within its own deadline, until 3.2 s after the request), then goes; if
  the area is still armed stronger at that point, nothing is sent (it stays
  armed, never lowered) and the answer says the state is uncertain.
- **I2**: ElkRP (`RP`) belongs to a session: reset at every connection
  attempt, so a lost `RP 00` never blocks the commands nor the periodic
  reads.
- **M1**: the old ciphers (`@SECLEVEL=0`) and the legacy renegotiation only
  for TLS 1.0; TLS 1.2 keeps Node's defaults (to confirm on a real M1XEP:
  if its TLS 1.2 handshake fails, they may be needed there too). Docs and
  manifest: TLS 1.0 is weaker, only if TLS 1.2 fails.
- **M2**: the docs list every case where an arm is refused.
- **M3**: `alarm_triggered` is held back 30 s only for repeats of one alarm:
  once the area shows no alarm, the next one is announced at once.
- **M4**: ElkRP is checked again right before an output command is written.

## To check on a real panel

- The IC report after an arming command with a wrong code: sent at all on
  the M1XEP port, with user 000 and the code digits as pairs (elkm1-lib's
  decoder), within 6 s? Without it, a wrong code only gives "sent, without
  confirmation" (no stop), and repeated presses may lock the keypads.
- Whether the panel reports AS, ZC, CC, ST by itself on the M1XEP port with
  the default settings (the "transmit" options); the integration also reads
  everything every 5 minutes.
- The login of the secure port: the prompts, "Login successful", the
  refusal texts, and whether the credentials may be sent before the prompts
  (elkm1-lib does so).
- TLS 1.0 with Node 24 (OpenSSL 3, `@SECLEVEL=0`): does the handshake with
  an old M1XEP work?
- A zone bypassed: is its physical status meaningful (EOL closed, open or
  short active), as assumed for its state?
- `sd` for a unit without a description: the next named one (elkm1-lib),
  unit 000 at the end.
- Arming an area armed in another mode: refused by the panel (elkm1-lib
  never sends it), so refused here "disarm it first".
- The IC report of a keypad wrong code with the same digits as ours, within
  6 s of a command: it would stop the commands (cautious side).

## Decisions

- **Own client, no dependency**: no maintained ELK client on npm under a
  usable licence; elkm1-lib (MIT, `LICENCE` file) is ported and credited in
  `THIRD_PARTY_NOTICES.md` (copied into the image with `LICENSE`). Runtime
  dependency: the SDK only.
- **Version 0.1.0, set by hand once**: the template ships 1.0.0; the
  sibling modules start at 0.1.x, so `package.json`, `package-lock.json`, the
  manifest `version` and the `docker_image` tag were set together to 0.1.0 in
  milestone 1, before any release (`test/manifest.test.js` checks they agree,
  never a pinned version). Every later version comes from Actions -> Release
  (the first patch release gives 0.1.1).
- **TCP and TLS only**: the container has no serial device; the M1XEP is
  the supported path (as the Home Assistant integration's `elk://` and
  `elks://`). Default: secure, TLS 1.2 (firmware 2.0.46+); TLS 1.0 for older
  firmwares (the M1XEP negotiates one version only, elkm1-lib `util.py`).
- **Certificate pinning**: the M1XEP's certificate is self-signed. Learned
  at the first connection (no pin typed nor known: trust on first use,
  persisted in `/data` before the password is written), or typed in the
  configuration (it wins). Another one: the socket is closed before
  anything is written, the stop is persisted with the fingerprint met and
  shown in the status; never learned again blindly, a save of the
  configuration lifts nothing. Lifted only by typing that fingerprint or by
  "Trust the new certificate" pressed twice within 60 s (the second press
  pins exactly the fingerprint shown). An arm never wakes a stopped client.
- **Refused login**: final: persisted with a salted SHA-256 of the refused
  user name and password (never a hash of working credentials; erased at the
  first login that works); no automatic new try; new credentials lift it;
  "Test the connection" tries once (at most one per 10 s) and lifts it only
  on success.
- **Identity**: with TLS, the pinned certificate is the identity of the
  M1XEP at every connection (a DHCP swap shows as another certificate). On
  the non-secure port nothing identifies the panel: the docs ask for a
  fixed address.
- **Configured objects only**: areas (default `1`), zones (with their kind),
  outputs and thermostats are listed in the configuration; their names come
  from the panel (`sd`), read once per address after the first connection.
  Ids: `panel:elk`, `area:<n>`, `zone:<n>`, `output:<n>`, `thermostat:<n>`:
  the panel's own numbers; a new address keeps them.
- **States**: the panel reports its changes (AS, ZC, CC, ST); the version,
  arming and zones are read before the session counts as up, then the zone
  areas, troubles, alarms by zone, outputs, temperatures and thermostats;
  everything is read again every 5 minutes. A report never received leaves
  its states unpublished (unknown). Offline, only the link is published.
- **Area state**: armed status (instant variants shown as their plain mode),
  exit timer (arm-up state 3) = arming, entrance delay (alarm state 1) =
  entry delay; alarm kinds from the alarm state (abort delay, entrance delay
  and unsupervised zone trouble are no alarm). Zone in alarm: AZ, read at
  every alarm (as elkm1-lib does), matched with the zone areas (ZP).
- **Zone state**: violated = active, normal = inactive, troubled = unknown
  (and its trouble feature on); bypassed: by its circuit (EOL closed, open
  or short active). Temperature zones (1 to 16): LW and ST, -60 = no sensor.
- **Commands**: buttons (`button`/`push`, value 1 only, strictly), never a
  switch or a binary. Arming: always allowed (protective, as
  gladys-visonic): written at once, never behind another request, withdraws
  the disarms of its area still waiting (app and client queue), reads the
  state when it can (by 1.5 s) but is not blocked by an unreadable one (arm
  away sent; the others only when the last state known protects less),
  never lowers the protection (away 3 > night 2 > stay 1), refused when the
  area is armed in another mode (the panel arms a disarmed area only) or not
  ready to arm; one attempt now when disconnected (`wake()`). Disarming and
  outputs: opt-in, read when asked, after the fresh read and in the
  client's check right before the write; one at a time in the order asked;
  decided on the state read now (unreadable: refused, nothing sent).
- **Deadlines**: read by 2.5 s, written by 3.5 s, confirmed by 4.5 s after
  the request (Gladys waits 5 s). The ack never waits for a publication to
  Gladys (states and events go through the guard chain).
- **Confirmation**: the ELK protocol has no acknowledge: a command is done
  only when an AS (or CC / CS for an output) received after its write shows
  it; otherwise "sent, without confirmation" and a read back at 2 s. A
  disarm without a known outcome makes the next arm of its area never
  "nothing sent" for 4.5 s.
- **Refused code**: an IC report with user 000 carrying the digits of the
  code of a command written less than 6 s before stops the commands,
  persisted (`codeStop`, date only, never the code nor a hash of it: a
  4-digit code is brute-forced from any hash). Lifted by a new code or the
  "Allow a new try of the code" button, never by a restart nor by "Test the
  connection". The IC report is never logged (it holds digits).
- **No reads faster than the interval**: "Test the connection" reports from
  memory (one login try only after a refused login); Discovery publishes from
  the configuration; a Gladys reconnection republishes status, devices,
  states and transports without touching the panel; an unchanged
  configuration does not reconnect. Connection attempts: 10 s to 5 min, the
  last attempt and the failures kept in `/data` (written at most once a
  minute) so a restart waits its turn; a new connection never sooner than
  5 s after the last close.
- **Late events**: every client event is queued with the session it belongs
  to; a new configuration starts a new session and the client's generation
  drops the lines of the old socket.
- **ElkRP connected** (RP 1 or 2): no command (elkm1-lib pauses), no periodic
  read; told in the status.
- **Lines**: bounded (512 characters), one linear pass; every report checked
  (length, characters) before use, malformed ones dropped and counted; 50 in
  a row or 100 in a minute, or 200 lines a second, cut the link; 3 requests
  without an answer cut it (a short read never counts).
- **Thermostats**: read only in this version (temperature, humidity,
  setpoints, mode, hold); setpoint and mode commands wait for milestone 3
  (they control heating: opt-in, bounded).
- **Units**: from the configuration (`temperature_unit`, Fahrenheit by
  default as the panel), fixed at creation; core units only (`fahrenheit`,
  `celsius`, `percent`); values outside the feature bounds are not
  published.
- **Rate limits**: one publisher for the whole integration (240 states per
  minute, 60 kept for the panel and the areas), shared with
  gladys-visonic; one `alarm_triggered` per area and kind per 30 s; never
  undefined nor NaN in an event (null).
- **Cover**: generated by `scripts/cover.mjs` in plain Node (no brand logo).
- **Not checked**: Docker is not installed on this PC, so no image build and
  no end-to-end test in a container; the store validator
  (`npx github:GladysAssistant/integration-store .`) cannot be run from the
  development agent (to be run by the main session, `validate.ps1`); never
  run against a real panel.
