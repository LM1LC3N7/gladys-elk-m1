// -----------------------------------------------------------------------------
// Messages of the ELK M1 ASCII protocol, ported from elkm1-lib 2.2.15 (MIT,
// see THIRD_PARTY_NOTICES.md): the decoders and encoders of `message.py`, the
// values of `const.py`, the trouble list of `panel.py`.
//
// Numbers here are the panel's own, from 1 (elkm1-lib counts from 0). Every
// decoder checks the length and the characters of its line and returns
// undefined for a malformed one (never an exception, never a guess).
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';
import { makeLine } from './frame.js';

const pad = (n, width) => String(n).padStart(width, '0');
const lengthIs = (line, hex) => line.slice(0, 2) === hex;

// --- Requests (lower-case codes) ------------------------------------------------

export const REQUEST = {
  /** Arming status of the 8 areas -> AS. */
  arming: () => makeLine('as'),
  /** Alarm by zone -> AZ. */
  alarmZones: () => makeLine('az'),
  /** Zone statuses -> ZS. */
  zones: () => makeLine('zs'),
  /** Zone partitions (the area of each zone) -> ZP. */
  zoneAreas: () => makeLine('zp'),
  /** Output statuses -> CS. */
  outputs: () => makeLine('cs'),
  /** System trouble status -> SS. */
  troubles: () => makeLine('ss'),
  /** Version of the M1 and of the M1XEP -> VN. */
  version: () => makeLine('vn'),
  /** Temperatures of the keypads and of zones 1 to 16 -> LW. */
  temperatures: () => makeLine('lw'),
  /** The text description of a unit (or of the next one that has one) -> SD. */
  description: (type, unit) => makeLine('sd', `${pad(type, 2)}${pad(unit, 3)}`),
  /** The data of one thermostat -> TR. */
  thermostat: (n) => makeLine('tr', pad(n, 2)),
};

/** Description types of `sd` (elkm1-lib TextDescriptions). */
export const DESCRIPTION = { zone: 0, area: 1, output: 4, thermostat: 11 };

/** Arm levels of the `a<level>` command (elkm1-lib ArmLevel). */
export const ARM_LEVEL = { disarmed: '0', armed_away: '1', armed_stay: '2', armed_night: '4' };

/**
 * Arm or disarm an area: `a<level><area><code on 6 digits>`. The user code
 * travels in this line: it is never logged (the client logs a label).
 */
export function armLine(mode, area, code) {
  const level = ARM_LEVEL[mode];
  if (level === undefined) throw new Error(`Unknown arming mode ${mode}`);
  if (!Number.isInteger(area) || area < 1 || area > LIMITS.maxAreas) {
    throw new Error(`Bad area ${area}`);
  }
  if (!isUserCode(code)) throw new Error('Bad user code');
  return makeLine(`a${level}`, `${area}${code.padStart(6, '0')}`);
}

/** Turns an output on (for good: 0 s) or off. */
export function outputLine(output, on) {
  if (!Number.isInteger(output) || output < 1 || output > LIMITS.maxOutputs) {
    throw new Error(`Bad output ${output}`);
  }
  return on ? makeLine('cn', `${pad(output, 3)}${pad(0, 5)}`) : makeLine('cf', pad(output, 3));
}

/** A user code of the M1: 4 to 6 digits (sent on 6, zero-padded). */
export const isUserCode = (text) => typeof text === 'string' && /^\d{4,6}$/.test(text);

// --- Values (elkm1-lib const.py) ------------------------------------------------

/** ArmedStatus -> our mode. The instant variants show as their plain mode. */
export const ARMED_STATUS = {
  0: 'disarmed',
  1: 'armed_away',
  2: 'armed_stay',
  3: 'armed_stay',
  4: 'armed_night',
  5: 'armed_night',
  6: 'armed_vacation',
};

