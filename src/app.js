// -----------------------------------------------------------------------------
// The integration: one connection with the M1XEP Ethernet module of an ELK M1
// panel (src/elk/client.js), the reports of the panel, the Gladys devices and
// states (src/devices.js), the scene events, the commands. index.js only
// wires the SDK handlers to it.
//
// Safety:
// - arming is always allowed (it protects): never queued behind a disarm, it
//   withdraws the disarms of its area still waiting, never lowers the
//   protection, and is not blocked by an unreadable state nor by the waits
//   between connection attempts; disarming and the outputs are off unless
//   the configuration allows them (two options), read again right before
//   the write;
// - a disarm or an output command decides on the state read from the panel
//   right before it, never on the state in memory, one at a time;
// - a command is written within 3.5 s of the request or not at all (Gladys
//   waits 5 s); it counts as done only when a report received after its
//   write shows it; one that may have reached the panel is never reported
//   "not sent", but "sent, without confirmation", and the state is read again;
// - a user code refused by the panel (its "invalid code" report right after
//   a command with that code) is never sent again by itself: the commands
//   stop, across restarts, until the code changes or "Allow a new try of the
//   code" is clicked;
// - the secure port: the certificate of the M1XEP is pinned; another one, or
//   a refused login, stops the integration until the user acts;
// - every command, sent or refused, is logged; the user code and the
//   password never are.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { credentialsHash, normalizeConfig, placeKey, sessionKey } from './config.js';
import { ARM_MODES, BUTTON_PUSH, LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { buildDevices, buildStates, parseFeatureId } from './devices.js';
import { ElkClient, ElkError } from './elk/client.js';
import { DESCRIPTION, PROTECTION, areaStatus, armLine, outputLine } from './elk/protocol.js';
import { COMMAND_NAMES, MODE_NAMES, T, fill, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** A command refused before anything was sent to the panel. */
export class Refused extends Error {}

const emptyModel = () => ({
  version: undefined,
  rp: 0,
  areas: undefined,
  zones: undefined,
  zoneAlarms: undefined,
  zoneAreas: undefined,
  temperatures: new Map(),
  outputs: undefined,
  troubles: undefined,
  thermostats: new Map(),
  names: { area: new Map(), zone: new Map(), output: new Map(), thermostat: new Map() },
});

/** The arming as an event sees it: an armed mode once the exit timer is over. */
const settled = (status) => {
  if (!status.known) return 'unknown';
  if (status.armedMode === 'disarmed') return 'disarmed';
  return status.exit ? 'arming' : status.armedMode;
};

export class ElkApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'elk-m1' }),
    client,
    connect,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = client ?? new ElkClient({ connect, timers, now, logger });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.raw = {};
    this.key = undefined;
    this.place = undefined;
    this.code = undefined;
    this.model = emptyModel();
    this.online = false;
    this.memory = undefined;
    this.savedAt = undefined;
    /** Incremented at every start: a late event of an older session is ignored. */
    this.session = 0;
    /** area -> { mode, until }: what the last Gladys command asked. */
    this.commanded = new Map();
    /** area -> its arming at the last flush: the transitions start from it. */
    this.seen = new Map();
    this.readBacks = new Set();
    /** `area:kind` -> when its last alarm_triggered was sent. */
    this.alarmsSent = new Map();
    /** area -> { level, at }: the last arm written (an arm as strong never goes after it). */
    this.lastArm = new Map();
    /** area -> when a disarm was written whose outcome is not confirmed. */
    this.disarmWrittenAt = new Map();
    /** Counts of the AS and output reports: a confirmation only takes the later ones. */
    this.seq = { AS: 0, outputs: 0 };
    this.arms = Promise.resolve();
    this.commands = Promise.resolve();
    this.starting = Promise.resolve();
    /** Disarms asked and not finished (an arm of their area withdraws them). */
    this.disarms = new Set();
    this.lastStatus = undefined;
    this.lastTransport = undefined;
    this.published = undefined;
    this.started = false;
    this.sweeper = undefined;
    this.flushTimer = undefined;
    this.downInfo = undefined;
    this.lastRefreshAt = undefined;
    this.namesRead = undefined;
    this.alarmZonesRead = undefined;
    this.trustClick = undefined;
    /** { code, at }: the last command written with a user code (memory only). */
    this.sentWithCode = undefined;
    // Every report is applied to the model when the client emits it, in
    // order; guard() only queues what talks to Gladys, and drops it when a
    // new session started meanwhile.
    this.client.on('attempt', ({ at }) => this.noteAttempt(at));
    this.client.on('pin', ({ fingerprint }) => this.learnPin(fingerprint));
    this.client.on('up', ({ version }) => {
      this.model.version = version;
      this.online = true;
      this.downInfo = undefined;
      this.loggedIn();
      const session = this.session;
      this.guard(() => this.onUp());
      this.initialReads(session);
    });
    this.client.on('down', (info) => {
      const wasOnline = this.online;
      this.online = false;
      this.downInfo = { ...info, at: this.now() };
      if (info.final) this.finalStop(info);
      else this.noteFailures(info.failures);
      this.guard(() => this.onDown(info, wasOnline));
    });
    this.client.on('message', ({ code, value }) => this.apply(code, value));
  }

  /** Client events run one after the other, in order; those of an older session are dropped. */
  guard(fn) {
    const session = this.session;
    this.chain = (this.chain ?? Promise.resolve())
      .then(() => (session === this.session ? fn() : undefined))
      .catch((err) => this.logger.error(`ELK event failed: ${err.message}`));
    return this.chain;
  }

  get language() {
    return this.config.language;
  }

  error(entry, cause) {
    return new Error(word(entry, this.language), cause ? { cause } : undefined);
  }

  refused(entry) {
    return new Refused(word(entry, this.language));
  }

  // --- Memory (/data) ----------------------------------------------------------

  async loadMemory() {
    if (this.memory) return this.memory;
    const raw = await Promise.resolve()
      .then(() => this.store.load())
      .catch(() => null);
    this.memory = normalizeMemory(raw, this.now());
    return this.memory;
  }

  ensureMemory() {
    if (!this.memory) this.memory = normalizeMemory(null, this.now());
    return this.memory;
  }

  async saveMemory() {
    if (!this.memory) return;
    this.savedAt = this.now();
    try {
      await this.store.save(this.memory);
    } catch (err) {
      this.logger.warn(`Saving the state to /data failed: ${err.message}`);
    }
  }

  /** The instant of a connection attempt: kept, written at most once a minute. */
  noteAttempt(at) {
    const memory = this.ensureMemory();
    memory.lastAttemptAt = at;
    memory.failures = this.client.failures;
    if (this.savedAt === undefined || this.now() - this.savedAt >= TIMINGS.attemptSave) {
      this.saveMemory();
    }
  }

  noteFailures(failures) {
    if (!this.memory || this.memory.failures === failures) return;
    this.memory.failures = failures;
    if (this.savedAt === undefined || this.now() - this.savedAt >= TIMINGS.attemptSave) {
      this.saveMemory();
    }
  }

  /** The first certificate seen at this address (no pin typed nor known): kept. */
  learnPin(fingerprint) {
    const memory = this.ensureMemory();
    const pins = memory.pins;
    pins[this.place] = fingerprint;
    const keys = Object.keys(pins);
    for (const key of keys.slice(0, Math.max(0, keys.length - LIMITS.maxPins))) delete pins[key];
    this.logger.info(`ELK: certificate of the M1XEP pinned (SHA-256 ${fingerprint})`);
    this.saveMemory();
  }

  /** A login worked: no stop on refused credentials or certificate is kept for this place. */
  loggedIn() {
    const memory = this.ensureMemory();
    let changed = false;
    if (memory.loginRefused) {
      memory.loginRefused = null;
      changed = true;
    }
    if (memory.certChanged?.place === this.place) {
      memory.certChanged = null;
      changed = true;
    }
    if (changed) this.saveMemory();
  }

  /** Another certificate or a refused login: persisted, the client stays stopped. */
  finalStop({ kind, fingerprint }) {
    const memory = this.ensureMemory();
    if (kind === 'certificate') {
      memory.certChanged = { place: this.place, fingerprint, at: this.now() };
      this.logger.error(
        `ELK: the M1XEP shows another certificate (SHA-256 ${fingerprint}): stopped until it is trusted`,
      );
    } else if (kind === 'login') {
      const salt = randomBytes(16).toString('hex');
      memory.loginRefused = {
        place: this.place,
        salt,
        hash: credentialsHash(this.config, salt),
        at: this.now(),
      };
      this.logger.error('ELK: the M1XEP refused the login: stopped, no new try by itself');
    }
    this.saveMemory();
  }

  /**
   * The first connection after a (re)start: never sooner than the last
   * attempt allows (after a session that worked: the first wait), so a
   * restart loop never connects faster than the waits between attempts.
   */
  notBefore() {
    const { lastAttemptAt, failures } = this.memory;
    if (!lastAttemptAt) return 0;
    const wait = TIMINGS.backoff[Math.min(Math.max(failures, 1) - 1, TIMINGS.backoff.length - 1)];
    return lastAttemptAt + wait;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Starts (or restarts); two starts never overlap (no leaked timer). */
  start(raw = {}) {
    const run = this.starting.then(() => this.startNow(raw));
    this.starting = run.catch(() => undefined);
    return run;
  }

  async startNow(raw = {}) {
    this.stop();
    this.session += 1;
    const next = normalizeConfig(raw);
    if (placeKey(next) !== this.place) {
      // Another panel, maybe: what we knew no longer holds.
      this.model = emptyModel();
      this.seen.clear();
      this.namesRead = undefined;
      this.place = placeKey(next);
    }
    this.raw = raw;
    this.config = next;
    this.key = sessionKey(next);
    this.code = next.code;
    this.online = false;
    this.downInfo = undefined;
    if (next.listErrors.length > 0) {
      this.logger.warn(`Areas, zones, outputs or thermostats not understood: ${next.listErrors}`);
    }
    if (next.codeInvalid) this.logger.warn('The user code is not 4 to 6 digits: ignored');
    await this.loadMemory();
    await this.publishDevices();
    await this.publishStates();
    const problem = this.configProblem() ?? (await this.blocked());
    if (problem) {
      await this.setStatus(false, problem);
      return;
    }
    this.client.configure({
      host: next.host,
      port: next.port,
      tls: next.tls,
      pin: next.pin ?? this.memory.pins[this.place],
      username: next.username,
      password: next.password,
    });
    const notBefore = this.notBefore();
    this.client.start({ notBefore, failures: this.memory.failures });
    const wait = notBefore - this.now();
    await this.setStatus(
      false,
      wait > 0 && !this.client.busy ? fill(T.waiting, wait) : T.connecting,
    );
    this.startSweeper();
  }

  /**
   * A stop the user must lift: another certificate (until its fingerprint
   * is typed or trusted) or the same refused credentials. New credentials
   * lift the login stop.
   */
  async blocked() {
    const memory = this.memory;
    const changed = memory.certChanged;
    if (this.config.tls && changed?.place === this.place) {
      if (this.config.pin !== changed.fingerprint)
        return this.certificateMessage(changed.fingerprint);
    }
    const refused = memory.loginRefused;
    if (this.config.tls && refused?.place === this.place) {
      if (credentialsHash(this.config, refused.salt) === refused.hash) return T.loginRefused;
      memory.loginRefused = null;
      await this.saveMemory();
      this.logger.info('ELK: new credentials, the stop on the refused login is lifted');
    }
    return undefined;
  }

  certificateMessage(fingerprint) {
    return this.config.pin
      ? fill(T.certificateNotTyped, fingerprint)
      : fill(T.certificateChanged, fingerprint);
  }

  startSweeper() {
    if (this.sweeper) this.timers.clearInterval(this.sweeper);
    this.sweeper = this.timers.setInterval(() => this.guard(() => this.sweep()), TIMINGS.sweep);
  }

  /**
   * Stops the connection. `final` only when the container stops: a restart
   * (new address) keeps the alarm_triggered retries running.
   */
  stop({ final = false } = {}) {
    this.client.stop();
    this.online = false;
    this.publisher.stop({ final });
    if (this.sweeper) this.timers.clearInterval(this.sweeper);
    this.sweeper = undefined;
    if (this.flushTimer) this.timers.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const timer of this.readBacks) this.timers.clearTimeout(timer);
    this.readBacks.clear();
  }

  configProblem() {
    if (!this.config.host) return T.noHost;
    if (this.config.pinInvalid) return T.pinInvalid;
    if (this.config.tls && !this.config.username) return T.noUsername;
    if (this.config.areas.length === 0) return T.noArea;
    return undefined;
  }

  /** First connection to Gladys: start; a reconnection (Gladys restarted): resend everything. */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    // Gladys keeps the connection status and the discovered devices in memory.
    this.published = undefined;
    this.lastTransport = undefined;
    const status = this.lastStatus;
    this.lastStatus = undefined;
    await this.configUpdated(raw);
    if (status && this.lastStatus === undefined) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    this.publisher.forget();
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports(
      this.online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
    );
  }

  /**
   * A new address, port, connection kind, credentials or typed fingerprint
   * reconnects; a new user code lifts its stop; the rest (lists, options,
   * language) applies at once, without reading the panel again.
   */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    // First of all: an option switched off applies to the commands at once.
    this.config = next;
    if (next.code !== this.code) {
      this.code = next.code;
      await this.liftCodeStop();
    }
    if (sessionKey(next) !== this.key) return this.start(raw);
    this.raw = raw;
    await this.publishDevices();
    await this.publishStates();
    if (this.online) await this.setStatus(true, this.connectedMessage());
    return undefined;
  }

  async liftCodeStop() {
    const memory = await this.loadMemory();
    if (!memory.codeStop) return;
    memory.codeStop = null;
    await this.saveMemory();
    this.logger.info('ELK: the stop on the refused user code is lifted');
  }

  codeStopped() {
    return Boolean(this.memory?.codeStop);
  }

  /**
   * The panel refused the user code: no command until the code changes or
   * "Allow a new try of the code" is clicked. Persisted at once (before any
   * other command can see the memory), told without waiting for Gladys.
   */
  stopOnCode() {
    const memory = this.ensureMemory();
    const already = Boolean(memory.codeStop);
    memory.codeStop = { at: this.now() };
    if (!already) this.logger.error('ELK: the panel refused the user code: commands stopped');
    this.saveMemory();
    if (this.online) this.setStatus(true, this.connectedMessage());
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  connectedMessage() {
    const message = {};
    for (const lang of ['en', 'fr']) {
      const areas = this.config.areas
        .map((n) => {
          const status = areaStatus(this.model.areas?.get(n));
          const area = word(fill({ en: (x) => `area ${x}`, fr: (x) => `secteur ${x}` }, n), lang);
          return `${area} ${word(MODE_NAMES[status.mode] ?? MODE_NAMES.unknown, lang).toLowerCase()}`;
        })
        .join(', ');
      message[lang] = T.connected[lang](this.model.version?.m1, areas, this.config.zones.size);
      if (this.model.rp) message[lang] += T.programming[lang];
      if (this.codeStopped()) message[lang] += T.codeStopped[lang];
    }
    return message;
  }

  // --- Reports of the panel ------------------------------------------------------

  /** A report, applied to the model at once (in the order of the line). */
  apply(code, value) {
    const model = this.model;
    switch (code) {
      case 'AS':
        model.areas = value.areas;
        this.seq.AS += 1;
        if (this.config.areas.some((n) => areaStatus(value.areas.get(n)).alarm)) {
          // Which zone: the panel says it in AZ (elkm1-lib reads it on every alarm).
          this.readAlarmZones().catch(() => undefined);
        }
        break;
      case 'AZ':
        model.zoneAlarms = value.alarms;
        break;
      case 'ZS':
        model.zones = value.zones;
        break;
      case 'ZC':
        if (!model.zones) model.zones = new Map();
        model.zones.set(value.zone, value.status);
        break;
      case 'ZP':
        model.zoneAreas = value.areas;
        break;
      case 'CS':
        model.outputs = value.outputs;
        this.seq.outputs += 1;
        break;
      case 'CC':
        if (!model.outputs) model.outputs = new Map();
        model.outputs.set(value.output, value.on);
        this.seq.outputs += 1;
        break;
      case 'SS':
        model.troubles = value.troubles;
        break;
      case 'VN':
        model.version = value;
        break;
      case 'LW':
        for (const [n, t] of value.zones) model.temperatures.set(n, t);
        break;
      case 'ST':
        if (value.group === 0 && value.device >= 1 && value.device <= 16) {
          model.temperatures.set(
            value.device,
            value.temperature > -60 ? value.temperature : undefined,
          );
        } else if (value.group === 2 && model.thermostats.has(value.device)) {
          model.thermostats.get(value.device).temperature = value.temperature;
        }
        break;
      case 'TR':
        model.thermostats.set(value.thermostat, value);
        break;
      case 'RP':
        if (value.status !== model.rp) {
          this.logger.warn(`ELK: ElkRP ${value.status ? 'connected' : 'disconnected'}`);
        }
        model.rp = value.status;
        break;
      case 'IC':
        this.invalidCode(value);
        return;
      default:
        return;
    }
    this.noteChange();
  }

  /**
   * An "invalid code" report: ours when it carries the code of a command
   * written just before (the report holds the digits; never logged).
   */
  invalidCode({ code, user }) {
    if (user !== 0) return;
    const sent = this.sentWithCode;
    const ours =
      sent &&
      sent.code === this.config.code &&
      code === sent.code.padStart(6, '0') &&
      this.now() - sent.at <= TIMINGS.codeWindow;
    if (!ours) {
      this.logger.info('ELK: an invalid code was entered (keypad or other)');
      return;
    }
    this.stopOnCode();
  }

  /** States and transitions go to Gladys in order, through the guard. */
  noteChange() {
    if (this.flushTimer) return;
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = undefined;
      this.guard(() => this.flushChanges());
    }, 0);
  }

  async flushChanges() {
    const session = this.session;
    const events = [];
    for (const n of this.config.areas) {
      const entry = this.model.areas?.get(n);
      if (!entry) continue;
      const status = areaStatus(entry);
      const now = { arming: settled(status), alarm: status.alarm };
      events.push(...this.transitions(n, this.seen.get(n), now));
      this.seen.set(n, now);
    }
    await this.publishStates();
    if (events.some((event) => event.type === 'alarm')) {
      // The zone of the alarm comes in AZ, read now (bounded).
      await this.readAlarmZones().catch(() => undefined);
    }
    for (const event of events) {
      // A new configuration meanwhile: what the old session saw is not news.
      if (session !== this.session) return;
      await this.effect(event);
    }
    if (this.online && session === this.session) {
      await this.setStatus(true, this.connectedMessage());
    }
  }

  /**
   * The first status seen after a start gives no armed / disarmed event, but
   * an alarm already in progress is announced (a duplicate is better than a
   * missed alarm).
   */
  transitions(area, before, after) {
    if (!before) return after.alarm ? [{ type: 'alarm', area, kind: after.alarm }] : [];
    const events = [];
    if (before.arming !== after.arming) {
      if (ARM_MODES.includes(after.arming) || after.arming === 'armed_vacation') {
        events.push({ type: 'armed', area, mode: after.arming });
      } else if (
        after.arming === 'disarmed' &&
        before.arming !== 'arming' &&
        before.arming !== 'unknown'
      ) {
        events.push({ type: 'disarmed', area });
      }
    }
    if (after.alarm && after.alarm !== before.alarm) {
      events.push({ type: 'alarm', area, kind: after.alarm });
    }
    return events;
  }

  /** Whether a transition answers a Gladys command; the entry is used once. */
  byGladys(area, mode) {
    const asked = this.commanded.get(area);
    const match = Boolean(asked && asked.mode === mode && this.now() < asked.until);
    if (match) this.commanded.delete(area);
    return match;
  }

  /** A configured zone of this area in alarm, if the panel says which. */
  zoneInAlarm(area) {
    const alarms = this.model.zoneAlarms;
    if (!alarms) return null;
    for (const n of this.config.zones.keys()) {
      const zoneArea = this.model.zoneAreas?.get(n);
      if (alarms.has(n) && (zoneArea === undefined || zoneArea === area)) return n;
    }
    return null;
  }

  async effect(event) {
    const { area } = event;
    if (event.type === 'armed') {
      const byGladys = this.byGladys(area, event.mode);
      this.logger.info(
        `Panel: area ${area} ARMED ${event.mode} (${byGladys ? 'Gladys command' : 'keypad or other'})`,
      );
      await this.publisher.sceneEvent(SCENE_TRIGGERS.ARMED, {
        area,
        mode: event.mode,
        by_gladys: byGladys,
      });
    } else if (event.type === 'disarmed') {
      const byGladys = this.byGladys(area, 'disarmed');
      this.logger.info(
        `Panel: area ${area} DISARMED (${byGladys ? 'Gladys command' : 'keypad or other'})`,
      );
      await this.publisher.sceneEvent(SCENE_TRIGGERS.DISARMED, { area, by_gladys: byGladys });
    } else if (event.type === 'alarm') {
      const zone = this.zoneInAlarm(area);
      this.logger.warn(`Panel: ALARM ${event.kind} area ${area}${zone ? ` zone ${zone}` : ''}`);
      // A flapping detector: the same kind at most once per alarmRepeat (the
      // state features still follow every change).
      const key = `${area}:${event.kind}`;
      const last = this.alarmsSent.get(key);
      if (last !== undefined && this.now() - last < TIMINGS.alarmRepeat) {
        this.logger.warn(`Scene event alarm_triggered (${key}) repeated: not sent again yet`);
        return;
      }
      this.alarmsSent.set(key, this.now());
      await this.publisher.sceneEvent(SCENE_TRIGGERS.ALARM_TRIGGERED, {
        area,
        zone,
        kind: event.kind,
        fire: event.kind === 'fire',
      });
    }
  }

  /** AZ read now; one read at a time. */
  readAlarmZones() {
    if (!this.client.connected) return Promise.resolve();
    if (!this.alarmZonesRead) {
      this.alarmZonesRead = this.client
        .read('alarmZones', [], { expect: 'AZ', timeout: TIMINGS.alarmZoneRead, short: true })
        .finally(() => {
          this.alarmZonesRead = undefined;
        });
    }
    return this.alarmZonesRead;
  }

  // --- Client events (Gladys side) ------------------------------------------------

  async onUp() {
    await this.publishDevices();
    await this.flushChanges();
    await this.setStatus(true, this.connectedMessage());
    await this.publishTransports(DEVICE_TRANSPORTS.LOCAL);
  }

  async onDown({ reason, retryIn, silent, final, kind, fingerprint }, wasOnline) {
    if (final) {
      await this.setStatus(
        false,
        kind === 'certificate' ? this.certificateMessage(fingerprint) : T.loginRefused,
      );
    } else if (silent) {
      this.logger.warn(`ELK: no answer from the panel; next try in ${retryIn / 1000} s`);
      await this.setStatus(false, fill(T.silent, retryIn));
    } else {
      this.logger.warn(`ELK: ${reason}; next try in ${retryIn / 1000} s`);
      await this.setStatus(false, fill(T.unreachable, reason, retryIn));
    }
    if (wasOnline || this.lastTransport !== undefined) {
      await this.publishStates();
      await this.publishTransports(DEVICE_TRANSPORTS.UNREACHABLE);
    }
  }

  /**
   * After 'up': the zone areas, troubles, alarms by zone, outputs,
   * temperatures, thermostats, then the names (once per address). Internal
   * reads, in the queue: a command still goes first (an arm) or in turn.
   */
  async initialReads(session) {
    this.lastRefreshAt = this.now();
    const read = (name, args, expect, match) =>
      session === this.session && this.client.connected
        ? this.client
            .read(name, args, { expect, match, timeout: TIMINGS.internalRead, short: true })
            .catch((err) => this.logger.debug(`Read ${name} failed: ${err.message}`))
        : undefined;
    await read('zoneAreas', [], 'ZP');
    await read('troubles', [], 'SS');
    await read('alarmZones', [], 'AZ');
    await this.refreshExtras(read);
    if (session !== this.session || this.namesRead === this.place) return;
    const names = { area: new Map(), zone: new Map(), output: new Map(), thermostat: new Map() };
    const lists = {
      area: this.config.areas,
      zone: [...this.config.zones.keys()],
      output: this.config.outputs,
      thermostat: this.config.thermostats,
    };
    for (const [kind, numbers] of Object.entries(lists)) {
      for (const n of numbers) {
        const type = DESCRIPTION[kind];
        const answer = await read('description', [type, n], 'SD', (v) => v.type === type);
        // The panel answers with the next unit that has a name: only an exact match counts.
        if (answer?.unit === n && answer.name) names[kind].set(n, answer.name.slice(0, 40));
      }
    }
    if (session !== this.session || !this.client.connected) return;
    this.model.names = names;
    this.namesRead = this.place;
    this.guard(() => this.publishDevices());
  }

  async refreshExtras(read) {
    if (this.config.outputs.length > 0) await read('outputs', [], 'CS');
    if ([...this.config.zones.values()].includes('temperature')) {
      await read('temperatures', [], 'LW');
    }
    for (const n of this.config.thermostats) {
      await read('thermostat', [n], 'TR', (v) => v.thermostat === n);
    }
  }

  /** The panel reports its changes; everything is read again every 5 min anyway. */
  async refresh() {
    const session = this.session;
    this.lastRefreshAt = this.now();
    const read = (name, args, expect, match) =>
      session === this.session && this.client.connected
        ? this.client
            .read(name, args, { expect, match, timeout: TIMINGS.internalRead, short: true })
            .catch((err) => this.logger.debug(`Read ${name} failed: ${err.message}`))
        : undefined;
    await read('arming', [], 'AS');
    await read('zones', [], 'ZS');
    await read('troubles', [], 'SS');
    await this.refreshExtras(read);
  }

  /** Heartbeats of the unchanged states; expired memories go; the periodic read. */
  async sweep() {
    const now = this.now();
    for (const [area, asked] of this.commanded) {
      if (now >= asked.until) this.commanded.delete(area);
    }
    await this.publishStates();
    if (
      this.client.connected &&
      !this.model.rp &&
      this.lastRefreshAt !== undefined &&
      now - this.lastRefreshAt >= TIMINGS.refresh
    ) {
      // Not awaited: the reads go through the client queue, not the guard.
      this.refresh();
    }
  }

  // --- Gladys ----------------------------------------------------------------

  devices() {
    return buildDevices(this.gladys, this.config, this.model);
  }

  async publishDevices({ force = false } = {}) {
    const devices = this.devices();
    const json = JSON.stringify(devices);
    if (json === this.published && !force) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the devices failed: ${err.message}`);
    }
  }

  publishStates() {
    return this.publisher.publish(
      buildStates(this.gladys, this.config, this.model, { online: this.online }),
    );
  }

  async publishTransports(transport) {
    if (transport === this.lastTransport) return;
    const entries = this.devices().map((device) => ({
      external_id: device.external_id,
      transport,
    }));
    try {
      for (let i = 0; i < entries.length; i += 100) {
        await this.gladys.publishTransports(entries.slice(i, i + 100));
      }
      this.lastTransport = transport;
    } catch (err) {
      this.logger.warn(`Publishing the transports failed: ${err.message}`);
    }
  }

  /** Discovery: the devices again, from the configuration; the panel is not read. */
  async scan() {
    await this.publishDevices({ force: true });
  }

  /** The user created or updated a device: Gladys has none of its states yet, send them again. */
  async deviceChanged(device) {
    this.publisher.forget(device?.external_id);
    await this.publishStates();
  }

  // --- Commands --------------------------------------------------------------

  /** A button pressed in Gladys. Only a push (1) of a button acts. */
  async setValue(_device, feature, value) {
    const target = parseFeatureId(feature?.external_id);
    const asked = this.now();
    const pressed = value === BUTTON_PUSH.PRESSED || value === String(BUTTON_PUSH.PRESSED);
    const action = target && `${target.kind}:${target.key}`;
    const handlers = {
      'area:arm-away': () => this.arm(target.number, 'armed_away', asked),
      'area:arm-stay': () => this.arm(target.number, 'armed_stay', asked),
      'area:arm-night': () => this.arm(target.number, 'armed_night', asked),
      'area:disarm': () => this.disarm(target.number, asked),
      'output:turn-on': () => this.output(target.number, true, asked),
      'output:turn-off': () => this.output(target.number, false, asked),
    };
    if (!handlers[action]) throw new Error(`${feature?.external_id} is read-only`);
    if (!pressed) throw new Error(`Unexpected value ${JSON.stringify(value)} for a button`);
    await handlers[action]();
  }

  areaOf(value) {
    const n = Number(value);
    if (
      value === null ||
      value === '' ||
      value === undefined ||
      !Number.isInteger(n) ||
      !this.config.areas.includes(n)
    ) {
      throw this.refused(fill(T.unknownArea, String(value).slice(0, 10)));
    }
    return n;
  }

  outputOf(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || !this.config.outputs.includes(n)) {
      throw this.refused(fill(T.unknownOutput, String(value).slice(0, 10)));
    }
    return n;
  }

  /** Every arming command needs the user code; a refused one is never sent again by itself. */
  checkCode(label) {
    if (this.config.codeInvalid) throw this.refused(T.badCode);
    if (!this.config.code) throw this.refused(T.noCode);
    if (this.codeStopped()) {
      this.logger.warn(`Command REFUSED (${label}): the user code was refused before`);
      throw this.refused(T.codeRefusedBefore);
    }
  }

  checkDisarmAllowed() {
    if (this.config.allowDisarm) return;
    this.logger.warn('Disarm REFUSED: disabled in the configuration');
    throw this.refused(T.disarmRefused);
  }

  checkOutputsAllowed() {
    if (this.config.allowOutputs) return;
    this.logger.warn('Output command REFUSED: disabled in the configuration');
    throw this.refused(T.outputsRefused);
  }

  checkProgramming(label) {
    if (!this.model.rp) return;
    this.logger.warn(`Command REFUSED (${label}): ElkRP is connected`);
    throw this.refused(T.inProgramming);
  }

  check(mode, label) {
    if (mode === 'disarmed') this.checkDisarmAllowed();
    this.checkCode(label);
  }

  /** The arming of every area read now; refused (nothing sent) when it cannot be read by readBy. */
  async freshArming(asked, { protective = false, kind, readBy = asked + TIMINGS.readBy } = {}) {
    if (!this.client.connected) throw this.refused(T.offline);
    if (readBy - this.now() < 100) throw this.refused(T.tooLate);
    try {
      const { areas } = await this.client.readArming({
        sendBy: readBy,
        answerBy: readBy,
        protective,
        kind,
        short: true,
      });
      return areas;
    } catch (err) {
      throw this.readRefusal(err);
    }
  }

  readRefusal(err) {
    if (err instanceof ElkError && err.kind === 'late') return this.refused(T.tooLate);
    if (err instanceof ElkError && err.kind === 'offline') return this.refused(T.offline);
    if (err instanceof ElkError && err.kind === 'lost') return this.refused(T.linkCut);
    if (err instanceof ElkError && err.kind === 'withdrawn') return this.refused(T.disarmWithdrawn);
    return this.refused(T.stateUnknown);
  }

  /**
   * Arm away, stay or night. Protective: never behind a disarm (it withdraws
   * those of its area still waiting), written at once, never blocked by an
   * unreadable state nor by the waits between connection attempts, never
   * lowering the protection; the user code is still needed, and a refused
   * one still stops it. Arms go one at a time.
   */
  arm(rawArea, mode, asked = this.now()) {
    if (!ARM_MODES.includes(mode)) return Promise.reject(new Error(`Unknown arming mode ${mode}`));
    let n;
    try {
      n = this.areaOf(rawArea);
      this.checkCode(word(fill(COMMAND_NAMES[mode], n), 'en'));
    } catch (err) {
      return Promise.reject(err);
    }
    this.withdrawDisarms(n);
    const run = this.arms.then(
      () => this.armNow(n, mode, asked),
      () => this.armNow(n, mode, asked),
    );
    this.arms = run.catch(() => undefined);
    return run;
  }

  async armNow(n, mode, asked) {
    const label = word(fill(COMMAND_NAMES[mode], n), 'en');
    const level = PROTECTION[mode];
    this.checkCode(label);
    this.checkProgramming(label);
    const session = this.session;
    if (!this.client.connected) {
      // Waiting between two attempts (a cut, a restart): an arm is never
      // blocked by those waits, it gets one attempt now.
      await this.wakeForArm(asked);
    }
    let status;
    try {
      const areas = await this.freshArming(asked, {
        protective: true,
        readBy: asked + TIMINGS.armReadBy,
      });
      status = areaStatus(areas.get(n));
    } catch (err) {
      if (!(err instanceof Refused) || !this.client.connected) throw err;
      // Unreadable. An arm away never lowers anything: sent. The others are
      // sent only when the last state known protects less (the memory only
      // ever holds a command back).
      const known = areaStatus(this.model.areas?.get(n));
      if (level < PROTECTION.armed_away && (!known.known || known.level >= level)) {
        this.logger.warn(`Arm REFUSED (${label}): the state could not be read`);
        throw this.refused(this.covered(n, mode) ? T.armCovered : T.stateUnknown);
      }
      this.logger.warn(`Arm: the state could not be read (${err.message}); sent anyway`);
    }
    if (session !== this.session) throw this.refused(T.restarted);
    if (status && this.disarmUncertain(n)) {
      // A disarm left lately with no known outcome: the state read may come
      // before its effect. Never "nothing sent" on it.
      if (status.armed && status.level > level) {
        this.logger.warn(`Arm (${label}): a disarm may still apply, state uncertain`);
        this.scheduleReadBack();
        throw this.error(T.uncertainAfterDisarm);
      }
      status = undefined;
    }
    if (status?.armed) {
      if (status.level >= level) {
        // Never "arm stay" over "armed away": that would lower the protection.
        this.logger.info(`Area ${n} already ${status.armedMode} (${label}): nothing sent`);
        return;
      }
      this.logger.warn(`Arm REFUSED (${label}): area ${n} is ${status.armedMode}`);
      throw this.refused(T.otherMode);
    }
    if (status?.notReady) {
      this.logger.warn(`Arm REFUSED (${label}): area ${n} is not ready`);
      throw this.refused(T.notReady);
    }
    this.checkCode(label);
    this.logger.info(`ARMING from Gladys: ${label}`);
    await this.send(n, mode, asked, { protective: true });
  }

  /**
   * An arm that would not add anything: the state in memory or an arm of
   * this area written less than answerBy ago protects as much.
   */
  covered(n, mode) {
    const level = PROTECTION[mode];
    // An arm away is never held back: sending it again lowers nothing.
    if (level >= PROTECTION.armed_away || this.disarmUncertain(n)) return false;
    const known = areaStatus(this.model.areas?.get(n));
    if (known.armed && known.level > level) return true;
    const last = this.lastArm.get(n);
    return Boolean(last && last.level > level && this.now() - last.at < TIMINGS.answerBy);
  }

  /** A disarm of this area written less than answerBy ago whose outcome is not known. */
  disarmUncertain(n) {
    const at = this.disarmWrittenAt.get(n);
    return at !== undefined && this.now() - at < TIMINGS.answerBy;
  }

  /**
   * One connection attempt now for an arm, outside the waits between
   * attempts (at most one per 5 s); refuses (nothing sent) when the session
   * is not up by readBy. Never after a stop the user must lift.
   */
  async wakeForArm(asked) {
    if (!this.client.busy) {
      if (!this.client.wake()) throw this.refused(T.offline);
      this.logger.info('Arm asked while disconnected: one connection attempt now');
    }
    const left = asked + TIMINGS.readBy - this.now();
    const up = await new Promise((resolve) => {
      const done = (value) => {
        this.client.off('up', onUp);
        this.client.off('down', onDown);
        this.timers.clearTimeout(timer);
        resolve(value);
      };
      const onUp = () => done(true);
      const onDown = () => done(false);
      const timer = this.timers.setTimeout(() => done(false), Math.max(0, left));
      this.client.on('up', onUp);
      this.client.on('down', onDown);
    });
    if (!up) throw this.refused(T.offline);
  }

  /** An arm withdraws every disarm of its area still waiting (in the app or in the client). */
  withdrawDisarms(n) {
    let count = 0;
    for (const ticket of this.disarms) {
      if (ticket.area === n && !ticket.withdrawn && !ticket.sending) {
        ticket.withdrawn = true;
        count += 1;
      }
    }
    count += this.client.withdraw(`disarm:${n}`);
    if (count > 0) this.logger.warn(`Disarm WITHDRAWN (area ${n}): an arm was asked meanwhile`);
  }

  /**
   * Disarm: off unless allowed; one at a time, in the order asked; decided
   * on the state read now (an unknown state refuses it). A disarm whose own
   * time ran out while it waited its turn is refused, nothing sent.
   */
  disarm(rawArea, asked = this.now()) {
    let n;
    let label;
    try {
      n = this.areaOf(rawArea);
      label = word(fill(COMMAND_NAMES.disarmed, n), 'en');
      this.check('disarmed', label);
    } catch (err) {
      return Promise.reject(err);
    }
    const ticket = { area: n, withdrawn: false, sending: false };
    this.disarms.add(ticket);
    const start = async () => {
      if (ticket.withdrawn) throw this.refused(T.disarmWithdrawn);
      if (this.now() >= asked + TIMINGS.readBy) {
        this.logger.warn('Disarm REFUSED: its time ran out behind other commands');
        throw this.refused(T.commandBusy);
      }
      this.check('disarmed', label);
      this.checkProgramming(label);
      const session = this.session;
      const areas = await this.freshArming(asked, { kind: `disarm:${n}` });
      if (ticket.withdrawn) throw this.refused(T.disarmWithdrawn);
      if (session !== this.session) throw this.refused(T.restarted);
      const status = areaStatus(areas.get(n));
      if (!status.known) throw this.refused(T.stateUnknown);
      if (status.armedMode === 'disarmed' && !status.alarm) {
        this.logger.info(`Area ${n} already disarmed: nothing sent`);
        return;
      }
      this.check('disarmed', label);
      this.logger.info(`DISARMING from Gladys: ${label} (state read: ${status.mode})`);
      await this.send(n, 'disarmed', asked, { kind: `disarm:${n}`, ticket });
    };
    const run = this.commands.then(start, start).finally(() => this.disarms.delete(ticket));
    this.commands = run.catch(() => undefined);
    return run;
  }

  /** The arming of the area, as the panel shows it, matches the command. */
  shows(n, mode) {
    return areaStatus(this.model.areas?.get(n)).armedMode === mode;
  }

  /**
   * Writes an arming command decided on a fresh state, then reads the state
   * back until a report received after the write shows it (or answerBy).
   * Resolves when it does; throws Refused when nothing was sent, an Error
   * otherwise ("sent, without confirmation" or "code refused").
   */
  async send(n, mode, asked, { protective = false, kind, ticket } = {}) {
    const what = fill(COMMAND_NAMES[mode], n);
    const label = word(what, 'en');
    const name = word(what, this.language);
    if (this.now() > asked + TIMINGS.sendBy) {
      this.logger.warn(`Command NOT sent (${label}): too late`);
      throw this.refused(T.tooLate);
    }
    this.check(mode, label);
    const code = this.config.code;
    const session = this.session;
    const arming = mode !== 'disarmed';
    let covered = false;
    let stoppedBefore = this.codeStopped();
    let seq;
    const unconfirmed = (why, err) => {
      // Its outcome is unknown: it never holds a later arm back.
      if (arming) this.lastArm.delete(n);
      this.logger.warn(`Command sent, NOT confirmed (${label}): ${why}`);
      this.scheduleReadBack();
      return this.error(fill(T.unconfirmed, name), err);
    };
    try {
      await this.client.command(armLine(mode, n, code), arming ? `arm (${mode})` : 'disarm', {
        sendBy: asked + TIMINGS.sendBy,
        protective,
        kind,
        // The code of this line, kept in memory: its "invalid code" report stops the commands.
        onWrite: () => {
          if (ticket) ticket.sending = true;
          seq = this.seq.AS;
          this.sentWithCode = { code, at: this.now() };
          stoppedBefore = this.codeStopped();
          if (arming) this.lastArm.set(n, { level: PROTECTION[mode], at: this.now() });
          else this.disarmWrittenAt.set(n, this.now());
        },
        // …and run once more by the client, right before the socket write.
        check: () => {
          if (ticket?.withdrawn || session !== this.session) return false;
          if (this.now() > asked + TIMINGS.sendBy) return false;
          if (arming && this.covered(n, mode)) {
            covered = true;
            return false;
          }
          try {
            this.check(mode, label);
            return this.config.code === code;
          } catch {
            return false;
          }
        },
      });
    } catch (err) {
      if (err instanceof ElkError && !err.sent) {
        this.logger.warn(`Command NOT sent (${label}): ${err.message}`);
        if (covered) throw this.refused(T.armCovered);
        if (err.kind === 'withdrawn') {
          if (ticket?.withdrawn) throw this.refused(T.disarmWithdrawn);
          if (session !== this.session) throw this.refused(T.restarted);
          // The precise reason (option switched off, code changed or stopped).
          this.check(mode, label);
        }
        if (err.kind === 'lost') throw this.refused(T.linkCut);
        throw this.refused(err.kind === 'offline' ? T.offline : T.tooLate);
      }
      throw unconfirmed(err.message, err);
    }
    this.commanded.set(n, { mode, until: this.now() + TIMINGS.commandMemory });
    const confirmed = await this.confirm(asked, session, protective, () =>
      this.seq.AS > seq ? this.shows(n, mode) : false,
    );
    if (session !== this.session) throw unconfirmed('the connection restarted');
    if (this.codeStopped() && !stoppedBefore) {
      // The panel reported our code as invalid.
      if (arming) this.lastArm.delete(n);
      this.logger.error(`Command REFUSED by the panel (${label}): invalid user code`);
      throw this.error(fill(T.codeRefused, name));
    }
    if (!confirmed) {
      throw unconfirmed(
        this.client.connected ? 'no report shows it yet' : 'the connection was cut',
      );
    }
    if (!arming) this.disarmWrittenAt.delete(n);
    this.logger.info(`Command confirmed by the state read back (${label})`);
  }

  /** Waits until `shown()` (a report after the write), reading the state again, at most until answerBy. */
  async confirm(
    asked,
    session,
    protective,
    shown,
    read = (options) => this.client.readArming(options),
  ) {
    const answerBy = asked + TIMINGS.answerBy;
    const stoppedBefore = this.codeStopped();
    while (answerBy - this.now() > 150) {
      if (session !== this.session || (this.codeStopped() && !stoppedBefore)) return false;
      if (shown()) return true;
      if (!this.client.connected) return false;
      await read({
        sendBy: answerBy - 100,
        answerBy: Math.min(answerBy, this.now() + TIMINGS.confirmEvery + 400),
        protective,
        short: true,
      }).catch(() => undefined);
      if (shown()) return true;
      await new Promise((resolve) => this.timers.setTimeout(resolve, TIMINGS.confirmEvery / 3));
    }
    return session === this.session && shown();
  }

  scheduleReadBack(
    read = () => this.client.readArming({ timeout: TIMINGS.internalRead, short: true }),
  ) {
    const timer = this.timers.setTimeout(() => {
      this.readBacks.delete(timer);
      if (!this.client.connected) return;
      read().catch((err) => this.logger.debug(`Read back failed: ${err.message}`));
    }, TIMINGS.readBack);
    this.readBacks.add(timer);
  }

  /**
   * Turn an output on or off: off unless allowed (both ways: an output may
   * drive a siren, a lock or a gate); one at a time with the disarms;
   * decided on the outputs read now; confirmed by a report after the write.
   */
  output(rawOutput, on, asked = this.now()) {
    let n;
    let what;
    try {
      n = this.outputOf(rawOutput);
      what = fill(COMMAND_NAMES[on ? 'turn-on' : 'turn-off'], n);
      this.checkOutputsAllowed();
    } catch (err) {
      return Promise.reject(err);
    }
    const label = word(what, 'en');
    const name = word(what, this.language);
    const start = async () => {
      if (this.now() >= asked + TIMINGS.readBy) throw this.refused(T.commandBusy);
      this.checkOutputsAllowed();
      this.checkProgramming(label);
      if (!this.client.connected) throw this.refused(T.offline);
      const session = this.session;
      let outputs;
      try {
        ({ outputs } = await this.client.readOutputs({
          sendBy: asked + TIMINGS.readBy,
          answerBy: asked + TIMINGS.readBy,
          short: true,
        }));
      } catch (err) {
        throw this.readRefusal(err);
      }
      if (session !== this.session) throw this.refused(T.restarted);
      const state = outputs.get(n);
      if (state === undefined) throw this.refused(T.stateUnknown);
      if (state === on) {
        this.logger.info(`Output ${n} already ${on ? 'on' : 'off'}: nothing sent`);
        return;
      }
      this.checkOutputsAllowed();
      this.logger.info(`OUTPUT from Gladys: ${label}`);
      let seq;
      try {
        await this.client.command(outputLine(n, on), label, {
          sendBy: asked + TIMINGS.sendBy,
          onWrite: () => {
            seq = this.seq.outputs;
          },
          check: () =>
            session === this.session &&
            this.now() <= asked + TIMINGS.sendBy &&
            this.config.allowOutputs,
        });
      } catch (err) {
        if (err instanceof ElkError && !err.sent) {
          this.logger.warn(`Command NOT sent (${label}): ${err.message}`);
          if (err.kind === 'withdrawn') this.checkOutputsAllowed();
          throw this.refused(
            err.kind === 'lost' ? T.linkCut : err.kind === 'offline' ? T.offline : T.tooLate,
          );
        }
        this.logger.warn(`Command sent, NOT confirmed (${label}): ${err.message}`);
        throw this.error(fill(T.unconfirmed, name), err);
      }
      const confirmed = await this.confirm(
        asked,
        session,
        false,
        () => this.seq.outputs > seq && this.model.outputs?.get(n) === on,
        (options) => this.client.readOutputs(options),
      );
      if (!confirmed) {
        this.logger.warn(`Command sent, NOT confirmed (${label})`);
        this.scheduleReadBack(() =>
          this.client.readOutputs({ timeout: TIMINGS.internalRead, short: true }),
        );
        throw this.error(fill(T.unconfirmed, name));
      }
      this.logger.info(`Command confirmed by the state read back (${label})`);
    };
    const run = this.commands.then(start, start);
    this.commands = run.catch(() => undefined);
    return run;
  }

  // --- Configuration buttons -----------------------------------------------------

  /**
   * "Test the connection": tells what the session knows; it never reads the
   * panel nor opens a connection sooner than the waits allow. After a
   * refused login only, one new try (at most one per 10 s): the stop is
   * lifted only when it works.
   */
  async testConnection() {
    const problem = this.configProblem();
    if (problem) throw this.error(problem);
    await this.chain;
    if (this.client.connected) {
      await this.setStatus(true, this.connectedMessage());
      return this.connectedMessage();
    }
    const memory = await this.loadMemory();
    const changed = memory.certChanged;
    if (
      this.config.tls &&
      changed?.place === this.place &&
      this.config.pin !== changed.fingerprint
    ) {
      throw this.error(this.certificateMessage(changed.fingerprint));
    }
    const refused = memory.loginRefused;
    if (this.config.tls && refused?.place === this.place) return this.retryLogin();
    const next = this.client.nextAttemptAt;
    if (this.downInfo) {
      const wait = Math.max(0, (next ?? this.now()) - this.now());
      throw this.error(
        this.downInfo.silent
          ? fill(T.silent, wait)
          : fill(T.unreachable, this.downInfo.reason, wait),
      );
    }
    if (next !== undefined && next > this.now()) {
      throw this.error(fill(T.waiting, next - this.now()));
    }
    throw this.error(T.connecting);
  }

  /** One login try after a refusal, asked by the user. */
  async retryLogin() {
    const last = this.client.lastAttemptAt ?? this.memory.lastAttemptAt;
    if (last && this.now() - last < TIMINGS.testAttempt) {
      throw this.error(fill(T.waiting, last + TIMINGS.testAttempt - this.now()));
    }
    this.logger.info('ELK: one new login try, asked by "Test the connection"');
    this.client.configure({
      host: this.config.host,
      port: this.config.port,
      tls: this.config.tls,
      pin: this.config.pin ?? this.memory.pins[this.place],
      username: this.config.username,
      password: this.config.password,
    });
    const result = new Promise((resolve) => {
      const done = (value) => {
        this.client.off('up', onUp);
        this.client.off('down', onDown);
        this.timers.clearTimeout(timer);
        resolve(value);
      };
      const onUp = () => done(true);
      const onDown = () => done(false);
      const timer = this.timers.setTimeout(() => done(false), TIMINGS.loginTimeout);
      this.client.on('up', onUp);
      this.client.on('down', onDown);
    });
    this.client.start({ notBefore: 0, failures: this.memory.failures });
    if (!this.sweeper) this.startSweeper();
    if (!(await result)) {
      await this.chain;
      const [, message] = this.lastStatus ? JSON.parse(this.lastStatus) : [];
      throw this.error(message ?? T.loginRefused);
    }
    await this.chain;
    await this.setStatus(true, this.connectedMessage());
    return this.connectedMessage();
  }

  /**
   * "Allow a new try of the code": the user's explicit go for the next
   * command to send the code again (nothing is sent now).
   */
  async allowCodeRetry() {
    await this.loadMemory();
    if (!this.codeStopped()) return T.codeNotStopped;
    await this.liftCodeStop();
    if (this.online) await this.setStatus(true, this.connectedMessage());
    return T.codeRetryAllowed;
  }

  /**
   * "Trust the new certificate", in two clicks: the first shows the
   * fingerprint met, the second (within 60 s) pins exactly that one and
   * connects. A save of the configuration never does it.
   */
  async trustCertificate() {
    const memory = await this.loadMemory();
    const changed = memory.certChanged;
    if (!changed || changed.place !== this.place) return T.trustNothing;
    const { fingerprint } = changed;
    if (this.config.pin && this.config.pin !== fingerprint) return fill(T.trustTyped, fingerprint);
    const click = this.trustClick;
    if (!click || click.fingerprint !== fingerprint || this.now() - click.at > TIMINGS.trustClick) {
      this.trustClick = { fingerprint, at: this.now() };
      return fill(T.trustConfirm, fingerprint);
    }
    this.trustClick = undefined;
    memory.pins[this.place] = fingerprint;
    memory.certChanged = null;
    await this.saveMemory();
    this.logger.info(`ELK: certificate ${fingerprint} trusted by the user`);
    // The client holds the old pin: a restart takes the new one.
    this.key = undefined;
    await this.start(this.raw);
    return fill(T.trustDone, fingerprint);
  }
}
