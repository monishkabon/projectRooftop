// ─── utils/transformers.js ───────────────────────────────────────────
// Pure functions to clean raw ADSB.lol API v2 aircraft objects
// into the custom JSON shapes the frontend components expect.
// ─────────────────────────────────────────────────────────────────────

// ─── ICAO type code → human-readable aircraft name ──────────────────
const AIRCRAFT_NAMES = {
  'C130': 'LOCKHEED C-130 HERCULES',
  'C17':  'BOEING C-17 GLOBEMASTER III',
  'C5M':  'LOCKHEED C-5M SUPER GALAXY',
  'F16':  'GENERAL DYNAMICS F-16 FALCON',
  'F15':  'MCDONNELL DOUGLAS F-15 EAGLE',
  'F18':  'BOEING F/A-18 HORNET',
  'F22':  'LOCKHEED MARTIN F-22 RAPTOR',
  'F35':  'LOCKHEED MARTIN F-35 LIGHTNING',
  'B52':  'BOEING B-52 STRATOFORTRESS',
  'B1':   'ROCKWELL B-1 LANCER',
  'B2':   'NORTHROP GRUMMAN B-2 SPIRIT',
  'E3TF': 'BOEING E-3 SENTRY (AWACS)',
  'E6B':  'BOEING E-6B MERCURY',
  'KC10': 'MCDONNELL DOUGLAS KC-10 EXTENDER',
  'KC46': 'BOEING KC-46 PEGASUS',
  'K35R': 'BOEING KC-135 STRATOTANKER',
  'P8':   'BOEING P-8 POSEIDON',
  'C30J': 'LOCKHEED C-130J SUPER HERCULES',
  'A10':  'FAIRCHILD A-10 THUNDERBOLT II',
  'V22':  'BELL BOEING V-22 OSPREY',
  'H60':  'SIKORSKY UH-60 BLACK HAWK',
  'B738': 'BOEING 737-800',
  'B739': 'BOEING 737-900',
  'B737': 'BOEING 737-700',
  'B77W': 'BOEING 777-300ER',
  'B772': 'BOEING 777-200',
  'B788': 'BOEING 787-8 DREAMLINER',
  'B789': 'BOEING 787-9 DREAMLINER',
  'B744': 'BOEING 747-400',
  'B748': 'BOEING 747-8',
  'A320': 'AIRBUS A320',
  'A321': 'AIRBUS A321',
  'A319': 'AIRBUS A319',
  'A332': 'AIRBUS A330-200',
  'A333': 'AIRBUS A330-300',
  'A339': 'AIRBUS A330-900NEO',
  'A359': 'AIRBUS A350-900',
  'A35K': 'AIRBUS A350-1000',
  'A388': 'AIRBUS A380-800',
  'A20N': 'AIRBUS A320NEO',
  'A21N': 'AIRBUS A321NEO',
  'E190': 'EMBRAER E190',
  'E195': 'EMBRAER E195',
  'E75L': 'EMBRAER E175',
  'CRJ9': 'BOMBARDIER CRJ-900',
  'CRJ7': 'BOMBARDIER CRJ-700',
  'DH8D': 'DE HAVILLAND DASH 8-400',
  'AT76': 'ATR 72-600',
  'GLF6': 'GULFSTREAM G650',
  'GL5T': 'BOMBARDIER GLOBAL 5500',
  'LJ35': 'LEARJET 35',
  'LJ31': 'LEARJET 31',
  'C172': 'CESSNA 172 SKYHAWK',
  'C208': 'CESSNA 208 CARAVAN',
  'PC12': 'PILATUS PC-12',
  'BE20': 'BEECHCRAFT SUPER KING AIR 200',
};

/**
 * Look up a human-readable aircraft name from an ICAO type code.
 * Falls back to the raw code in uppercase if not found.
 */
export function lookupAircraftName(typeCode) {
  if (!typeCode) return 'UNKNOWN';
  const upper = typeCode.trim().toUpperCase();
  return AIRCRAFT_NAMES[upper] || upper;
}

// ─── Formatting Helpers ─────────────────────────────────────────────

/**
 * Format barometric altitude.
 * The API may return a number (feet) or the string "ground".
 */
export function formatAltitude(altBaro) {
  if (altBaro == null) return 'N/A';
  if (typeof altBaro === 'string' && altBaro.toLowerCase() === 'ground') return 'GND';
  return `${Math.round(altBaro)}ft`;
}

/**
 * Map RSSI (dBFS, always negative) to a 0-100% signal strength string.
 * Typical range is roughly -50 dBFS (very strong) to -30 dBFS (minimum usable).
 * We clamp and normalise into a percentage.
 */