/** ArmUpState: 0 not ready, 1 ready, 2 can be force armed, 3 exit timer running, 4 armed, 5 force armed, 6 armed with bypass. */
export const ARM_UP = { notReady: '0', ready: '1', forceable: '2', exitTimer: '3' };

/** AlarmState -> kind of alarm (undefined: no alarm). Frozen: scenes compare the kinds. */
export const ALARM_STATE = {
  0: undefined,
  1: undefined, // entrance delay
  2: undefined, // alarm abort delay
  3: 'fire',
  4: 'medical',
  5: 'police',
  6: 'burglar',
  7: 'aux',
  8: 'aux',
  9: 'aux',
  ':': 'aux',
  ';': 'carbon_monoxide',
  '<': 'emergency',
  '=': 'freeze',
  '>': 'gas',
  '?': 'heat',
  '@': 'water',
  A: 'fire_supervisory',
  B: 'fire',
  U: undefined, // unsupervised zone trouble
};

export const ALARM_KINDS = [
  'burglar',
  'fire',
  'medical',
  'police',
  'aux',
  'carbon_monoxide',
  'emergency',
  'freeze',
  'gas',
  'heat',
  'water',
  'fire_supervisory',
];

/** How much an arming protects: never lowered by a command of Gladys. */
export const PROTECTION = {
  disarmed: 0,
  armed_stay: 1,
  armed_night: 2,
  armed_away: 3,
  armed_vacation: 3,
};

/** ZoneLogicalStatus and ZonePhysicalStatus. */
export const ZONE_LOGICAL = ['normal', 'troubled', 'violated', 'bypassed'];
export const ZONE_PHYSICAL = ['unconfigured', 'open', 'eol', 'short'];

export const THERMOSTAT_MODES = ['off', 'heat', 'cool', 'auto', 'emergency_heat'];

/** Positions of the system trouble status (elkm1-lib panel.py `_ss_handler`). */
export const TROUBLES = [
  [0, 'ac_fail'],
  [1, 'box_tamper'],
  [2, 'fail_to_communicate'],
  [3, 'eeprom_error'],
  [4, 'low_battery'],
  [5, 'transmitter_low_battery'],
  [6, 'over_current'],
  [7, 'telephone_fault'],
  [9, 'output_2'],
  [10, 'missing_keypad'],
  [11, 'zone_expander'],
  [12, 'output_expander'],
  [14, 'remote_access'],
  [16, 'common_area_not_armed'],
  [17, 'flash_memory_error'],
  [18, 'security_alert'],
  [19, 'serial_port_expander'],
  [20, 'lost_transmitter'],
  [21, 'smoke_clean_me'],
  [22, 'ethernet'],
  [33, 'fire'],
];

// --- Decoders (upper-case codes) ------------------------------------------------

const digits = (text) => (/^\d+$/.test(text) ? Number(text) : undefined);

