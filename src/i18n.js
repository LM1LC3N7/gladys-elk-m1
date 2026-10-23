// -----------------------------------------------------------------------------
// Names and messages, French and English.
// -----------------------------------------------------------------------------

export const word = (entry, language) => entry?.[language] ?? entry?.en ?? '';

/** An entry whose values are functions -> the entry of their results. */
export const fill = (entry, ...args) =>
  Object.fromEntries(
    Object.entries(entry).map(([lang, value]) => [
      lang,
      typeof value === 'function' ? value(...args) : value,
    ]),
  );

export const DEVICE_NAMES = {
  panel: { fr: 'Centrale ELK M1', en: 'ELK M1 panel' },
  area: { fr: (n) => `Secteur ${n}`, en: (n) => `Area ${n}` },
  zone: { fr: (n) => `Zone ${n}`, en: (n) => `Zone ${n}` },
  output: { fr: (n) => `Sortie ${n}`, en: (n) => `Output ${n}` },
  thermostat: { fr: (n) => `Thermostat ${n}`, en: (n) => `Thermostat ${n}` },
};

export const FEATURE_NAMES = {
  online: { fr: 'Centrale connectée', en: 'Panel connected' },
  trouble: { fr: 'Défaut en cours', en: 'Trouble' },
  'ac-fail': { fr: 'Coupure secteur', en: 'AC power failure' },
  'low-battery': { fr: 'Batterie de la centrale faible', en: 'Panel battery low' },
  troubles: { fr: 'Défauts', en: 'Troubles' },
  mode: { fr: 'État', en: 'State' },
  armed: { fr: 'Armé', en: 'Armed' },
  ready: { fr: 'Prêt à armer', en: 'Ready to arm' },
  alarm: { fr: 'Alarme en cours', en: 'Alarm in progress' },
  'fire-alarm': { fr: 'Alarme incendie', en: 'Fire alarm' },
  'arm-away': { fr: 'Armement total', en: 'Arm away' },
  'arm-stay': { fr: 'Armement partiel', en: 'Arm stay' },
  'arm-night': { fr: 'Armement nuit', en: 'Arm night' },
  disarm: { fr: 'Désarmer', en: 'Disarm' },
  kind: {
    opening: { fr: 'Ouverture', en: 'Opening' },
    motion: { fr: 'Mouvement', en: 'Motion' },
    smoke: { fr: 'Fumée', en: 'Smoke' },
    leak: { fr: "Fuite d'eau", en: 'Water leak' },
    temperature: { fr: 'Température', en: 'Temperature' },
  },
  'zone-trouble': { fr: 'Défaut', en: 'Trouble' },
  bypass: { fr: 'Exclue', en: 'Bypassed' },
  'zone-alarm': { fr: 'Alarme', en: 'Alarm' },
  state: { fr: 'Active', en: 'On' },
  'turn-on': { fr: 'Activer', en: 'Turn on' },
  'turn-off': { fr: 'Désactiver', en: 'Turn off' },
  temperature: { fr: 'Température', en: 'Temperature' },
  humidity: { fr: 'Humidité', en: 'Humidity' },
  'heat-setpoint': { fr: 'Consigne de chauffage', en: 'Heating setpoint' },
  'cool-setpoint': { fr: 'Consigne de refroidissement', en: 'Cooling setpoint' },
  'thermostat-mode': { fr: 'Mode', en: 'Mode' },
  hold: { fr: 'Maintien', en: 'Hold' },
};

/** The text of the read-only state feature of an area. */
export const MODE_NAMES = {
  disarmed: { fr: 'Désarmé', en: 'Disarmed' },
  arming: { fr: 'Armement en cours', en: 'Arming' },
  entry_delay: { fr: "Délai d'entrée", en: 'Entry delay' },
  armed_away: { fr: 'Armé (total)', en: 'Armed (away)' },
  armed_stay: { fr: 'Armé (partiel)', en: 'Armed (stay)' },
  armed_night: { fr: 'Armé (nuit)', en: 'Armed (night)' },
  armed_vacation: { fr: 'Armé (vacances)', en: 'Armed (vacation)' },
  unknown: { fr: 'Inconnu', en: 'Unknown' },
};

