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

// Vessel -> processes
export const PROCESS_BY_PV = {
  "EVAPORATOR": [
    "6 - Hole bevelling",
    "7 - Connector welding",
    "8A - Fitting internal plate",
    "8B - GMAW C&B",
    "9 - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

   "CONDENSER": [
    "6 - Hole bevelling",
    "7 - Connector welding",
    "8A - Fitting internal plate",
    "8B - GMAW C&B",
    "9 - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

  "OIL SEPARATOR":[
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

  "ECONOMIZER":[
    "6, 7 - Hole bevelling and connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ]
}

// CHILLER -> processes
export const PROCESS_BY_CHILLER = {
  "AIR-COOLED": [
    "Piping shop",
  ],
  "WATER-COOLED": [
    "Piping shop",
  ]
};

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

// A vessel type is inferred from the suffix of a PV serial number.
export function getVesselTypeFromPvSerial(pvSerial = "") {
  const suffix = pvSerial.trim().slice(-1).toUpperCase();
  const map = { E: "EVAPORATOR", C: "CONDENSER", J: "ECONOMIZER", Y: "OIL SEPARATOR" };
  return map[suffix] || "UNKNOWN";
}

// All process names before the current process are returned for ordering checks.
export function getAllPrevProcessNames(currentProcessName) {
  const kind = (state.vesselData?.qrKind || state.activeScope || "").toUpperCase();

  let list = [];
  if (kind === "PV") {
    const vesselKey = getVesselTypeKey(state.vesselData?.vesselType);
    list = PROCESS_BY_PV[vesselKey] || [];
  } else if (kind === "CHILLER") {
    const coolKey = getVesselTypeKey(state.vesselData?.coolingType);
    list = PROCESS_BY_CHILLER[coolKey] || [];
  }

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