const DECODERS = {
  /** AS: armed status, arm-up state and alarm state of the 8 areas. */
  AS(line) {
    if (!lengthIs(line, '1E')) return undefined;
    const armed = line.slice(4, 12);
    const armUp = line.slice(12, 20);
    const alarm = line.slice(20, 28);
    if (!/^[0-6]{8}$/.test(armed) || !/^[0-6]{8}$/.test(armUp)) return undefined;
    if (!/^[0-9:;<=>?@ABU]{8}$/.test(alarm)) return undefined;
    const areas = new Map();
    for (let i = 0; i < 8; i += 1) {
      areas.set(i + 1, { armed: armed[i], armUp: armUp[i], alarm: alarm[i] });
    }
    return { areas };
  },
  /** AZ: the alarm of each zone ('0': none). */
  AZ(line) {
    if (!lengthIs(line, 'D6')) return undefined;
    const text = line.slice(4, 4 + LIMITS.maxZones);
    if (!/^[0-9:;<=>?@A-I]{208}$/.test(text)) return undefined;
    const alarms = new Set();
    for (let i = 0; i < text.length; i += 1) if (text[i] !== '0') alarms.add(i + 1);
    return { alarms };
  },
  /** ZS: logical and physical status of each zone. */
  ZS(line) {
    if (!lengthIs(line, 'D6')) return undefined;
    const text = line.slice(4, 4 + LIMITS.maxZones);
    if (!/^[0-9A-F]{208}$/.test(text)) return undefined;
    const zones = new Map();
    for (let i = 0; i < text.length; i += 1) zones.set(i + 1, zoneStatus(text[i]));
    return { zones };
  },
  /** ZC: one zone changed. */
  ZC(line) {
    if (!lengthIs(line, '0A')) return undefined;
    const zone = digits(line.slice(4, 7));
    if (zone === undefined || zone < 1 || zone > LIMITS.maxZones) return undefined;
    if (!/^[0-9A-F]$/.test(line[7])) return undefined;
    return { zone, status: zoneStatus(line[7]) };
  },
  /** ZP: the area of each zone (0: none). */
  ZP(line) {
    if (!lengthIs(line, 'D6')) return undefined;
    const text = line.slice(4, 4 + LIMITS.maxZones);
    if (!/^[0-8]{208}$/.test(text)) return undefined;
    const areas = new Map();
    for (let i = 0; i < text.length; i += 1) areas.set(i + 1, Number(text[i]));
    return { areas };
  },
  /** CS: every output. */
  CS(line) {
    if (!lengthIs(line, 'D6')) return undefined;
    const text = line.slice(4, 4 + LIMITS.maxOutputs);
    if (!/^[01]{208}$/.test(text)) return undefined;
    const outputs = new Map();
    for (let i = 0; i < text.length; i += 1) outputs.set(i + 1, text[i] === '1');
    return { outputs };
  },
  /** CC: one output changed. */
  CC(line) {
    if (!lengthIs(line, '0A')) return undefined;
    const output = digits(line.slice(4, 7));
    if (output === undefined || output < 1 || output > LIMITS.maxOutputs) return undefined;
    if (line[7] !== '0' && line[7] !== '1') return undefined;
    return { output, on: line[7] === '1' };
  },
  /** SS: the system troubles (34 positions at least). */
  SS(line) {
    const text = line.slice(4, -2);
    if (text.length < 34 || text.length > 64) return undefined;
    const active = TROUBLES.filter(([at]) => text[at] !== '0').map(([, key]) => key);
    return { troubles: active };
  },
  /** VN: versions of the M1 and of the M1XEP. */
  VN(line) {
    const text = line.slice(4, 16);
    if (!/^[0-9A-Fa-f]{12}$/.test(text)) return undefined;
    const v = (from) =>
      [0, 2, 4].map((at) => Number.parseInt(text.slice(from + at, from + at + 2), 16)).join('.');
    return { m1: v(0), xep: v(6) };
  },
  /** LW: temperatures of the keypads and of zones 1 to 16 (-60: no sensor). */
  LW(line) {
    const text = line.slice(4, 100);
    if (!/^\d{96}$/.test(text)) return undefined;
    const zones = new Map();
    for (let i = 0; i < 16; i += 1) {
      const value = Number(text.slice(48 + 3 * i, 51 + 3 * i)) - 60;
      zones.set(i + 1, value > -60 ? value : undefined);
    }
    return { zones };
  },
  /** ST: one temperature (group 0 zone, 1 keypad, 2 thermostat). */
  ST(line) {
    const group = digits(line.slice(4, 5));
    const device = digits(line.slice(5, 7));
    const raw = digits(line.slice(7, 10));
    if (group === undefined || device === undefined || raw === undefined) return undefined;
    const offset = group === 0 ? 60 : group === 1 ? 40 : 0;
    return { group, device, temperature: raw - offset };
  },
  /** TR: the data of one thermostat. */
  TR(line) {
    if (!lengthIs(line, '13')) return undefined;
    const text = line.slice(4, 17);
    if (!/^\d{13}$/.test(text)) return undefined;
    const thermostat = Number(text.slice(0, 2));
    const mode = THERMOSTAT_MODES[Number(text[2])];
    if (thermostat < 1 || thermostat > LIMITS.maxThermostats || mode === undefined) {
      return undefined;
    }
    return {
      thermostat,
      mode,
      hold: text[3] === '1',
      fan: text[4] === '1' ? 'on' : 'auto',
      temperature: Number(text.slice(5, 7)),
      heat: Number(text.slice(7, 9)),
      cool: Number(text.slice(9, 11)),
      humidity: Number(text.slice(11, 13)),
    };
  },
  /**
   * IC: a user code entered (keypad or command). The code digits are in it:
   * this message is never logged. User 0: the code is not a valid one.
   */
  IC(line) {
    const raw = line.slice(4, 16);
    const user = digits(line.slice(16, 19));
    if (!/^\d{12}$/.test(raw) || user === undefined) return undefined;
    const code = /^(0\d){6}$/.test(raw) ? raw.replace(/0(\d)/g, '$1') : raw;
    return { code, user };
  },
  /** RP: the ElkRP programming software is connected (1, 2) or not (0). */
  RP(line) {
    const status = digits(line.slice(4, 6));
    if (status === undefined || status > 2) return undefined;
    return { status };
  },
  /** SD: the text description of a unit (unit 0: none left). */
  SD(line) {
    if (!lengthIs(line, '1B')) return undefined;
    const type = digits(line.slice(4, 6));
    const unit = digits(line.slice(6, 9));
    if (type === undefined || unit === undefined) return undefined;
    const first = line.charCodeAt(9) & 0x7f;
    const text = (String.fromCharCode(first) + line.slice(10, 25))
      // Printable characters only: a name is shown in Gladys.
      .replace(/[^\x20-\x7e]/g, ' ')
      .trim();
    return { type, unit, name: text };
  },
  /** XK: the Ethernet test of the M1XEP, every 30 s: the link is alive. */
  XK() {
    return {};
  },
  /** EE: entry or exit timer; the AS that follows carries the state. */
  EE() {
    return {};
  },
};

