// -----------------------------------------------------------------------------
// The panel model -> Gladys devices and states (pure).
//
// Ids that do not depend on the address of the M1XEP (a new DHCP lease keeps
// the devices) and that the panel itself numbers; one panel per integration:
// - `panel:elk`: link, trouble, AC failure, panel battery low, the troubles
//   (text);
// - `area:<n>` (1 to 8): state (text), armed, ready to arm, alarm, fire alarm,
//   and the arm away / arm stay / arm night / disarm BUTTONS;
// - `zone:<n>` (1 to 208): one state feature keyed by the zone kind
//   (`:opening`, `:motion`, `:smoke`, `:leak` or `:temperature`), trouble,
//   bypassed, alarm;
// - `output:<n>` (1 to 208): its state (read-only), turn on / turn off BUTTONS;
// - `thermostat:<n>` (1 to 16), read-only: temperature, humidity, heating
//   and cooling setpoints, mode, hold.
//
// No command is a switch or a binary: a "turn everything off" (voice
// assistants, HomeKit, scenes on switches) must never reach the alarm or an
// output. The states are read-only, the commands are push buttons.
//
// A device published again never loses a feature the user created (Gladys
// would mark it changed, and "Update" would drop its history): the features
// of the created device that the configuration no longer gives are kept.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { OPENING_SENSOR_STATE } from './constants.js';
import { areaStatus } from './elk/protocol.js';
import {
  DEVICE_NAMES,
  FEATURE_NAMES,
  MODE_NAMES,
  THERMOSTAT_MODE_NAMES,
  TROUBLE_NAMES,
  word,
} from './i18n.js';

const binary = (category, type, history = true) => ({
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: history,
});

const text = {
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
  has_feedback: false,
  // A text history is not charted; the scene events are the history.
  keep_history: false,
};

const button = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