export const THERMOSTAT_MODE_NAMES = {
  off: { fr: 'Arrêt', en: 'Off' },
  heat: { fr: 'Chauffage', en: 'Heat' },
  cool: { fr: 'Refroidissement', en: 'Cool' },
  auto: { fr: 'Automatique', en: 'Auto' },
  emergency_heat: { fr: 'Chauffage de secours', en: 'Emergency heat' },
};

export const TROUBLE_NAMES = {
  ac_fail: { fr: 'coupure secteur', en: 'AC failure' },
  box_tamper: { fr: 'autoprotection du coffret', en: 'box tamper' },
  fail_to_communicate: { fr: 'échec de transmission', en: 'failure to communicate' },
  eeprom_error: { fr: 'erreur de mémoire EEPROM', en: 'EEPROM memory error' },
  low_battery: { fr: 'batterie de la centrale faible', en: 'control low battery' },
  transmitter_low_battery: { fr: "pile faible d'un émetteur", en: 'transmitter low battery' },
  over_current: { fr: 'surintensité', en: 'over current' },
  telephone_fault: { fr: 'défaut de ligne téléphonique', en: 'telephone fault' },
  output_2: { fr: 'sortie 2', en: 'output 2' },
  missing_keypad: { fr: 'clavier absent', en: 'missing keypad' },
  zone_expander: { fr: "module d'extension de zones", en: 'zone expander' },
  output_expander: { fr: "module d'extension de sorties", en: 'output expander' },
  remote_access: { fr: 'accès à distance ElkRP', en: 'ElkRP remote access' },
  common_area_not_armed: { fr: 'secteur commun non armé', en: 'common area not armed' },
  flash_memory_error: { fr: 'erreur de mémoire flash', en: 'flash memory error' },
  security_alert: { fr: 'alerte de sécurité', en: 'security alert' },
  serial_port_expander: { fr: 'module de port série', en: 'serial port expander' },
  lost_transmitter: { fr: 'émetteur perdu', en: 'lost transmitter' },
  smoke_clean_me: { fr: 'détecteur de fumée à nettoyer', en: 'smoke detector to clean' },
  ethernet: { fr: 'Ethernet', en: 'Ethernet' },
  fire: { fr: 'incendie', en: 'fire' },
};

const nothing = { fr: " : rien n'a été envoyé.", en: ': nothing was sent.' };

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));

