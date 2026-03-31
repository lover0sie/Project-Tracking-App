/* State model */

export const STATE_KEY = "qrAppState_v1";
const STATE_FALLBACK_KEY_PREFIX = "qrAppState_v1_fallback";
const FALLBACK_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TAB_NAME_PREFIX = "qrapp_tab_";
const TAB_ID_SESSION_KEY = "qrAppTabId";
const TAB_ID_HISTORY_KEY = "__qrAppTabId";
const TAB_ID_QUERY_PARAM = "tab";

let cachedTabId = null;

export const state = {
  // QR scanner
  html5Qr: null,
  scanning: false,

  employeeData: null,

   // NEW / clarified:
  chillerSerialNumber: null,     // e.g. K26C088 (parent key)
  vesselData: null,              // the currently scanned "project QR" (PV or CHILLER)
  activeScope: null,             // "PV" | "CHILLER" (based on last scanned project QR)

  selectedProcessName: null,

  // Process run state
  currentRunId: null,
  runStartEpoch: 0,
  runTimer: null,
  runRunning: false,
  runAccumMs: 0,
  scanStatusTimeout: null,

  // Steps: "employee" -> "project" -> "status"
  currentStep: "employee",

  // duplicate scan guard
  lastDecodedText: "",
  lastDecodedAt: 0,

  // local storage
  stateEnabled: true,

  // resume states
  resumeLocked: false,
  resumeRunStatus: null, // "on_hold" | null
  resumeProcessName: null,

  // locks
  startLockedByStatus: false,
  startInFlight: false,
  statusCheckInFlight: false
};

// Station -> vessel type -> processes 
export const PROCESS_BY_LINE = {
  "PV 1": {
    "EVAPORATOR": [
      "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate, and GMAW C&B",
      "9, 10, 11 - Fitting and welding distribution box, tube support, bush fitting, tubesheet fitting, and tubesheet welding",
      "12, 13 - Bracket and attachment welding, copper tube brazing, unit side plate, and base welding",
      "14 - Tube slotting and expansion"
    ],

    "CONDENSER": [
      "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate, and GMAW C&B",
      "10, 11 - Tube support, bush fitting, tubesheet fitting and tubesheet welding",
      "12, 13 - Bracket and attachment welding, copper tube brazing, unit side plate, and base welding",
      "14 - Tube slotting and expansion"
    ],
  },

  "PV 2": {
    "EVAPORATOR": [
      "6, 7 - Hole bevelling and connector welding",
      "12 - Bracket and attachment welding, copper tube brazing",
      "8A - Internal plate assembly",
      "8B - Internal plate fitting",
      "10 - Tube support, bush fitting and tubesheet fitting",
      "11 - Tubesheet welding",
      "14A - Tube slotting",
      "14B - Tube expansion"
    ],

    "CONDENSER": [
      "6, 7, 8, 10 - Hole bevelling, connector welding, internal plate assembly and fitting, tube support, bush fitting, and tubesheet fitting",
      "11 - Tubesheet welding",
      "12 - Bracket and attachment welding, copper tube brazing",
      "14A - Tube slotting",
      "14B - Tube expansion"
    ],

  },

  "Sub Assy": {
    "ECONOMIZER": [
      "6, 7 - Hole bevelling and connector welding",
      "8, 9, 10, 11 - Internal plate distribution box tube support and bush fitting and welding",
      "12 - Bracket and attachment fitting and welding",
    ],

    
    "OIL SEPARATOR": [
      "6, 7 - Hole bevelling and connector welding",
      "8, 9, 10, 11 - Internal plate distribution box tube support and bush fitting and welding",
      "12 - Bracket and attachment fitting and welding",
    ]
  },

   "Pneumatic": {
    "EVAPORATOR": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "17 - Hydrostatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ],
    
    "CONDENSER": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "17 - Hydrostatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ],

    "OIL SEPARATOR": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ],

    "ECONOMIZER": [
      "15 - Primer painting",
      "16 - Pneumatic testing",
      "18, 19 - Primer painting (weld seam) and top coat painting"
    ]
  }
};