const temperature = (unit, category = C.TEMPERATURE_SENSOR, type = T.SENSOR.DECIMAL) => ({
  category,
  type,
  min: -40,
  max: unit === 'celsius' ? 70 : 160,
  unit: unit === 'celsius' ? U.CELSIUS : U.FAHRENHEIT,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

/** Feature definitions by key (the last part of their external id). Keys are forever. */
export const PANEL_FEATURES = {
  online: binary(C.INPUT, T.INPUT.BINARY),
  trouble: binary(C.INPUT, T.INPUT.BINARY),
  'ac-fail': binary(C.INPUT, T.INPUT.BINARY),
  'low-battery': binary(C.BATTERY_LOW, T.BATTERY_LOW.BINARY),
  troubles: text,
};

export const AREA_FEATURES = {
  mode: text,
  armed: binary(C.INPUT, T.INPUT.BINARY),
  ready: binary(C.INPUT, T.INPUT.BINARY),
  alarm: binary(C.SIREN, T.SIREN.BINARY),
  'fire-alarm': binary(C.SIREN, T.SIREN.BINARY),
  'arm-away': button,
  'arm-stay': button,
  'arm-night': button,
  disarm: button,
};

/** The state feature of a zone, by kind (the kind is also its feature key). */
export const zoneState = (kind, unit) =>
  ({
    opening: binary(C.OPENING_SENSOR, T.SENSOR.BINARY),
    motion: binary(C.MOTION_SENSOR, T.SENSOR.BINARY),
    smoke: binary(C.SMOKE_SENSOR, T.SENSOR.BINARY),
    leak: binary(C.LEAK_SENSOR, T.SENSOR.BINARY),
    temperature: temperature(unit),
  })[kind];

export const ZONE_FEATURES = {
  trouble: binary(C.INPUT, T.INPUT.BINARY),
  bypass: binary(C.INPUT, T.INPUT.BINARY),
  alarm: binary(C.SIREN, T.SIREN.BINARY),
};

const ZONE_FEATURE_NAMES = { trouble: 'zone-trouble', bypass: 'bypass', alarm: 'zone-alarm' };

export const OUTPUT_FEATURES = {
  state: binary(C.INPUT, T.INPUT.BINARY),
  'turn-on': button,
  'turn-off': button,
};

export const thermostatFeatures = (unit) => ({
  temperature: temperature(unit),
  humidity: {
    category: C.HUMIDITY_SENSOR,
    type: T.SENSOR.DECIMAL,
    min: 0,
    max: 100,
    unit: U.PERCENT,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  },
  // Read-only in this version: the setpoints are shown, never written.
  'heat-setpoint': temperature(unit, C.THERMOSTAT, T.THERMOSTAT.TARGET_TEMPERATURE),
  'cool-setpoint': temperature(unit, C.THERMOSTAT, T.THERMOSTAT.TARGET_TEMPERATURE),
  'thermostat-mode': text,
  hold: binary(C.INPUT, T.INPUT.BINARY),
});

export const ids = {
  panel: (gladys) => gladys.externalIds('panel', 'elk'),
  area: (gladys, n) => gladys.externalIds('area', String(n)),
  zone: (gladys, n) => gladys.externalIds('zone', String(n)),
  output: (gladys, n) => gladys.externalIds('output', String(n)),
  thermostat: (gladys, n) => gladys.externalIds('thermostat', String(n)),
};

/** `ext:sel:area:1:arm-away` -> { kind: 'area', number: 1, key: 'arm-away' }. */
export function parseFeatureId(externalId) {
  const match = /:(panel|area|zone|output|thermostat):([a-z0-9]+):([a-z-]+)$/.exec(
    String(externalId ?? ''),
  );
  if (!match) return undefined;
  return {
    kind: match[1],
    number: match[1] === 'panel' ? undefined : Number(match[2]),
    key: match[3],
  };
}

const feature = (deviceIds, key, name, definition) => ({
  name,
  external_id: deviceIds.feature(key),
  ...definition,
});

/** The kind of a zone: the configured one, else an opening. */
export const zoneKind = (config, n) => config.zones.get(n) ?? 'opening';

/** What a discovered feature declares (a created one also has ids, values, dates). */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'unit',
];

/** Adds to each device the features of its created twin it no longer has. */
export function keepCreatedFeatures(devices, created = []) {
  const byId = new Map((created ?? []).map((device) => [device.external_id, device]));
  return devices.map((device) => {
    const twin = byId.get(device.external_id);
    if (!twin?.features?.length) return device;
    const have = new Set(device.features.map((f) => f.external_id));
    const kept = twin.features
      .filter((f) => f?.external_id && !have.has(f.external_id))
      .map((f) =>
        Object.fromEntries(
          FEATURE_FIELDS.filter((key) => f[key] !== undefined && f[key] !== null).map((key) => [
            key,
            f[key],
          ]),
        ),
      );
    return kept.length === 0 ? device : { ...device, features: [...device.features, ...kept] };
  });
}

/** The name the panel gives (ElkRP), else ours. */
const nameOf = (model, kind, n, language) =>
  model?.names?.[kind]?.get(n) || word(DEVICE_NAMES[kind], language)(n);

export function buildDevices(gladys, config, model, created = gladys.devices) {
  const { language } = config;
  const unit = config.temperatureUnit;
  const make = (deviceIds, name, features, params = []) => ({
    name,
    external_id: deviceIds.device,
    should_poll: false,
    params,
    features: Object.entries(features).map(([key, definition]) =>
      feature(deviceIds, key, word(FEATURE_NAMES[key], language), definition),
    ),
  });
  const devices = [make(ids.panel(gladys), word(DEVICE_NAMES.panel, language), PANEL_FEATURES)];
  for (const n of config.areas) {
    devices.push(
      make(ids.area(gladys, n), nameOf(model, 'area', n, language), AREA_FEATURES, [
        { name: 'area', value: String(n) },
      ]),
    );
  }
  for (const n of config.zones.keys()) {
    const zoneIds = ids.zone(gladys, n);
    const kind = zoneKind(config, n);
    devices.push({
      name: nameOf(model, 'zone', n, language),
      external_id: zoneIds.device,
      should_poll: false,
      params: [
        { name: 'zone', value: String(n) },
        { name: 'kind', value: kind },
      ],
      features: [
        feature(zoneIds, kind, word(FEATURE_NAMES.kind[kind], language), zoneState(kind, unit)),
        ...Object.entries(ZONE_FEATURES).map(([key, definition]) =>
          feature(zoneIds, key, word(FEATURE_NAMES[ZONE_FEATURE_NAMES[key]], language), definition),
        ),
      ],
    });
  }
  for (const n of config.outputs) {
    devices.push(
      make(ids.output(gladys, n), nameOf(model, 'output', n, language), OUTPUT_FEATURES, [
        { name: 'output', value: String(n) },
      ]),
    );
  }
  for (const n of config.thermostats) {
    devices.push(
      make(
        ids.thermostat(gladys, n),
        nameOf(model, 'thermostat', n, language),
        thermostatFeatures(unit),
        [{ name: 'thermostat', value: String(n) }],
      ),
    );
  }
  return keepCreatedFeatures(devices, created);
}

const flag = (value) => (value === undefined ? undefined : value ? 1 : 0);

/** A number within the bounds of its feature, else unknown (never a wrong value). */
const bounded = (value, definition) =>
  Number.isFinite(value) && value >= definition.min && value <= definition.max ? value : undefined;

/** The zone's active state: violated; a bypassed zone by its circuit; a troubled one unknown. */
export function zoneActive(status) {
  if (!status) return undefined;
  if (status.logical === 'violated') return true;
  if (status.logical === 'normal') return false;
  if (status.logical === 'bypassed') {
    if (status.physical === 'eol') return false;
    if (status.physical === 'open' || status.physical === 'short') return true;
  }
  return undefined;
}

/**
 * Every known state: `[{ device_feature_external_id, state | text }]`.
 * Offline, only the link: the rest is the last state seen, not the panel's.
 */
export function buildStates(gladys, config, model, { online }) {
  const states = [];
  const { language } = config;
  const unit = config.temperatureUnit;
  const push = (deviceIds, key, value) => {
    if (value === undefined) return;
    states.push({
      device_feature_external_id: deviceIds.feature(key),
      ...(typeof value === 'string' ? { text: value } : { state: value }),
    });
  };
  const panel = ids.panel(gladys);
  push(panel, 'online', online ? 1 : 0);
  if (!online) return states;
  if (model.troubles) {
    const troubles = model.troubles;
    push(panel, 'trouble', flag(troubles.length > 0));
    push(panel, 'ac-fail', flag(troubles.includes('ac_fail')));
    push(panel, 'low-battery', flag(troubles.includes('low_battery')));
    push(
      panel,
      'troubles',
      troubles.length === 0
        ? '-'
        : troubles.map((key) => word(TROUBLE_NAMES[key], language)).join(', '),
    );
  }
  for (const n of config.areas) {
    const entry = model.areas?.get(n);
    if (!entry) continue;
    const status = areaStatus(entry);
    const areaIds = ids.area(gladys, n);
    push(areaIds, 'mode', word(MODE_NAMES[status.mode] ?? MODE_NAMES.unknown, language));
    push(areaIds, 'armed', flag(status.armed && !status.exit));
    push(areaIds, 'ready', flag(status.ready));
    push(areaIds, 'alarm', flag(status.alarm !== undefined));
    push(areaIds, 'fire-alarm', flag(status.alarm === 'fire'));
  }
  for (const n of config.zones.keys()) {
    const zoneIds = ids.zone(gladys, n);
    const kind = zoneKind(config, n);
    const status = model.zones?.get(n);
    if (kind === 'temperature') {
      push(zoneIds, kind, bounded(model.temperatures?.get(n), zoneState(kind, unit)));
    } else {
      const active = zoneActive(status);
      push(
        zoneIds,
        kind,
        active === undefined || kind !== 'opening'
          ? flag(active)
          : active
            ? OPENING_SENSOR_STATE.OPEN
            : OPENING_SENSOR_STATE.CLOSE,
      );
    }
    if (status) {
      push(zoneIds, 'trouble', flag(status.logical === 'troubled'));
      push(zoneIds, 'bypass', flag(status.logical === 'bypassed'));
    }
    if (model.zoneAlarms) push(zoneIds, 'alarm', flag(model.zoneAlarms.has(n)));
  }
  for (const n of config.outputs) {
    if (!model.outputs) break;
    push(ids.output(gladys, n), 'state', flag(model.outputs.get(n)));
  }
  const definitions = thermostatFeatures(unit);
  for (const n of config.thermostats) {
    const data = model.thermostats?.get(n);
    if (!data) continue;
    const thermostatIds = ids.thermostat(gladys, n);
    push(thermostatIds, 'temperature', bounded(data.temperature, definitions.temperature));
    // 0: no humidity sensor on this thermostat.
    push(
      thermostatIds,
      'humidity',
      data.humidity > 0 ? bounded(data.humidity, definitions.humidity) : undefined,
    );
    push(thermostatIds, 'heat-setpoint', bounded(data.heat, definitions['heat-setpoint']));
    push(thermostatIds, 'cool-setpoint', bounded(data.cool, definitions['cool-setpoint']));
    push(thermostatIds, 'thermostat-mode', word(THERMOSTAT_MODE_NAMES[data.mode], language));
    push(thermostatIds, 'hold', flag(data.hold));
  }
  return states;
}
