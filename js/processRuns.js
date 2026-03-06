import {
  db,
  collection,
  query,
  where,
  getDocs,
  limit,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp
} from "./firebase.js";

import {
  state,
  saveState,
  getMYDateKey,
  getElapsedMs
} from "./state.js";

import {
  el,
  showScanStatus,
  renderStopwatch,
  syncStatusButtons,
  startStopwatch,
  stopStopwatch
} from "./ui.js";


// The Firestore runs subcollection reference is resolved for the active chiller key.
function runsCol() {
  if (!state.chillerSerialNumber) throw new Error("Missing state.chillerSerialNumber");
  return collection(db, "processRuns", state.chillerSerialNumber, "runs");
}

// The Firestore document reference is resolved for a specific run id.
export function runDoc(runId) {
  if (!state.chillerSerialNumber) throw new Error("Missing state.chillerSerialNumber");
  return doc(db, "processRuns", state.chillerSerialNumber, "runs", runId);
}

// The first matching on-hold run is queried for a serial, station, and process.
export async function findOnHoldRun(serialNumber, station, processName) {
  const q = query(
    runsCol(),
    where("serialNumber", "==", serialNumber),
    where("station", "==", station),
    where("processName", "==", processName),
    where("status", "==", "on_hold"),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// The first matching active running run is queried for a serial, station, and process.
export async function findActiveRun(serialNumber, station, processName) {
  const q = query(
    runsCol(),
    where("serialNumber", "==", serialNumber),
    where("station", "==", station),
    where("processName", "==", processName),
    where("status", "==", "running"),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// Completion status is checked for a serial and process pair.
export async function hasCompletedProcess(serialNumber, processName) {
  const q = query(
    runsCol(),
    where("serialNumber", "==", serialNumber),
    where("processName", "==", processName),
    where("status", "==", "completed"),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

// On-hold run data is projected into local state and status UI.
export function applyResumeRunToUI(runDoc) {
  state.currentRunId = runDoc.id;

  state.runRunning = false;
  state.runStartEpoch = 0;

  const fromDocDuration = Number(runDoc.durationMs || 0);
  const fromTimestamps =
    (runDoc.startEpochMs && runDoc.holdEpochMs)
      ? (runDoc.holdEpochMs - runDoc.startEpochMs)
      : 0;

  state.runAccumMs = fromDocDuration || fromTimestamps || 0;

  state.resumeLocked = true;
  state.resumeRunStatus = "on_hold";
  state.resumeProcessName = runDoc.processName;

  const procSel = el("processSelect");
  if (procSel) {
    procSel.value = runDoc.processName;
    procSel.disabled = true;
  }

  renderStopwatch();
  saveState();

  showScanStatus(
    `Found ON HOLD: "${runDoc.processName}". Time loaded. Press Start to resume.`,
    "info"
  );

  syncStatusButtons();
}

// Local runtime is reconnected to an existing active run owned by the same operator.
export function reconnectToRunning(active) {
  // Who owns the running process?
  const lastEmp = String(active.resumedByNumber || active.startedByNumber || "").trim();
  const me = String(state.employeeData.employeeNumber || "").trim();

  // If not same operator -> do not reconnect
  if (lastEmp && lastEmp !== me) return false;

  state.currentRunId = active.id;

  // Compute elapsed NOW from Firestore timestamps:
  // base durationMs may be 0 if you only write it on hold/complete (that's OK)
  const base = Number(active.durationMs || 0);
  const startPoint = Number(active.resumedEpochMs || active.startEpochMs || 0);
  const elapsedNow = startPoint ? base + (Date.now() - startPoint) : base;

  // Set local state so UI continues from elapsedNow
  state.runAccumMs = elapsedNow;
  state.runStartEpoch = Date.now();   // from now onward
  state.runRunning = false;           // so startStopwatch() will start cleanly
  state.autoHoldSent = false;

  startStopwatch(); // starts ticking
  saveState();
  syncStatusButtons();

  showScanStatus("Reconnected to your running process.", "ok");
  return true;
}

// A run is started, resumed, or blocked based on current Firestore and UI state.
export async function startOrResumeRun() {
  if (!state.chillerSerialNumber) {
    return showScanStatus("Missing chiller serial number. Scan PV/Chiller QR again.", "err");
  }
  if (state.startInFlight || state.runRunning) return;
  if (!state.employeeData) return showScanStatus("Scan employee QR first.", "err");
  if (!state.vesselData) return showScanStatus("Scan project QR first.", "err");

  const processSel = el("processSelect");
  const processName = processSel?.value || "";
  if (!processName) return showScanStatus("Please select a process before starting.", "err");

  const startBtn = el("btnStartProcess");
  const stopBtn = el("btnStopProcess");
  const holdBtn = el("btnHoldProcess");
  if (!startBtn || !processSel) return;

  const originalStartText = startBtn.textContent;

  state.startInFlight = true;
  syncStatusButtons();

  try {
    const serialNumber = state.vesselData.serialNumber;
    const station = state.employeeData.station;
    const runDate = getMYDateKey();

    // 1) Block if already running
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      const lastEmp = String(active.resumedByNumber || active.startedByNumber || "").trim();
      const me = String(state.employeeData.employeeNumber || "").trim();

      //  Running by YOU -> reconnect and show elapsed
      if (lastEmp && lastEmp === me) {
        reconnectToRunning(active);
        return;
      }

      //  Running by someone else -> show info + block Start
      state.currentRunId = active.id;
      state.startLockedByStatus = true;
      state.resumeLocked = false; // allow selecting other processes

      const whoName = active.resumedByName || active.startedByName || "Unknown";
      const whoNo   = active.resumedByNumber || active.startedByNumber || "-";
      const verb    = active.resumedByName ? "Resumed by" : "Started by";

      // IMPORTANT: do NOT zero out timer here. Just show 00:00:00 by not running it.
      state.runRunning = false;
      if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }
      state.runStartEpoch = 0;
      state.runAccumMs = 0;

      renderStopwatch();
      showScanStatus(`This process is already RUNNING. ${verb}: ${whoName} (${whoNo}).`, "err");

      saveState();
      syncStatusButtons();
      return;
    }

    // 2) Resume first if UI already loaded an on-hold run
    if (state.resumeRunStatus === "on_hold" && state.currentRunId) {
      startBtn.textContent = "Starting...";
      showScanStatus("Resuming process...", "info");
      
      // arm auto-hold for this resumed run
      state.autoHoldSent = false;

      if (state.resumeProcessName && processSel.value !== state.resumeProcessName) {
        processSel.value = state.resumeProcessName;
      }
      processSel.disabled = true;
      state.resumeLocked = true;

    await updateDoc(runDoc(state.currentRunId), {
      status: "running",
      resumedAt: serverTimestamp(),
      resumedEpochMs: Date.now(),
      resumedByName: state.employeeData.employeeName,
      resumedByNumber: state.employeeData.employeeNumber
    });

      if (stopBtn) stopBtn.disabled = false;
      if (holdBtn) holdBtn.disabled = false;

      startStopwatch();
      showScanStatus("Process resumed (running).", "ok");
      saveState();
      return;
    }

    // 3) If not loaded yet, check DB for ON HOLD and load it
    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (onHold) {
      applyResumeRunToUI(onHold);
      showScanStatus("Loaded ON HOLD run. Press Start to resume.", "info");
      return;
    }

    // 4) Block if completed
    const completed = await hasCompletedProcess(serialNumber, processName);
    if (completed) {
      state.startLockedByStatus = true;
      showScanStatus("This process is already COMPLETED. Start is blocked.", "err");
      syncStatusButtons();
      return;
    }

    // 6) New run
    processSel.disabled = true;
    state.resumeLocked = false;

    // arm auto-hold for this new run
    state.autoHoldSent = false;

    const v = state.vesselData;

    const payload = {
      serialNumber,
      station,
      processName,
      runDate,
      status: "running",
      startedByName: state.employeeData.employeeName,
      startedByNumber: state.employeeData.employeeNumber,
      manpower: state.employeeData.manpower,
      startAt: serverTimestamp(),
      startEpochMs: Date.now(),
      projectName: v.projectName,
      materialNumber: v.materialNumber,
      description: v.description,
      version: v.version,

      // vessel QR fields
      qrKind: v.qrKind || "UNKNOWN",
      chillerSerialNumber: v.chillerSerialNumber || null,
      pvSerialNumber: v.pvSerialNumber || null,
      vesselType: v.vesselType || null,
      partNumber: v.partNumber || null,
      partDescription: v.partDescription || null,
      model: v.model || null,
      refrigerant: v.refrigerant || null
    };


    const ref = await addDoc(runsCol(), payload);
    state.currentRunId = ref.id;

    if (stopBtn) stopBtn.disabled = false;
    if (holdBtn) holdBtn.disabled = false;

    state.runAccumMs = 0;
    startStopwatch();
    showScanStatus("Process is running.", "ok");

    saveState();

  } catch (err) {
    console.error(err);
    showScanStatus("Failed to start/resume process. Please try again.", "err");
  } finally {
    state.startInFlight = false;
    startBtn.textContent = originalStartText;
    syncStatusButtons();
  }
}

// A running process is completed in Firestore and local UI/state is reset.
export async function completeRunAndReset(setStepFn, resetAllDataFn, hideOverlayFn, showOverlayFn) {
  if (!state.currentRunId) {
    showScanStatus("No running process to complete.", "err");
    return;
  }
  if (!state.runRunning) {
    showScanStatus("Process is not running.", "err");
    return;
  }

  const durationMs = getElapsedMs();
  stopStopwatch();

  showOverlayFn?.("Saving (Completed)...");

  try {
      await updateDoc(runDoc(state.currentRunId), {
      status: "completed",
      endAt: serverTimestamp(),
      endEpochMs: Date.now(),
      durationMs
    });

    showOverlayFn?.("Process completed", true);

    setTimeout(async () => {
      hideOverlayFn?.();
      resetAllDataFn?.();
      state.startLockedByStatus = false;
      await setStepFn?.("employee");
      syncStatusButtons();
    }, 900);

  } catch (err) {
    console.error(err);
    hideOverlayFn?.();
    showScanStatus("Failed to complete process. Try again.", "err");
  }
}

// A running process is saved as on-hold in Firestore and local UI/state is reset.
export async function holdRunAndReset(reason, remarks, setStepFn, resetAllDataFn, hideOverlayFn, showOverlayFn) {
  if (!state.currentRunId) return;

  const durationMs = getElapsedMs();
  stopStopwatch();

  showOverlayFn?.("Saving (On Hold)...");

  try {
    await updateDoc(runDoc(state.currentRunId), {
      status: "on_hold",
      holdAt: serverTimestamp(),
      holdEpochMs: Date.now(),
      durationMs,
      holdReason: reason,
      remarks
    });

    showOverlayFn?.("Saved as On Hold", true);

    setTimeout(async () => {
      hideOverlayFn?.();
      resetAllDataFn?.();
      await setStepFn?.("employee");
    }, 900);

  } catch (err) {
    console.error(err);
    hideOverlayFn?.();
    showScanStatus("Failed to save On Hold. Try again.", "err");
  }
}