// CHILLER -> processes
export const PROCESS_BY_CHILLER = {
  "Piping Shop": {
    "AIR-COOLED": [
      "Piping Shop"
    ],

    "WATER-COOLED":[
      "Piping Shop"
    ]
  },

  "WC 1": {
    "WATER-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

  "WC 2": {
    "WATER-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

   "AC 1": {
    "AIR-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

   "AC 2": {
    "AIR-COOLED": [
      "Major components assembly",
      "Steel pipe welding",
      "Copper pipe brazing",
      "Control and starter box wiring"
    ]
  },

  "Insulation 1": {
    "AIR-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ],

    "WATER-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ]
  },

  "Insulation 2": {
    "AIR-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ],

    "WATER-COOLED": [
      "Insulation 1",
      "Insulation 2"
    ]
  },

  "Packing": {
    "AIR-COOLED":[
      "Packing"
    ],

    "WATER-COOLED":[
      "Packing"
    ]
  }
  
};

// Allowed vessels to stations
export const STATION_ALLOWED_VESSELS = {
  "PV 1": ["EVAPORATOR", "CONDENSER"],
  "PV 2": ["EVAPORATOR", "CONDENSER"],
  "Sub Assy": ["ECONOMIZER", "OIL SEPARATOR"],
  "Pneumatic": [
    "EVAPORATOR",
    "CONDENSER",
    "ECONOMIZER",
    "OIL SEPARATOR"
  ]
};

export const STATION_ALLOWED_CHILLER_TYPES = {
  "Piping Shop": ["AIR-COOLED"],
  "WC 1": ["WATER-COOLED"],
  "WC 2": ["WATER-COOLED"],
  "AC 1": ["WATER-COOLED"],
  "AC 2": ["WATER-COOLED"],
  "Insulation 1": ["AIR-COOLED", "WATER-COOLED"],
  "Insulation 1": ["AIR-COOLED", "WATER-COOLED"],
  "Packing": ["AIR-COOLED", "WATER-COOLED"],
};

// A normalized station key to match with state.js (PROCESS_BY_LINE)
export function getStationKey(employeeData = state.employeeData){
  const raw = String(
    employeeData?.station ||
    employeeData?.lineStation ||
    employeeData?.processLine ||
    ""
  ).trim().toUpperCase();

  const map = {
    "PV1": "PV 1",
    "PV 1": "PV 1",
    "PV2": "PV 2",
    "PV 2": "PV 2",
    "SUBASSY" : "Sub Assy",
    "SUB ASSY": "Sub Assy",
    "PNEUMATIC": "Pneumatic"
  };

  return map[raw] || "";
}

// A normalized vessel type key is produced for process-map lookup.
export function getVesselTypeKey(v) {
  const raw =
    (typeof v === "string")
      ? v
      : (v?.vesselType || v?.type || "");

  return raw
    .trim()
    .toUpperCase()
    .replaceAll("_", " ");
}

// Get the station key and vessel key, and identify if the vessel allowed in the particular station
export function isStationAllowedForVessel(station, vesselType){
  const stationKey = getStationKey({station});
  const vesselKey = getVesselTypeKey(vesselType);

  if (!stationKey || !vesselKey) return false;

  const allowed = STATION_ALLOWED_VESSELS[stationKey];
  if (!allowed) return true; // optional: unknown station assigned to allow
  
  return allowed.includes(vesselKey);
}

// Get the station key and coolingType, and identify if the coolingType is allowed in the particular station
export function isStationAllowedForChiller(station, coolingType) {
  const stationKey = getStationKey({ station });
  const coolKey = getVesselTypeKey(coolingType);

  const allowed = STATION_ALLOWED_CHILLER_TYPES[stationKey];
  if (!allowed) return false;

  return allowed.includes(coolKey);
}

export function getAllowedVesselsForStation(station){
  const stationKey = getStationKey({station});
  return STATION_ALLOWED_VESSELS[stationKey] || [];
}

// A vessel type is inferred from the suffix of a PV serial number.
export function getVesselTypeFromPvSerial(pvSerial = "") {
  const suffix = pvSerial.trim().slice(-1).toUpperCase();
  const map = { E: "EVAPORATOR", C: "CONDENSER", J: "ECONOMIZER", Y: "OIL SEPARATOR" };
  return map[suffix] || "UNKNOWN";
}

export function getProcessListForCurrentSelection() {
  const kind = (state.vesselData?.qrKind || state.activeScope || "").toUpperCase();

  if (kind === "PV"){
    const stationKey = getStationKey(state.employeeData);
    const vesselKey = getVesselTypeKey(
      state.vesselData?.vesselType ||
      state.vesselData?.type ||
      getVesselTypeFromPvSerial(state.vesselData?.pvSerialNumber || "")
    )

    return PROCESS_BY_LINE[stationKey]?.[vesselKey] || [];
  }

  if (kind === "CHILLER") {
    const stationKey = getStationKey(state.employeeData);
    const coolKey = getVesselTypeKey(state.vesselData?.coolingType);
    return PROCESS_BY_CHILLER[stationKey]?.[coolKey] || [];
  }

  return [];
}

// All process names before the current process are returned for ordering checks.
export function getAllPrevProcessNames(currentProcessName) {
  const list = getProcessListForCurrentSelection();
  const idx = list.indexOf(currentProcessName);
  if (idx <= 0) return [];
  return list.slice(0, idx);
}

// A Malaysia-local date key is generated in YYYY-MM-DD format.
export function getMYDateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);

  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${day}`;
}

// The current Malaysia day range is returned as start/end Date objects.
export function getMYDayRange() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const y = Number(parts.find(p => p.type === "year").value);
  const m = Number(parts.find(p => p.type === "month").value);
  const d = Number(parts.find(p => p.type === "day").value);

  const myDateStr = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const start = new Date(`${myDateStr}T00:00:00+08:00`);
  const end = new Date(`${myDateStr}T24:00:00+08:00`);
  return { start, end, myDateStr };
}

// Repeated scans within a short window are detected and filtered.
export function shouldIgnoreDuplicate(text, windowMs = 1200) {
  const now = Date.now();
  const same = text === state.lastDecodedText && (now - state.lastDecodedAt) < windowMs;
  state.lastDecodedText = text;
  state.lastDecodedAt = now;
  return same;
}

// Elapsed milliseconds are formatted into HH:MM:SS text.
export function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Total elapsed runtime is computed from accumulated and active stopwatch state.
export function getElapsedMs() {
  if (!state.runRunning) return state.runAccumMs;
  return state.runAccumMs + (Date.now() - state.runStartEpoch);
}

// A session snapshot of important runtime state is persisted.
export function saveState() {
  if (!state.stateEnabled) return;

  const snapshot = {
    currentStep: state.currentStep,
    employeeData: state.employeeData,
    vesselData: state.vesselData,
    currentRunId: state.currentRunId,
    runRunning: state.runRunning,
    runStartEpoch: state.runStartEpoch,
    runAccumMs: state.runAccumMs,
    resumeLocked: state.resumeLocked,
    resumeRunStatus: state.resumeRunStatus,
    resumeProcessName: state.resumeProcessName,
    selectedProcessName: state.selectedProcessName,
    chillerSerialNumber: state.chillerSerialNumber,
    activeScope: state.activeScope,
    savedAtEpochMs: Date.now()
  };

  sessionStorage.setItem(STATE_KEY, JSON.stringify(snapshot));

  // iOS Safari can evict background tabs and lose sessionStorage.
  // Keep a short-lived per-tab localStorage fallback to restore workflow step and scanned data.
  try {
    localStorage.setItem(getFallbackStorageKey(), JSON.stringify(snapshot));
  } catch (_) {
    // Ignore storage quota/private-mode errors.
  }
}

// A saved session snapshot is restored into live runtime state.
export function loadState() {
  let raw = sessionStorage.getItem(STATE_KEY);
  let fromFallback = false;

  if (!raw) {
    raw = localStorage.getItem(getFallbackStorageKey());
    fromFallback = !!raw;
  }

  if (!raw) return;

  try {
    const s = JSON.parse(raw);
    const savedAtEpochMs = Number(s.savedAtEpochMs || 0);

    if (savedAtEpochMs && (Date.now() - savedAtEpochMs) > FALLBACK_MAX_AGE_MS) {
      clearPersistedState();
      return;
    }

    state.currentStep = s.currentStep || "employee";
    state.employeeData = s.employeeData || null;
    state.vesselData = s.vesselData || null;

    state.currentRunId = s.currentRunId || null;

    state.runAccumMs = Number(s.runAccumMs || 0);
    state.runRunning = !!s.runRunning;
    state.runStartEpoch = Number(s.runStartEpoch || 0);

    // Repair corrupted running state (prevents 492394:40:08 bug)
    if (state.runRunning && state.runStartEpoch <= 0) {
      state.runRunning = false;
      state.runStartEpoch = 0;
    }

    state.resumeLocked = !!s.resumeLocked;
    state.resumeRunStatus = s.resumeRunStatus || null;
    state.resumeProcessName = s.resumeProcessName || null;

    state.selectedProcessName = s.selectedProcessName || null;
    state.chillerSerialNumber = s.chillerSerialNumber || null;
    state.activeScope = s.activeScope || null;

    if (fromFallback) {
      // Restore into session and current-tab fallback for this lifecycle.
      sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
      try {
        localStorage.setItem(getFallbackStorageKey(), JSON.stringify(s));
      } catch (_) {
        // Ignore storage quota/private-mode errors.
      }
    }

  } catch (e) {
    console.error("State load failed", e);
    clearPersistedState();
  }
}

export function clearPersistedState() {
  sessionStorage.removeItem(STATE_KEY);
  try {
    localStorage.removeItem(getFallbackStorageKey());
  } catch (_) {
    // Ignore private-mode/localStorage access errors.
  }
}

function getFallbackStorageKey() {
  return `${STATE_FALLBACK_KEY_PREFIX}_${getTabId()}`;
}

function getTabId() {
  if (cachedTabId) return cachedTabId;

  try {
    const urlTabId = String(new URL(window.location.href).searchParams.get(TAB_ID_QUERY_PARAM) || "").trim();
    if (urlTabId) {
      cachedTabId = urlTabId;
      syncTabIdentity(urlTabId);
      return cachedTabId;
    }

    const sessionTabId = String(sessionStorage.getItem(TAB_ID_SESSION_KEY) || "").trim();
    if (sessionTabId) {
      cachedTabId = sessionTabId;
      syncTabIdentity(sessionTabId);
      return cachedTabId;
    }

    const historyTabId = String(window.history?.state?.[TAB_ID_HISTORY_KEY] || "").trim();
    if (historyTabId) {
      cachedTabId = historyTabId;
      syncTabIdentity(historyTabId);
      return cachedTabId;
    }

    const name = String(window.name || "").trim();
    if (name.startsWith(TAB_NAME_PREFIX)) {
      cachedTabId = name.slice(TAB_NAME_PREFIX.length);
      if (cachedTabId) {
        syncTabIdentity(cachedTabId);
        return cachedTabId;
      }
    }

    const generated =
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    cachedTabId = generated;
    syncTabIdentity(generated);
    return cachedTabId;
  } catch (_) {
    // Last-resort fallback if window access is restricted for any reason.
    cachedTabId = "default";
    return cachedTabId;
  }
}

function syncTabIdentity(tabId) {
  try {
    sessionStorage.setItem(TAB_ID_SESSION_KEY, tabId);
  } catch (_) {
    // Ignore restricted storage access.
  }

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(TAB_ID_QUERY_PARAM) !== tabId) {
      url.searchParams.set(TAB_ID_QUERY_PARAM, tabId);
    }

    const nextState = {
      ...(window.history?.state && typeof window.history.state === "object" ? window.history.state : {}),
      [TAB_ID_HISTORY_KEY]: tabId
    };
    window.history.replaceState(nextState, document.title, url.toString());
  } catch (_) {
    // Ignore history-state failures.
  }

  try {
    window.name = `${TAB_NAME_PREFIX}${tabId}`;
  } catch (_) {
    // Ignore window access failures.
  }
}
