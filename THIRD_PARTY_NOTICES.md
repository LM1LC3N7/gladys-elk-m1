# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below. The ported parts
were rewritten, not copied; the changes are described below.

## elkm1-lib

<https://github.com/gwww/elkm1> (package `elkm1-lib`, version 2.2.15 of
2026-05-05, commit b448a84 of the clone), by Glenn Waters (gwww) and its
contributors, the library of the Home Assistant ELK M1 integration. It
implements the ASCII protocol published by ELK Products for the M1 panels.

MIT License (`LICENCE` file of the repository), reproduced below exactly as
published:

```
MIT License

Copyright (c) 2018 Glenn Waters

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported from `elkm1_lib/`:

- `message.py`, in `src/elk/frame.js`: the line layout (length, code, data,
  00, checksum), the checksum, the check of the length and of the checksum.
- `message.py`, `const.py`, `panel.py`, in `src/elk/protocol.js`: the
  requests `as`, `az`, `zs`, `zp`, `cs`, `ss`, `vn`, `lw`, `sd`, `tr`, the
  arming command `a<level>` with the user code on 6 digits, the output
  commands `cn` and `cf`; the decoders of AS, AZ, ZS, ZC, ZP, CS, CC, SS,
  VN, LW, ST, TR, IC, RP, SD; the values of the armed status, arm-up state,
  alarm state, zone logical and physical status, thermostat mode; the
  positions of the system troubles; the base-1 numbering of the panel.
- `connection.py`, `elk.py`, `util.py`, `elements.py`, `areas.py`, in
  `src/elk/client.js` and `src/app.js`: the plain and secure ports (2101,
  2601), the TLS versions and legacy ciphers of the M1XEP, the user name and
  password sent as two raw lines and the login answers, one request at a time
  waiting for the message code it expects (5 s), the 120 s heartbeat
  watchdog, the reading of the alarms by zone after an alarm, the reading of
  the names by `sd` (the next unit with a description), the pause of the
  commands while ElkRP is connected.

The tests (`test/protocol.test.js`) use vectors of elkm1-lib's own tests
(`test/`, same repository and licence).

Changed: TCP and TLS only (no serial port); the certificate of the M1XEP
pinned by its SHA-256 fingerprint (learned at first use, another one stops
the connection before anything is written, until the user vouches for it);
a refused login stops for good, never tried again by itself; the lines
bounded and cut in one linear pass, every report checked before use (length,
characters); an arm written at once, never behind another request; a
disarm or an output command decided on the state read just before it, never
written after its deadline, its option read again right before the write;
a command confirmed only by a report received after its write; a user code
reported invalid (IC) right after a command never sent again by itself;
reconnection with growing waits (10 s to 5 min), kept across restarts; a
flood or too many malformed lines cut the link; the thermostats read only;
no lights, tasks, counters, settings, keypads, users or zone bypass.
