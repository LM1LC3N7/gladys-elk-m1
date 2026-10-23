# ELK M1 for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com):
**ELK M1 Gold and M1 EZ8** alarm panels, **locally** through their **M1XEP**
Ethernet module (TLS on port 2601 with a login, or plain TCP on port 2101),
with the ASCII protocol published by ELK as implemented by the open-source
[elkm1-lib](https://github.com/gwww/elkm1) library.

> **Never tested with a real device.** Unofficial, not affiliated with ELK
> Products.

- Panel: link, trouble, AC failure, panel battery low, troubles (text).
- Areas (1 to 8): state (disarmed, arming, entry delay, armed away, stay,
  night, vacation), armed, ready, alarm, fire alarm; arm away / stay / night
  and disarm **buttons**.
- Zones (1 to 208): open (opening, smoke, leak) or motion, trouble, bypassed,
  alarm; temperature for zones 1 to 16.
- Outputs (1 to 208): state, turn on / turn off **buttons**.
- Thermostats (1 to 16), read only: temperature, humidity, setpoints, mode,
  hold.
- Scene triggers: alarm triggered (area, zone, kind), armed, disarmed. Scene
  actions: arm, disarm.
- Safety: arming always allowed (never lowering the protection, never
  queued behind a disarm); **disarming and the outputs off by default**,
  each behind its own option read again right before the write; decisions on
  the state read from the panel just before; a command reported done only
  when a later report shows it; a user code reported invalid is never sent
  again by itself; the M1XEP certificate pinned (another one stops
  everything before the password leaves); a refused login never retried by
  itself; secrets never logged.

User guides: [français](docs/fr.md), [English](docs/en.md).

## Development

```bash
npm install
npm test               # node --test (Node 22 and 24): in-memory panel, real loopback TLS
npm run lint
npm run format:check
npm run audit          # npm audit --omit=dev
npm run cover          # cover.png (800x534), plain Node
npx github:GladysAssistant/integration-store .
```

Layout: `src/elk/` (framing, protocol, TCP/TLS client), `src/app.js`
(devices, states, scene events, commands), `src/devices.js`,
`src/publisher.js` (rate limits), `src/store.js` (`/data`),
`test/helpers/fakeElk.js` (the simulated panel). See `CLAUDE.md` and
`TODO.md`.

## Credits and licence

Apache-2.0 (`LICENSE`). The protocol logic is ported from
[elkm1-lib](https://github.com/gwww/elkm1) 2.2.15 by Glenn Waters and
contributors (MIT): see `THIRD_PARTY_NOTICES.md`.
