// -----------------------------------------------------------------------------
// One connection with the M1XEP Ethernet module of an ELK M1 panel, ported
// from elkm1-lib 2.2.15 (MIT, see THIRD_PARTY_NOTICES.md), `connection.py`,
// `elk.py` and `util.py`: the plain port (2101) or the secure port (2601,
// TLS 1.2 or 1.0, the legacy ciphers of the M1XEP, then the user name and the
// password sent as two raw lines), one request at a time waiting for the
// message code it expects (5 s), the 120 s heartbeat watchdog (the M1XEP
// sends XK every 30 s).
//
// Changed from elkm1-lib, on purpose:
// - the certificate of the secure port is pinned (its SHA-256 fingerprint):
//   learned at the first connection when none is typed nor known, then
//   required; another one closes the socket before anything is written (the
//   password never leaves) and stops the client for good, until the user
//   vouches for it (src/app.js);
// - a refused login ("Username/Password not found", "Disabled") stops the
//   client for good too: never a new try by itself;
// - a protective request (an arm) never waits behind another request: it is
//   written at once (the ELK protocol has no request id, any later report
//   tells the state); the queued ones (reads, disarms, outputs) keep their
//   deadline and their own check, run right before the write;
// - reconnection with growing waits (10 s to 5 min), never sooner than the
//   last attempt allows (kept in /data by the app); lines bounded and cut in
//   one linear pass; a flood or too many malformed lines cut the link; the
//   user code and the password are never logged (requests are logged by a
//   label, the IC report is never logged).
//
// Events: 'attempt' { at }, 'pin' { fingerprint } (learned at first use),
// 'up' { version }, 'down' { reason, retryIn, wasUp, silent, final, kind,
// fingerprint, failures }, 'message' { code, value } (every decoded report,
// in order, those that answer a request included).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { constants as cryptoConstants } from 'node:crypto';
import { createConnection, isIP } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { LIMITS, TIMINGS } from '../constants.js';
import { LineReader, parseLine } from './frame.js';
import { REQUEST, decode } from './protocol.js';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * kind: `offline` (nothing sent), `late` (not written in time, nothing
 * sent), `withdrawn` (its check failed right before the write, or it was
 * withdrawn from the queue, nothing sent), `busy` (too many requests
 * waiting, nothing sent), `timeout` (sent, no answer), `lost` (the
 * connection ended while it waited). `sent` tells whether the request may
 * have reached the panel.
 */
export class ElkError extends Error {
  constructor(message, kind, { sent = false } = {}) {
    super(message);
    this.kind = kind;
    this.sent = sent;
  }
}

/** The socket of a connection: plain TCP, or TLS with the M1XEP's old versions and ciphers. */
export function defaultConnect({ host, port, tls }) {
  if (!tls) return createConnection({ host, port });
  const version = tls === 'tls10' ? 'TLSv1' : 'TLSv1.2';
  return tlsConnect({
    host,
    port,
    servername: isIP(host) ? undefined : host,
    // The M1XEP has a self-signed certificate: no authority vouches for it.
    // Its fingerprint is checked against the pin before anything is written.
    rejectUnauthorized: false,
    // elkm1-lib util.py: the M1XEP negotiates one version only, with old
    // ciphers and the legacy renegotiation.
    minVersion: version,
    maxVersion: version,
    ciphers: 'DEFAULT:@SECLEVEL=0',
    secureOptions: cryptoConstants.SSL_OP_LEGACY_SERVER_CONNECT,
  });
}

