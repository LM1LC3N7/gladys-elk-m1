// -----------------------------------------------------------------------------
// An in-memory ELK M1 panel behind its M1XEP: no network for the plain port
// (`connect` is given to the client in place of net.createConnection), or
// served on a real TLS socket for the secure port (`serve()`, with the login
// of the M1XEP). It answers the requests as elkm1-lib decodes the answers
// (AS, ZS, AZ, ZP, CS, SS, VN, LW, TR, SD), applies the arming and output
// commands, pushes AS and CC on a change, sends IC for a wrong code, and
// records every line the client sent.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { LineReader, makeLine } from '../../src/elk/frame.js';

/** Lets every queued delivery and the promise chains behind it run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Waits until `check()` is true, at most `timeout` ms. */
export async function until(check, timeout = 6_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await settle(5);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition never met');
}

const pad = (n, width) => String(n).padStart(width, '0');

class FakeSocket extends EventEmitter {
  constructor(panel) {
    super();
    this.panel = panel;
    this.destroyed = false;
    this.writableLength = 0;
    this.session = panel.sessions.length + 1;
    this.reader = new LineReader({ onLine: (line) => panel.receive(this, line) });
  }

  setNoDelay() {}

  write(text) {
    if (this.destroyed) throw new Error('write after destroy');
    const copy = String(text);
    queueMicrotask(() => {
      if (!this.destroyed) this.reader.push(copy);
    });
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    queueMicrotask(() => this.emit('close'));
  }

  /** Panel side: text to the client. */
  raw(text) {
    const copy = Buffer.from(text, 'latin1');
    queueMicrotask(() => {
      if (!this.destroyed) this.emit('data', copy);
    });
  }

  send(line) {
    this.raw(`${line}\r\n`);
  }
}

export class FakeElk {
  constructor({ code = '1234', exitDelay = false, silent = false, refuseConnections = 0 } = {}) {
    this.code = code;
    this.exitDelay = exitDelay;
    this.silent = silent;
    this.refuseConnections = refuseConnections;
    this.armed = '00000000'.split('');
    this.armUp = '11111111'.split('');
    this.alarm = '00000000'.split('');
    // Logical normal, physical EOL: a closed zone.
    this.zones = Array(208).fill('2');
    this.zoneAreas = Array(208).fill('1');
    this.zoneAlarms = Array(208).fill('0');
    this.outputs = Array(208).fill('0');
    this.troubles = Array(34).fill('0');
    this.temperatures = Array(16).fill(0);
    this.thermostats = new Map();
    this.names = { 0: new Map(), 1: new Map(), 4: new Map(), 11: new Map() };
    /** Push AS / CC by itself after an accepted command. */
    this.pushChanges = true;
    /** Accept a command but change nothing (a zone open). */
    this.ignoreCommands = false;
    /** Send IC for a wrong code. */
    this.sendInvalidCode = true;
    this.sessions = [];
    /** Every line the client sent: [{ session, code, line, at }]. */
    this.log = [];
    /** (code, line) -> true: that line gets no answer. */
    this.hold = () => false;
    this.connect = this.connect.bind(this);
  }

  connect(options) {
    this.options = options;
    const socket = new FakeSocket(this);
    this.sessions.push(socket);
    if (this.refuseConnections > 0) {
      this.refuseConnections -= 1;
      queueMicrotask(() => {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        socket.emit('error', err);
      });
      return socket;
    }
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  }

  /**
   * Serves a real (TLS) socket, with the login of the secure port: the user
   * name and the password come as two raw lines.
   */
  serve(socket, { username, password, refuse = false } = {}) {
    const peer = {
      session: this.sessions.length + 1,
      send: (line) => socket.write(`${line}\r\n`),
      raw: (text) => socket.write(text),
      destroy: () => socket.destroy(),
      login: [],
      logged: false,
    };
    this.sessions.push(peer);
    socket.write('Username: \r\n');
    const reader = new LineReader({
      onLine: (line) => {
        if (!peer.logged) {
          peer.login.push(line);
          if (peer.login.length === 1) socket.write('Password: \r\n');
          if (peer.login.length < 2) return;
          if (!refuse && peer.login[0] === username && peer.login[1] === password) {
            peer.logged = true;
            socket.write('Login successful\r\n');
          } else {
            socket.write('Username/Password not found\r\n');
          }
          return;
        }
        this.receive(peer, line);
      },
    });
    socket.on('data', (chunk) => reader.push(chunk));
    socket.on('error', () => undefined);
  }

  get current() {
    return this.sessions.at(-1);
  }