export function formatRSSI(rssi) {
  if (rssi == null) return 'N/A';
  // rssi is negative; closer to 0 = stronger
  // Typical range: -49.5 (max) to about -30 (weak threshold)
  const clamped = Math.max(-50, Math.min(0, rssi));
  const pct = Math.round(((clamped + 50) / 50) * 100);
  return `${pct}%`;
}

/**
 * Format decimal lat/lon into a display string like '51.5074° N, 0.1278° W'.
 */
export function formatLatLon(lat, lon) {
  if (lat == null || lon == null) return 'N/A';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

/**
 * Check if a squawk code is an emergency code.
 */
export function isEmergencySquawk(squawk) {
  return ['7500', '7600', '7700'].includes(squawk);
}

/**
 * Derive a human-readable emergency/flight status string.
 * Priority: emergency field from ADS-B > squawk code inference > default.
 */
export function deriveEmergencyStatus(squawk, emergency) {
  // The API 'emergency' field is the most authoritative
  if (emergency && emergency !== 'none') {
    const map = {
      general:   'GENERAL_EMERGENCY',
      lifeguard: 'LIFEGUARD',
      minfuel:   'MINIMUM_FUEL',
      nordo:     'RADIO_FAILURE',
      unlawful:  'UNLAWFUL_INTERFERENCE',
      downed:    'DOWNED_AIRCRAFT',
      reserved:  'RESERVED',
    };
    return map[emergency] || emergency.toUpperCase();
  }

  // Fall back to squawk code interpretation
  if (squawk === '7700') return 'GENERAL_EMERGENCY';
  if (squawk === '7600') return 'RADIO_FAILURE';
  if (squawk === '7500') return 'HIJACK';

  return 'EN_ROUTE';
}

/**
 * Determine if an aircraft is military based on dbFlags bitfield.
 * Bit 0 (& 1) = military.
 */
export function isMilitary(dbFlags) {
  return !!(dbFlags && (dbFlags & 1));
}

// ─── Main Transformers ──────────────────────────────────────────────

/**
 * Transform a raw ADSB aircraft object into the SquawkEntry shape
 * used by the frontend SquawkEntry component.
 */
export function transformToSquawkEntry(ac) {
  return {
    id:              ac.hex,
    squawkCode:      ac.squawk || '0000',
    callsign:        (ac.flight || 'UNKNOWN').trim(),
    type:            ac.t || 'UNKN',
    squawkTime:      new Date().toLocaleTimeString('en-GB', { hour12: false }),
    altitude:        formatAltitude(ac.alt_baro),
    signalStrength:  formatRSSI(ac.rssi),
    heading:         String(Math.round(ac.track ?? ac.mag_heading ?? 0)).padStart(3, '0'),
    latLong:         formatLatLon(ac.lat, ac.lon),
    lat:             ac.lat,
    lon:             ac.lon,
    status:          deriveEmergencyStatus(ac.squawk, ac.emergency),
  };
}

/**
 * Transform a raw ADSB aircraft object into the RadarBlip shape
 * used by the frontend radar page. Includes real lat/lon for
 * coordinate-based positioning.
 */
export function transformToRadarBlip(ac) {
  return {
    id:          ac.hex,
    aircraft:    lookupAircraftName(ac.t),
    category:    isMilitary(ac.dbFlags) ? 'Military' : 'Civilian',
    isEmergency: isEmergencySquawk(ac.squawk),
    lat:         ac.lat ?? null,
    lon:         ac.lon ?? null,
  };
}

/**
 * Transform a raw ADSB aircraft object into the FlightDetail shape
 * used by the flight details popup in MyRadar.
 */
export function transformToFlightDetail(ac) {
  return {
    id:          ac.hex,
    aircraft:    lookupAircraftName(ac.t),
    category:    isMilitary(ac.dbFlags) ? 'Military' : 'Civilian',
    callsign:    (ac.flight || 'UNKNOWN').trim(),
    squawkCode:  ac.squawk || '0000',
    altitude:    formatAltitude(ac.alt_baro),
    speed:       ac.gs != null ? `${Math.round(ac.gs)} kts` : 'N/A',
    heading:     ac.track != null ? `${Math.round(ac.track)}°` : 'N/A',
    origin:      'N/A',       // ADS-B does not transmit origin/destination
    destination: 'N/A',
    status:      deriveEmergencyStatus(ac.squawk, ac.emergency),
    fuelLevel:   'N/A',       // not available from ADS-B
    registration: ac.r || 'N/A',
    lat:         ac.lat ?? null,
    lon:         ac.lon ?? null,
  };
}
