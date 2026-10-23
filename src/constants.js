// -----------------------------------------------------------------------------
// Fixed values: manifest keys, Gladys value enums, protocol limits and timings.
// The SDK exports the Gladys categories and types, not the state values: the
// ones used here mirror server/utils/constants.js of the core.
// -----------------------------------------------------------------------------

/** Manifest keys: frozen, users store them in scenes and dashboards. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  ALLOW_CODE_RETRY: 'allow_code_retry',
  TRUST_CERTIFICATE: 'trust_certificate',
};

export const SCENE_ACTIONS = {
  ARM: 'arm',
  DISARM: 'disarm',
};

export const SCENE_TRIGGERS = {
  ALARM_TRIGGERED: 'alarm_triggered',
  ARMED: 'armed',
  DISARMED: 'disarmed',
};

/** Arming modes of a scene action, a button or an `armed` event (frozen: scenes compare them). */
export const ARM_MODES = ['armed_away', 'armed_stay', 'armed_night'];

/** How a zone shows in Gladys (frozen: stored in the configuration). */
export const ZONE_KINDS = ['opening', 'motion', 'smoke', 'leak', 'temperature'];

/** Connection kinds of the M1XEP (frozen: stored in the configuration). */
export const CONNECTIONS = ['tls12', 'tls10', 'plain'];

/** Default ports of the M1XEP: 2601 secure (TLS + login), 2101 non-secure. */
export const DEFAULT_PORTS = { tls12: 2601, tls10: 2601, plain: 2101 };

export const TEMPERATURE_UNITS = ['fahrenheit', 'celsius'];

/** Gladys core values (server/utils/constants.js). */
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const BUTTON_PUSH = { PRESSED: 1 };

export const LIMITS = {
  /** The ELK M1 numbers (elkm1-lib const.py, Max). */
  maxAreas: 8,
  maxZones: 208,
  maxOutputs: 208,
  maxThermostats: 16,
  /** Zone temperatures are reported for zones 1 to 16 only (LW / ST). */
  maxTemperatureZones: 16,
  /** One line of the protocol: the longest (ZS, AZ, CS, ZD) is 216 characters. */
  maxLine: 512,
  /** Requests in a row without an answer before the link counts as dead. */
  maxTimeouts: 3,
  /** Malformed lines in a row, without a good one between, before the link is cut. */
  maxRejects: 50,
  /** Malformed lines in one minute before the link is cut. */
  maxRejectsPerMinute: 100,
  /** Lines received per second before the link is cut (a flood, a loop). */
  maxLinesPerSecond: 200,
  /** Bytes waiting in the socket write buffer before the session is cut. */
  maxPendingWrite: 64 * 1024,
  /** Requests waiting for the line at most (internal reads and disarms; arms never wait). */
  maxQueued: 64,
  /** States per minute sent to Gladys (the core admits 300), shared by every publication. */
  statesPerMinute: 240,
  /** Part of it only the panel and the areas may use. */
  priorityStates: 60,
  /** Scene events per minute (the core admits 300); alarm_triggered is never dropped. */
  eventsPerMinute: 120,
  /** Tries of an alarm_triggered event refused by Gladys or the network. */
  alarmEventTries: 3,
  /** Fingerprints of certificates kept in /data (one per address and port). */
  maxPins: 8,
};

export const TIMINGS = {
  /** TCP (and TLS) connection to the M1XEP. */
  connectTimeout: 10_000,
  /** The login of the secure port: its answer, or the first valid line. */
  loginTimeout: 10_000,
  /** One request (elkm1-lib MESSAGE_RESPONSE_TIME, 5 s). */
  requestTimeout: 5_000,
  /** The first version request after connecting: the panel may be slow to answer. */
  firstReadTimeout: 10_000,
  /** A periodic read or a read back: a short wait. */
  internalRead: 2_000,
  /** Nothing received for this long while connected: the link is dead (elkm1-lib HEARTBEAT_TIME). */
  watchdog: 120_000,
  /** Arming, zones, outputs and troubles read again this often (the panel also reports changes). */
  refresh: 300_000,
  /** Waits before reconnecting, in a row (the last one repeats). */
  backoff: [10_000, 30_000, 60_000, 120_000, 300_000],
  /** Never a new connection sooner than this after the last one closed. */
  sessionGap: 5_000,
  /** At most one summary line of the rejected lines per this period. */
  rejectLog: 60_000,
  /** The instant of the last connection attempt is written to /data at most this often. */
  attemptSave: 60_000,
  /**
   * Gladys waits 5 s for a set_value ack. A command's fresh state must be
   * read by readBy, the command written by sendBy after it was asked (else
   * refused, nothing sent), and its confirmation awaited until answerBy
   * (then "sent, without confirmation").
   */
  readBy: 2_500,
  /** An arm reads the state by this time, so that its write still fits. */
  armReadBy: 1_500,
  sendBy: 3_500,
  answerBy: 4_500,
  /** Between two reads of the state while a command is confirmed. */
  confirmEvery: 600,
  /** An "invalid code" report this long after a command with our code is its refusal. */
  codeWindow: 6_000,
  /** The state is read again this long after a command. */
  readBack: 2_000,
  /** A transition seen this long after a Gladys command is credited to it. */
  commandMemory: 5 * 60_000,
  /** The zones in alarm are read for an alarm event at most this long. */
  alarmZoneRead: 1_500,
  /** How often the unchanged states get their heartbeat checked. */
  sweep: 60_000,
  /** An unchanged state is sent again this often… */
  stateHeartbeat: 30 * 60_000,
  /** …plus a per-feature offset within this spread. */
  heartbeatSpread: 5 * 60_000,
  /** Waits between two tries of an alarm_triggered event. */
  alarmEventRetry: [5_000, 20_000],
  /** One alarm_triggered of a kind and area at most this often (a flapping detector). */
  alarmRepeat: 30_000,
  /** The second click of "Trust the new certificate" must come within this. */
  trustClick: 60_000,
  /** "Test the connection" after a refused login: at most one attempt this often. */
  testAttempt: 10_000,
};