/** Normalizes a SHA-256 fingerprint: upper case, colons. */
export const normalizeFingerprint = (text) => {
  const hex = String(text ?? '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase();
  return hex.length === 64 ? hex.match(/../g).join(':') : undefined;
};

export class ElkClient extends EventEmitter {
  constructor({
    connect = defaultConnect,
    timers = globalThis,
    now = Date.now,
    logger = quiet,
  } = {}) {
    super();
    this.connectFn = connect;
    this.timers = timers;
    this.now = now;
    this.logger = logger;
    this.options = { host: '', port: 0, tls: undefined };
    this.socket = undefined;
    this.generation = 0;
    this.running = false;
    this.ready = false;
    this.failures = 0;
    this.closedAt = undefined;
    this.queue = [];
    this.inflight = undefined;
    /** Written requests waiting for their answer (the in-flight one, the arms). */
    this.waiting = new Set();
    this.reconnectTimer = undefined;
    this.connectTimer = undefined;
    this.loginTimer = undefined;
    this.ticker = undefined;
    this.drops = { count: 0, reasons: {}, loggedAt: undefined };
    this.nextAttemptAt = undefined;
    this.lastWakeAt = undefined;
    this.lastAttemptAt = undefined;
    this.stopped = undefined;
  }

  /** { host, port, tls ('tls12' | 'tls10' | undefined), pin, username, password }. */
  configure(options) {
    this.options = { ...options };
  }

  get connected() {
    return this.ready;
  }

  /** A socket is open (connecting, logging in, reading or up). */
  get busy() {
    return Boolean(this.socket);
  }

  /** Starts; the first connection waits until `notBefore` (kept in /data across restarts). */
  start({ notBefore = 0, failures = 0 } = {}) {
    this.stop();
    this.running = true;
    this.stopped = undefined;
    this.failures = failures;
    this.openSoon(Math.max(0, notBefore - this.now()));
  }

  /** Opens after `wait`, never sooner than sessionGap after the last connection closed. */
  openSoon(wait) {
    const gap = this.closedAt === undefined ? 0 : this.closedAt + TIMINGS.sessionGap - this.now();
    const delay = Math.max(wait, gap, 0);
    this.nextAttemptAt = this.now() + delay;
    if (delay === 0) {
      this.open();
      return;
    }
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.running && !this.socket) this.open();
    }, delay);
  }

  /**
   * A protective command (an arm) while the client waits between two
   * attempts: one attempt now, outside the waits, at most one per
   * sessionGap. Never after a final stop (another certificate, a refused
   * login). Returns whether one was started (never a second socket).
   */
  wake() {
    if (!this.running || this.socket) return false;
    if (this.lastWakeAt !== undefined && this.now() - this.lastWakeAt < TIMINGS.sessionGap) {
      return false;
    }
    this.lastWakeAt = this.now();
    if (this.reconnectTimer) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.open();
    return true;
  }

  stop() {
    this.running = false;
    this.generation += 1;
    if (this.reconnectTimer) this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.nextAttemptAt = undefined;
    this.close();
  }

  /** Ends the socket; every waiting request fails (sent or not, as it was). */
  close() {
    for (const name of ['connectTimer', 'loginTimer']) {
      if (this[name]) this.timers.clearTimeout(this[name]);
      this[name] = undefined;
    }
    if (this.ticker) this.timers.clearInterval(this.ticker);
    this.ticker = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    this.loggingIn = false;
    for (const entry of [...this.waiting]) {
      this.finish(entry);
      entry.reject(new ElkError('The connection to the panel ended', 'lost', { sent: true }));
    }
    this.inflight = undefined;
    for (const entry of this.queue.splice(0)) {
      this.timers.clearTimeout(entry.deadline);
      entry.reject(new ElkError('The connection to the panel ended', socket ? 'lost' : 'offline'));
    }
    if (!socket) return;
    this.closedAt = this.now();
    socket.removeAllListeners();
    socket.on('error', () => undefined);
    socket.destroy();
  }

  // --- Connection -------------------------------------------------------------

  open() {
    const generation = this.generation;
    const { host, port, tls } = this.options;
    this.nextAttemptAt = undefined;
    this.timeouts = 0;
    this.dropRun = 0;
    this.second = { at: this.now(), lines: 0 };
    this.reader = new LineReader({
      onLine: (line) => {
        if (generation === this.generation) this.line(generation, line);
      },
      onDrop: (why) => this.rejected(generation, why),
    });
    this.lastAttemptAt = this.now();
    this.emit('attempt', { at: this.now() });
    this.logger.debug(`Connecting to the M1XEP at ${host}:${port}${tls ? ' (TLS)' : ''}`);
    let socket;
    try {
      socket = this.connectFn({ host, port, tls });
    } catch (err) {
      this.lost(generation, `connection failed: ${err.message}`);
      return;
    }
    this.socket = socket;
    socket.setNoDelay?.(true);
    this.connectTimer = this.timers.setTimeout(
      () => this.lost(generation, 'connection timed out'),
      TIMINGS.connectTimeout,
    );
    socket.on(tls ? 'secureConnect' : 'connect', () => {
      if (generation !== this.generation) return;
      this.timers.clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
      this.lastReceived = this.now();
      if (tls) this.secured(generation, socket);
      else this.run(generation);
    });
    socket.on('data', (chunk) => {
      if (generation !== this.generation) return;
      this.lastReceived = this.now();
      this.reader.push(chunk);
    });
    socket.on('error', (err) => this.lost(generation, err.code ?? err.message));
    socket.on('close', () => this.lost(generation, 'connection closed by the M1XEP'));
  }

  /**
   * The TLS handshake is done: the certificate must be the pinned one before
   * anything is written. None pinned yet: learned now (first use).
   */
  secured(generation, socket) {
    const fingerprint = normalizeFingerprint(socket.getPeerCertificate?.()?.fingerprint256);
    if (!fingerprint) {
      this.lost(generation, 'no certificate from the M1XEP');
      return;
    }
    const pin = normalizeFingerprint(this.options.pin);
    if (pin && pin !== fingerprint) {
      this.logger.warn('ELK: the certificate of the M1XEP is not the pinned one, nothing sent');
      this.lost(generation, 'another certificate', {
        final: true,
        kind: 'certificate',
        fingerprint,
      });
      return;
    }
    if (!pin) {
      this.options.pin = fingerprint;
      this.emit('pin', { fingerprint });
    }
    this.login(generation);
  }

  /** The secure port asks for a user name and a password (elkm1-lib `_connected`). */
  login(generation) {
    const { username, password } = this.options;
    this.loggingIn = true;
    this.loginTimer = this.timers.setTimeout(
      () => this.lost(generation, 'no answer to the login'),
      TIMINGS.loginTimeout,
    );
    // Raw lines, never logged.
    this.write(`${username ?? ''}\r\n${password ?? ''}\r\n`, generation);
  }

  loggedIn(generation) {
    this.loggingIn = false;
    this.timers.clearTimeout(this.loginTimer);
    this.loginTimer = undefined;
    this.run(generation);
  }

  /**
   * The session ended: reconnect later, unless stopped or `final` (another
   * certificate, a refused login: only the user lifts those).
   */
  lost(generation, reason, { silent = false, final = false, kind, fingerprint } = {}) {
    if (generation !== this.generation) return;
    this.generation += 1;
    const wasUp = this.ready;
    this.close();
    if (!this.running) return;
    if (final) {
      this.running = false;
      this.stopped = { kind, fingerprint };
      this.emit('down', { reason, wasUp, final, kind, fingerprint, failures: this.failures });
      return;
    }
    this.failures = wasUp ? 1 : this.failures + 1;
    const retryIn = TIMINGS.backoff[Math.min(this.failures - 1, TIMINGS.backoff.length - 1)];
    this.openSoon(retryIn);
    this.emit('down', { reason, retryIn, wasUp, silent, failures: this.failures });
  }

  /** The version request proves the link; the arming and zone statuses are read before 'up'. */
  async run(generation) {
    try {
      let version;
      try {
        version = await this.request(REQUEST.version(), {
          internal: true,
          label: 'version',
          expect: 'VN',
          timeout: TIMINGS.firstReadTimeout,
        });
      } catch (err) {
        if (err instanceof ElkError && err.kind === 'timeout') {
          this.lost(generation, 'no answer from the panel', { silent: true });
          return;
        }
        throw err;
      }
      await this.request(REQUEST.arming(), { internal: true, label: 'arming', expect: 'AS' });
      await this.request(REQUEST.zones(), { internal: true, label: 'zones', expect: 'ZS' });
      if (generation !== this.generation) return;
      this.ticker = this.timers.setInterval(() => this.tick(generation), 1_000);
      this.ready = true;
      this.failures = 0;
      this.emit('up', { version });
    } catch (err) {
      if (generation !== this.generation) return;
      this.lost(generation, err.message);
    }
  }

  tick(generation) {
    if (generation !== this.generation || !this.socket) return;
    this.logDrops();
    if (this.now() - this.lastReceived > TIMINGS.watchdog) {
      this.logger.warn('ELK: nothing received for too long, reconnecting');
      this.lost(generation, 'no heartbeat from the M1XEP');
    }
  }

  // --- Lines -----------------------------------------------------------------

  /** Too many lines in one second: a flood or a loop, not a panel. */
  flooding(generation) {
    const now = this.now();
    if (now - this.second.at >= 1_000) this.second = { at: now, lines: 0 };
    this.second.lines += 1;
    if (this.second.lines <= LIMITS.maxLinesPerSecond) return false;
    this.logger.warn('ELK: too many lines per second, connection cut');
    this.lost(generation, 'too many lines from the M1XEP');
    return true;
  }

  line(generation, text) {
    if (this.flooding(generation)) return;
    const frame = parseLine(text);
    if (this.loggingIn) {
      // The secure port answers the login in plain text (elkm1-lib decode()).
      if (frame || text.includes('Login successful')) {
        this.loggedIn(generation);
        if (!frame) return;
      } else if (text.startsWith('Username/Password not found') || text.trim() === 'Disabled') {
        this.logger.warn('ELK: the M1XEP refused the user name or the password');
        this.lost(generation, 'login refused', { final: true, kind: 'login' });
        return;
      } else {
        // The prompts ("Username: ", "Password: ") and other text.
        return;
      }
    }
    if (!frame) {
      this.rejected(generation, 'bad length or checksum');
      return;
    }
    const { code, value, known } = decode(frame.code, frame.line);
    if (!known) {
      this.dropRun = 0;
      return;
    }
    if (value === undefined) {
      this.rejected(generation, `malformed ${code}`);
      return;
    }
    this.dropRun = 0;
    this.emit('message', { code, value });
    if (generation !== this.generation) return;
    for (const entry of [...this.waiting]) {
      if (entry.expect !== code || (entry.match && !entry.match(value))) continue;
      this.finish(entry);
      this.timeouts = 0;
      entry.resolve(value);
    }
    this.pump();
  }

  /**
   * A malformed line. The first one of a period is logged, the others
   * counted and summed up once per period; too many in a row, or in a
   * minute, cut the connection.
   */
  rejected(generation, why) {
    if (generation !== this.generation) return;
    const drops = this.drops;
    drops.count += 1;
    drops.reasons[why] = (drops.reasons[why] ?? 0) + 1;
    this.dropRun = (this.dropRun ?? 0) + 1;
    if (drops.loggedAt === undefined) {
      this.logger.warn(`ELK: ${why}, line dropped`);
      drops.loggedAt = this.now();
      drops.count = 0;
      drops.reasons = {};
    } else {
      this.logDrops();
    }
    const now = this.now();
    if (!this.dropWindow || now - this.dropWindow.at >= 60_000) {
      this.dropWindow = { at: now, count: 0 };
    }
    this.dropWindow.count += 1;
    if (this.dropRun >= LIMITS.maxRejects || this.dropWindow.count > LIMITS.maxRejectsPerMinute) {
      this.logDrops(true);
      this.lost(generation, 'too many malformed lines from the M1XEP');
    }
  }

  logDrops(force = false) {
    const drops = this.drops;
    if (drops.count === 0 || drops.loggedAt === undefined) return;
    if (!force && this.now() - drops.loggedAt < TIMINGS.rejectLog) return;
    const reasons = Object.entries(drops.reasons)
      .map(([why, n]) => `${n} ${why}`)
      .join(', ');
    this.logger.warn(`ELK: ${drops.count} line(s) dropped (${reasons})`);
    drops.count = 0;
    drops.reasons = {};
    drops.loggedAt = this.now();
  }

  // --- Requests ---------------------------------------------------------------

  /** Writes text on the socket; false when the session ended. */
  write(text, generation) {
    try {
      this.socket.write(text);
    } catch (err) {
      this.lost(generation, err.message);
      return false;
    }
    if ((this.socket?.writableLength ?? 0) > LIMITS.maxPendingWrite) {
      this.logger.warn('ELK: too much data waiting to be written, connection cut');
      this.lost(generation, 'write buffer full');
      return false;
    }
    return true;
  }

  /**
   * Sends a request line; resolves with the decoded report `expect` (a
   * message code) that `match` accepts, or with 'written' when nothing is
   * expected. `label` replaces the line in the logs (a command holds the
   * user code). `sendBy` (a time): never written after it. `answerBy` (a
   * time): the answer is awaited up to it. `check()`: run right before the
   * write, false withdraws the request (nothing sent). `protective` (an
   * arm): written at once, never behind another request. `kind`: a tag that
   * `withdraw()` can match. `short`: a timeout of it never counts toward
   * dropping the link.
   */
  request(
    line,
    {
      expect,
      match,
      timeout = TIMINGS.requestTimeout,
      label = 'request',
      internal = false,
      sendBy,
      answerBy,
      check,
      onWrite,
      protective = false,
      kind,
      short = false,
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.loggingIn || (!internal && !this.ready)) {
        reject(new ElkError('Not connected to the panel', 'offline'));
        return;
      }
      const entry = {
        line,
        expect,
        match,
        label,
        timeout,
        sendBy,
        answerBy,
        check,
        onWrite,
        kind,
        short,
        protective,
        resolve,
        reject,
        written: false,
      };
      if (sendBy !== undefined && sendBy - this.now() <= 0) {
        reject(new ElkError(`${label} not sent in time`, 'late'));
        return;
      }
      if (protective) {
        this.writeEntry(entry, this.generation);
        return;
      }
      if (this.queue.length >= LIMITS.maxQueued) {
        reject(new ElkError(`${label}: too many requests waiting`, 'busy'));
        return;
      }
      if (sendBy !== undefined) {
        // Withdrawn at its deadline if the line is still busy: never written late.
        entry.deadline = this.timers.setTimeout(() => {
          const at = this.queue.indexOf(entry);
          if (at < 0) return;
          this.queue.splice(at, 1);
          reject(new ElkError(`${label} not sent in time`, 'late'));
        }, sendBy - this.now());
      }
      this.queue.push(entry);
      this.pump();
    });
  }

  /** Withdraws the queued (never the written) requests of a kind; how many. */
  withdraw(kind) {
    let count = 0;
    for (const entry of [...this.queue]) {
      if (entry.kind !== kind) continue;
      this.queue.splice(this.queue.indexOf(entry), 1);
      this.timers.clearTimeout(entry.deadline);
      entry.reject(new ElkError(`${entry.label} withdrawn`, 'withdrawn'));
      count += 1;
    }
    return count;
  }

  /** The next queued request, when none is in flight. */
  pump() {
    while (!this.inflight && this.queue.length > 0 && this.socket) {
      const entry = this.queue.shift();
      this.timers.clearTimeout(entry.deadline);
      if (this.writeEntry(entry, this.generation)) return;
    }
  }

  /** Last checks, then the write; true when it waits for an answer (in flight). */
  writeEntry(entry, generation) {
    if (entry.sendBy !== undefined && this.now() > entry.sendBy) {
      entry.reject(new ElkError(`${entry.label} not sent in time`, 'late'));
      return false;
    }
    // Last look before the socket: a command whose check fails (option off,
    // code changed, deadline passed, withdrawn) is never written.
    if (entry.check && !entry.check()) {
      entry.reject(new ElkError(`${entry.label} withdrawn before the write`, 'withdrawn'));
      return false;
    }
    this.logger.debug(`ELK <- ${entry.label}`);
    entry.written = true;
    try {
      entry.onWrite?.();
    } catch {
      // A bookkeeping callback never stops the write.
    }
    if (!this.write(`${entry.line}\r\n`, generation)) {
      // The session ended in the write: close() rejected nothing for this one.
      entry.reject(new ElkError('The connection to the panel ended', 'lost', { sent: true }));
      return false;
    }
    if (!entry.expect) {
      entry.resolve('written');
      return false;
    }
    const wait =
      entry.answerBy === undefined ? entry.timeout : Math.max(200, entry.answerBy - this.now());
    this.waiting.add(entry);
    // A protective request never holds the line: the queue goes on.
    if (!entry.protective) this.inflight = entry;
    entry.timer = this.timers.setTimeout(() => {
      if (!this.waiting.has(entry)) return;
      this.finish(entry);
      if (!entry.short) this.timeouts += 1;
      entry.reject(new ElkError(`No answer to ${entry.label}`, 'timeout', { sent: true }));
      if (this.timeouts >= LIMITS.maxTimeouts) {
        this.lost(generation, 'no answer from the panel');
        return;
      }
      this.pump();
    }, wait);
    return this.inflight === entry;
  }

  /** A written request is no longer waiting. */
  finish(entry) {
    this.timers.clearTimeout(entry.timer);
    this.waiting.delete(entry);
    if (this.inflight === entry) this.inflight = undefined;
  }

  // --- Reads and commands ----------------------------------------------------

  /** The arming status of the 8 areas (AS) read now. */
  readArming(options = {}) {
    return this.request(REQUEST.arming(), { label: 'arming', expect: 'AS', ...options });
  }

  readOutputs(options = {}) {
    return this.request(REQUEST.outputs(), { label: 'outputs', expect: 'CS', ...options });
  }

  /** Any request of protocol.js REQUEST, by name. */
  read(name, args = [], options = {}) {
    return this.request(REQUEST[name](...args), { label: name, ...options });
  }

  /** A command line (arming, output): the user code may be in it, never logged. */
  command(line, label, options = {}) {
    return this.request(line, { label, ...options });
  }
}