/** Connection status and command messages. */
export const T = {
  noHost: {
    en: 'Enter the address of the M1XEP Ethernet module of the panel in the configuration.',
    fr: "Saisissez l'adresse du module Ethernet M1XEP de la centrale dans la configuration.",
  },
  noUsername: {
    en: 'The secure port needs the user name and the password of the M1XEP (set in ElkRP): enter them in the configuration, or choose the non-secure port.',
    fr: "Le port sécurisé demande le nom d'utilisateur et le mot de passe du M1XEP (réglés dans ElkRP) : saisissez-les dans la configuration, ou choisissez le port non sécurisé.",
  },
  pinInvalid: {
    en: 'The certificate fingerprint must be a SHA-256 fingerprint (64 hexadecimal digits, colons allowed), or empty.',
    fr: "L'empreinte du certificat doit être une empreinte SHA-256 (64 chiffres hexadécimaux, deux-points permis), ou vide.",
  },
  noArea: {
    en: 'Enter at least one area (1 to 8) in the configuration.',
    fr: 'Saisissez au moins un secteur (1 à 8) dans la configuration.',
  },
  connecting: {
    en: 'Connecting to the ELK M1 panel…',
    fr: 'Connexion à la centrale ELK M1…',
  },
  stillConnecting: {
    en: 'The connection to the panel is still in progress: try again in a few seconds.',
    fr: 'La connexion à la centrale est encore en cours : réessayez dans quelques secondes.',
  },
  waiting: {
    en: (ms) => `Waiting before connecting to the panel again: next try in ${seconds(ms)} s.`,
    fr: (ms) =>
      `Attente avant de se reconnecter à la centrale : nouvel essai dans ${seconds(ms)} s.`,
  },
  connected: {
    en: (version, areas, zones) =>
      `Connected to the ELK M1 panel${version ? ` (M1 ${version})` : ''}: ${areas}; ${zones} zone(s).`,
    fr: (version, areas, zones) =>
      `Connecté à la centrale ELK M1${version ? ` (M1 ${version})` : ''} : ${areas} ; ${zones} zone(s).`,
  },
  codeStopped: {
    en: ' The panel refused the user code: commands stopped until the code is changed or "Allow a new try of the code" is clicked.',
    fr: ' La centrale a refusé le code utilisateur : commandes arrêtées jusqu’à un changement du code ou un clic sur « Autoriser un nouvel essai du code ».',
  },
  programming: {
    en: ' ElkRP is connected to the panel (remote programming): no command meanwhile.',
    fr: ' ElkRP est connecté à la centrale (programmation à distance) : aucune commande pendant ce temps.',
  },
  unreachable: {
    en: (reason, ms) => `ELK M1 panel unreachable (${reason}), next try in ${seconds(ms)} s.`,
    fr: (reason, ms) =>
      `Centrale ELK M1 injoignable (${reason}), nouvel essai dans ${seconds(ms)} s.`,
  },
  silent: {
    en: (ms) =>
      `The M1XEP accepts the connection but the panel does not answer: check the port, the connection kind (TLS 1.2, TLS 1.0 or non-secure) and that no other software holds it. Next try in ${seconds(ms)} s.`,
    fr: (ms) =>
      `Le M1XEP accepte la connexion mais la centrale ne répond pas : vérifiez le port, le type de connexion (TLS 1.2, TLS 1.0 ou non sécurisée) et qu'aucun autre logiciel ne l'occupe. Nouvel essai dans ${seconds(ms)} s.`,
  },
  certificateChanged: {
    en: (fingerprint) =>
      `The TLS certificate of the M1XEP is not the one Gladys knows (a new module, a reset, or another machine at this address). The password was not sent, and nothing is sent until you vouch for it, whatever you save. Its SHA-256 fingerprint: ${fingerprint}. If it is the one of your M1XEP, press "Trust the new certificate" twice, or type it in the fingerprint field.`,
    fr: (fingerprint) =>
      `Le certificat TLS du M1XEP n’est pas celui que Gladys connaît (nouveau module, réinitialisation, ou autre machine à cette adresse). Le mot de passe n’a pas été envoyé, et rien ne l’est tant que vous ne le validez pas, quoi que vous enregistriez. Son empreinte SHA-256 : ${fingerprint}. Si c’est celle de votre M1XEP, appuyez deux fois sur « Faire confiance au nouveau certificat », ou saisissez-la dans le champ de l’empreinte.`,
  },
  certificateNotTyped: {
    en: (fingerprint) =>
      `The TLS certificate of the M1XEP is not the one whose fingerprint you typed. The password was not sent. The M1XEP shows: ${fingerprint}. If it is the right one, type it in the fingerprint field (or empty the field and press "Trust the new certificate" twice).`,
    fr: (fingerprint) =>
      `Le certificat TLS du M1XEP n’est pas celui dont vous avez saisi l’empreinte. Le mot de passe n’a pas été envoyé. Le M1XEP présente : ${fingerprint}. Si c’est le bon, saisissez-la dans le champ de l’empreinte (ou videz le champ et appuyez deux fois sur « Faire confiance au nouveau certificat »).`,
  },
  loginRefused: {
    en: 'The M1XEP refused the user name or the password: the integration stopped and will not try again by itself. Change them in the configuration, or press "Test the connection" for one new try.',
    fr: "Le M1XEP a refusé le nom d'utilisateur ou le mot de passe : l'intégration s'est arrêtée et ne réessaiera pas d'elle-même. Changez-les dans la configuration, ou appuyez sur « Tester la connexion » pour un nouvel essai.",
  },
  offline: {
    en: `The panel is not connected${nothing.en}`,
    fr: `La centrale n'est pas connectée${nothing.fr}`,
  },
  noCode: {
    en: `Enter a user code in the configuration to control the alarm${nothing.en}`,
    fr: `Saisissez un code utilisateur dans la configuration pour piloter l'alarme${nothing.fr}`,
  },
  badCode: {
    en: `The user code of the configuration must be 4 to 6 digits${nothing.en}`,
    fr: `Le code utilisateur de la configuration doit compter 4 à 6 chiffres${nothing.fr}`,
  },
  codeRefusedBefore: {
    en: `The panel refused this user code before: change it in the configuration, or click "Allow a new try of the code"${nothing.en}`,
    fr: `La centrale a déjà refusé ce code utilisateur : changez-le dans la configuration, ou cliquez sur « Autoriser un nouvel essai du code »${nothing.fr}`,
  },
  disarmRefused: {
    en: `Disarming from Gladys is disabled in the configuration${nothing.en}`,
    fr: `Le désarmement depuis Gladys est désactivé dans la configuration${nothing.fr}`,
  },
  outputsRefused: {
    en: `Controlling the outputs from Gladys is disabled in the configuration${nothing.en}`,
    fr: `Le pilotage des sorties depuis Gladys est désactivé dans la configuration${nothing.fr}`,
  },
  inProgramming: {
    en: `ElkRP is connected to the panel (remote programming)${nothing.en}`,
    fr: `ElkRP est connecté à la centrale (programmation à distance)${nothing.fr}`,
  },
  armCovered: {
    en: `An arming at least as strong was just sent, or the area is already armed so${nothing.en}`,
    fr: `Un armement au moins aussi fort vient d'être envoyé, ou le secteur est déjà armé ainsi${nothing.fr}`,
  },
  otherMode: {
    en: `The area is already armed in another mode: disarm it first (the panel arms a disarmed area only)${nothing.en}`,
    fr: `Le secteur est déjà armé dans un autre mode : désarmez-le d'abord (la centrale n'arme qu'un secteur désarmé)${nothing.fr}`,
  },
  notReady: {
    en: `The area is not ready to arm (a zone is open or in trouble)${nothing.en}`,
    fr: `Le secteur n'est pas prêt à armer (une zone est ouverte ou en défaut)${nothing.fr}`,
  },
  uncertainAfterDisarm: {
    en: 'A disarm sent just before may still apply: the state is uncertain, it is read again in 2 s. Arm again if needed.',
    fr: "Un désarmement envoyé juste avant peut encore s'appliquer : l'état est incertain, il est relu dans 2 s. Réarmez si besoin.",
  },
  linkCut: {
    en: `The connection to the panel was cut before the command could be written${nothing.en}`,
    fr: `La connexion à la centrale a été coupée avant que la commande puisse être écrite${nothing.fr}`,
  },
  restarted: {
    en: `The connection to the panel restarted while the command was being prepared${nothing.en}`,
    fr: `La connexion à la centrale a redémarré pendant la préparation de la commande${nothing.fr}`,
  },
  stateUnknown: {
    en: `The current state could not be read from the panel${nothing.en}`,
    fr: `L'état actuel n'a pas pu être relu sur la centrale${nothing.fr}`,
  },
  tooLate: {
    en: `The panel answered too slowly to send the command in time${nothing.en}`,
    fr: `La centrale a répondu trop lentement pour envoyer la commande à temps${nothing.fr}`,
  },
  codeRefused: {
    en: (what) =>
      `The panel refused the user code (${what}). Commands are stopped until the code is changed or "Allow a new try of the code" is clicked.`,
    fr: (what) =>
      `La centrale a refusé le code utilisateur (${what}). Les commandes sont arrêtées jusqu'à un changement du code ou un clic sur « Autoriser un nouvel essai du code ».`,
  },
  unconfirmed: {
    en: (what) =>
      `Sent to the panel (${what}), without confirmation in time: the state is read again in 2 s.`,
    fr: (what) =>
      `Envoyée à la centrale (${what}), sans confirmation dans les temps : l'état est relu dans 2 s.`,
  },
  commandBusy: {
    en: `Other commands took all the time of this one before its turn came${nothing.en}`,
    fr: `D'autres commandes ont pris tout le temps de celle-ci avant son tour${nothing.fr}`,
  },
  disarmWithdrawn: {
    en: `An arming of this area was asked while this disarming waited its turn${nothing.en}`,
    fr: `Un armement de ce secteur a été demandé pendant que ce désarmement attendait son tour${nothing.fr}`,
  },
  unknownArea: {
    en: (value) => `Area ${value} is not in the configuration${nothing.en}`,
    fr: (value) => `Le secteur ${value} n'est pas dans la configuration${nothing.fr}`,
  },
  unknownOutput: {
    en: (value) => `Output ${value} is not in the configuration${nothing.en}`,
    fr: (value) => `La sortie ${value} n'est pas dans la configuration${nothing.fr}`,
  },
  codeNotStopped: {
    en: 'The user code is not stopped: nothing to allow.',
    fr: "Le code utilisateur n'est pas arrêté : rien à autoriser.",
  },
  codeRetryAllowed: {
    en: 'The next command will send the user code again (once). Nothing was sent now.',
    fr: "La prochaine commande enverra de nouveau le code utilisateur (une fois). Rien n'a été envoyé maintenant.",
  },
  trustNothing: {
    en: 'No other certificate was met: nothing to trust.',
    fr: "Aucun autre certificat n'a été rencontré : rien à valider.",
  },
  trustTyped: {
    en: (fingerprint) =>
      `The fingerprint field holds another fingerprint: type ${fingerprint} there, or empty it, then save and press the button again.`,
    fr: (fingerprint) =>
      `Le champ de l’empreinte en contient une autre : saisissez-y ${fingerprint}, ou videz-le, puis enregistrez et appuyez de nouveau.`,
  },
  trustConfirm: {
    en: (fingerprint) =>
      `Press again within 60 s to trust the certificate ${fingerprint} (compare it with the one of your M1XEP first).`,
    fr: (fingerprint) =>
      `Appuyez de nouveau dans les 60 s pour faire confiance au certificat ${fingerprint} (comparez-le d'abord avec celui de votre M1XEP).`,
  },
  trustDone: {
    en: (fingerprint) => `Certificate ${fingerprint} trusted: connecting.`,
    fr: (fingerprint) => `Certificat ${fingerprint} validé : connexion en cours.`,
  },
};

/** What a command does, for the logs and the messages. */
export const COMMAND_NAMES = {
  armed_away: { en: (n) => `arm away area ${n}`, fr: (n) => `armement total du secteur ${n}` },
  armed_stay: {
    en: (n) => `arm stay area ${n}`,
    fr: (n) => `armement partiel du secteur ${n}`,
  },
  armed_night: { en: (n) => `arm night area ${n}`, fr: (n) => `armement nuit du secteur ${n}` },
  disarmed: { en: (n) => `disarm area ${n}`, fr: (n) => `désarmement du secteur ${n}` },
  'turn-on': { en: (n) => `turn on output ${n}`, fr: (n) => `activation de la sortie ${n}` },
  'turn-off': {
    en: (n) => `turn off output ${n}`,
    fr: (n) => `désactivation de la sortie ${n}`,
  },
};