/** One hex digit of ZS / ZC -> { logical, physical }. */
export function zoneStatus(char) {
  const value = Number.parseInt(char, 16);
  return { logical: ZONE_LOGICAL[(value >> 2) & 3], physical: ZONE_PHYSICAL[value & 3] };
}

/** Decodes a valid line: { code, value } (value undefined: malformed or not used). */
export function decode(code, line) {
  const decoder = Object.hasOwn(DECODERS, code) ? DECODERS[code] : undefined;
  if (!decoder) return { code, value: undefined, known: false };
  return { code, value: decoder(line), known: true };
}

/**
 * The state of one area from its AS entry: { mode, armed, ready, exit,
 * entry, alarm (kind or undefined), level }.
 */
export function areaStatus(entry) {
  if (!entry) return { mode: 'unknown', known: false };
  const armedMode = ARMED_STATUS[entry.armed] ?? 'unknown';
  const exit = entry.armUp === ARM_UP.exitTimer;
  const entryDelay = entry.alarm === '1';
  let mode = armedMode;
  if (armedMode !== 'disarmed' && entryDelay) mode = 'entry_delay';
  else if (armedMode !== 'disarmed' && exit) mode = 'arming';
  return {
    known: armedMode !== 'unknown',
    mode,
    armedMode,
    armed: armedMode !== 'disarmed' && armedMode !== 'unknown',
    exit,
    ready: entry.armUp === ARM_UP.ready,
    notReady: entry.armUp === ARM_UP.notReady,
    alarm: ALARM_STATE[entry.alarm],
    level: PROTECTION[armedMode] ?? 0,
  };
}