  /** The command lines (arming), every session. */
  get commands() {
    return this.log.filter((e) => /^a[0-9:]$/.test(e.code));
  }

  get outputCommands() {
    return this.log.filter((e) => e.code === 'cn' || e.code === 'cf');
  }

  reads(code) {
    return this.log.filter((e) => e.code === code);
  }

  receive(socket, line) {
    const code = line.slice(2, 4);
    this.log.push({ session: socket.session, code, line, at: Date.now() });
    if (this.silent || this.hold(code, line)) return;
    const answer = {
      vn: () => this.vn(),
      as: () => this.as(),
      zs: () => makeLine('ZS', this.zones.join('')),
      az: () => makeLine('AZ', this.zoneAlarms.join('')),
      zp: () => makeLine('ZP', this.zoneAreas.join('')),
      cs: () => makeLine('CS', this.outputs.join('')),
      ss: () => makeLine('SS', this.troubles.join('')),
      lw: () =>
        makeLine(
          'LW',
          Array(16).fill('070').join('') +
            this.temperatures.map((t) => pad(t === 0 ? 0 : t + 60, 3)).join(''),
        ),
      tr: () => this.tr(Number(line.slice(4, 6))),
      sd: () => this.sd(Number(line.slice(4, 6)), Number(line.slice(6, 9))),
    }[code];
    if (answer) {
      const text = answer();
      if (text) socket.send(text);
      return;
    }
    if (/^a[0-9:]$/.test(code)) this.command(socket, line);
    if (code === 'cn' || code === 'cf') this.output(socket, line);
  }

  vn() {
    return makeLine('VN', '050210020046');
  }

  as() {
    return makeLine('AS', `${this.armed.join('')}${this.armUp.join('')}${this.alarm.join('')}`);
  }

  tr(n) {
    const t = this.thermostats.get(n);
    if (!t) return undefined;
    return makeLine(
      'TR',
      `${pad(n, 2)}${t.mode}${t.hold ? 1 : 0}${t.fan ? 1 : 0}${pad(t.temperature, 2)}${pad(t.heat, 2)}${pad(t.cool, 2)}${pad(t.humidity, 2)}`,
    );
  }

  /** The description of `unit` or of the next unit with one; unit 000 when none is left. */
  sd(type, unit) {
    const names = this.names[type] ?? new Map();
    const next = [...names.keys()].sort((a, b) => a - b).find((n) => n >= unit);
    const name = next === undefined ? '' : names.get(next);
    return makeLine(
      'SD',
      `${pad(type, 2)}${pad(next ?? 0, 3)}${name.padEnd(16, ' ').slice(0, 16)}`,
    );
  }

  command(socket, line) {
    const level = line[3];
    const area = Number(line[4]);
    const code = line.slice(5, 11);
    if (code !== this.code.padStart(6, '0')) {
      if (this.sendInvalidCode) {
        const digits = code
          .split('')
          .map((d) => `0${d}`)
          .join('');
        socket.send(makeLine('IC', `${digits}00001`));
      }
      return;
    }
    if (this.ignoreCommands) return;
    const i = area - 1;
    if (level === '0') {
      this.armed[i] = '0';
      this.armUp[i] = '1';
      this.alarm[i] = '0';
    } else {
      this.armed[i] = level;
      this.armUp[i] = this.exitDelay ? '3' : '4';
    }
    if (this.pushChanges) socket.send(this.as());
  }

  output(socket, line) {
    const n = Number(line.slice(4, 7));
    this.outputs[n - 1] = line.slice(2, 4) === 'cn' ? '1' : '0';
    if (this.pushChanges && !this.ignoreCommands) {
      socket.send(makeLine('CC', `${pad(n, 3)}${this.outputs[n - 1]}`));
    }
  }

  /** A change on the panel side, sent as AS. */
  pushArming() {
    this.current?.send(this.as());
  }

  /** A zone changed (ZC). */
  pushZone(n, hex) {
    this.zones[n - 1] = hex;
    this.current?.send(makeLine('ZC', `${pad(n, 3)}${hex}`));
  }

  /** The keypad entered an invalid code (IC with the code digits). */
  pushInvalidCode(code) {
    const digits = code
      .padStart(6, '0')
      .split('')
      .map((d) => `0${d}`)
      .join('');
    this.current?.send(makeLine('IC', `${digits}00001`));
  }

  /** The M1XEP closes the connection. */
  drop() {
    this.current.destroy();
  }
}

export const quietLogger = () => {
  const lines = [];
  const log = (level) => (message) => lines.push(`${level} ${message}`);
  return {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
};
