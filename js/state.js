export const STATE_KEY = "qrAppState_v1";

export const state = {
  // QR scanner
  html5Qr: null,
  scanning: false,

  vesselData: null,
  employeeData: null,

  // Process run state
  currentRunId: null,
  runStartEpoch: 0,
  runTimer: null,
  runRunning: false,
  runAccumMs: 0,

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
  startInFlight: false
};

// Station -> processes
export const PROCESS_BY_STATION = {
  "PV 1": [
    "6 - Hole bevelling",
    "7 - Connector welding",
    "8 - Fitting internal plate and GMAW C&B",
    "9 - Fitting and welding distribution box",
    "10 - Tube support and bush fitting, tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding",
    "13 - Unit side plate and base welding",
    "14 - Tube slotting and expansion"
  ],

  "PV 2": [
    "6 - Hole bevelling",
    "7 - Connector welding",
    "8 - Fitting internal plate and GMAW C&B",
    "9 - Fitting and welding distribution box",
    "10 - Tube support and bush fitting, tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding",
    "13 - Unit side plate and base welding",
    "14 - Tube slotting and expansion"
  ]
};

// Vessel -> processes
export const PROCESS_BY_VESSEL = {
  "EVAPORATOR": [
    "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate and GMAW C&B",
    "9, 10, 11 - Distribution box, tube support and bush, tubesheet fitting and welding",
    "12, 13 - Bracket, attachment, side plate, and base fitting and welding and copper tube brazing",
    "14 - Tube slotting and expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer (weld seam) and top painting"
  ],

   "CONDENSER": [
    "6, 7, 8 - Hole bevelling, connector welding, fitting internal plate and GMAW C&B",
    "9, 10, 11 - Distribution box, tube support and bush, tubesheet fitting and welding",
    "12, 13 - Bracket, attachment, side plate, and base fitting and welding and copper tube brazing",
    "14 - Tube slotting and expansion",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer (weld seam) and top coat painting"
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


// clean up vessel type
export function getVesselTypeKey(vesselData) {
  const raw =
    (typeof vesselData === "string"
      ? vesselData
      : (vesselData?.vesselType || vesselData?.type || "")
    );

  return raw.trim().toUpperCase();
}
export function getVesselTypeFromPvSerial(pvSerial = "") {
  const suffix = pvSerial.trim().slice(-1).toUpperCase();
  const map = { E: "EVAPORATOR", C: "CONDENSER", J: "ECONOMIZER", Y: "OIL SEPARATOR" };
  return map[suffix] || "UNKNOWN";
}

export function getAllPrevProcessNames(station, currentProcessName) {
  const list = PROCESS_BY_STATION[station] || [];
  const idx = list.indexOf(currentProcessName);
  if (idx <= 0) return [];
  return list.slice(0, idx);
}

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

export function shouldIgnoreDuplicate(text, windowMs = 1200) {
  const now = Date.now();
  const same = text === state.lastDecodedText && (now - state.lastDecodedAt) < windowMs;
  state.lastDecodedText = text;
  state.lastDecodedAt = now;
  return same;
}

export function formatMs(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function getElapsedMs() {
  if (!state.runRunning) return state.runAccumMs;
  return state.runAccumMs + (Date.now() - state.runStartEpoch);
}

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
    selectedProcessName: state.selectedProcessName
  };

  // user session storage instead of localstorage
  sessionStorage.setItem(STATE_KEY, JSON.stringify(snapshot)); 
}

export function loadState() {
  const raw = sessionStorage.getItem(STATE_KEY);
  if (!raw) return;

  try {
    const s = JSON.parse(raw);

    state.currentStep = s.currentStep || "employee";
    state.employeeData = s.employeeData || null;
    state.vesselData = s.vesselData || null;

    state.currentRunId = s.currentRunId || null;
    state.runRunning = !!s.runRunning;
    state.runStartEpoch = s.runStartEpoch || 0;
    state.runAccumMs = s.runAccumMs || 0;

    state.resumeLocked = !!s.resumeLocked;
    state.resumeRunStatus = s.resumeRunStatus || null;
    state.resumeProcessName = s.resumeProcessName || null;
    
    state.selectedProcessName = s.selectedProcessName || null;
  } catch (e) {
    console.error("State load failed", e);
    sessionStorage.removeItem(STATE_KEY);
  }
}