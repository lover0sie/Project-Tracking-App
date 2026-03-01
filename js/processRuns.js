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
  getAllPrevProcessNames,
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

export async function findOnHoldRun(serialNumber, station, processName) {
  const q = query(
    collection(db, "processRuns"),
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

export async function findActiveRun(serialNumber, station, processName) {
  const q = query(
    collection(db, "processRuns"),
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

export async function hasCompletedProcess(serialNumber, processName) {
  const q = query(
    collection(db, "processRuns"),
    where("serialNumber", "==", serialNumber),
    where("processName", "==", processName),
    where("status", "==", "completed"),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

export function applyResumeRunToUI(runDoc) {
  state.currentRunId = runDoc.id;

  state.runRunning = false;
  state.runStartEpoch = 0;
  state.runAccumMs = Number(runDoc.durationMs || 0);

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

export async function startOrResumeRun() {
  const processName = document.getElementById("processSelect")?.value;

  if (state.startInFlight || state.runRunning) return;
  if (!state.employeeData) return showScanStatus("Scan employee QR first.", "err");
  if (!state.vesselData) return showScanStatus("Scan project QR first.", "err");
  if (!processName) return showScanStatus("Please select a process before starting.", "err");
  
  const startBtn = el("btnStartProcess");
  const stopBtn = el("btnStopProcess");
  const holdBtn = el("btnHoldProcess");
  const processSel = el("processSelect");
  if (!startBtn || !processSel) return;

  const originalStartText = startBtn.textContent;

  state.startInFlight = true;
  syncStatusButtons();

  try {
    const serialNumber = state.vesselData.serialNumber;
    const station = state.employeeData.station;
    const processName = processSel.value;
    const runDate = getMYDateKey();

    // 1) Block if already running
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      showScanStatus("This process is already running.", "err");
      state.startLockedByStatus = true;
      syncStatusButtons();
      return;
    }

    // 2) Resume first if UI already loaded an on-hold run
    if (state.resumeRunStatus === "on_hold" && state.currentRunId) {
      startBtn.textContent = "Starting...";
      showScanStatus("Resuming process...", "info");

      if (state.resumeProcessName && processSel.value !== state.resumeProcessName) {
        processSel.value = state.resumeProcessName;
      }
      processSel.disabled = true;
      state.resumeLocked = true;

      await updateDoc(doc(db, "processRuns", state.currentRunId), {
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

    // 5) Prerequisite check (previous processes must be completed)
    startBtn.textContent = "Starting...";
    showScanStatus("Starting process...", "info");

    const prevList = getAllPrevProcessNames(station, processName);
    for (const p of prevList) {
      const ok = await hasCompletedProcess(serialNumber, p);
      if (!ok) {
        showScanStatus(`Cannot start. Please complete: ${p} first.`, "err");
        return;
      }
    }

    // 6) New run
    processSel.disabled = true;
    state.resumeLocked = false;

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

    const ref = await addDoc(collection(db, "processRuns"), payload);
    state.currentRunId = ref.id;
    saveState();

    if (stopBtn) stopBtn.disabled = false;
    if (holdBtn) holdBtn.disabled = false;

    state.runAccumMs = 0;
    startStopwatch();
    showScanStatus("Process is running.", "ok");

  } catch (err) {
    console.error(err);
    showScanStatus("Failed to start/resume process. Please try again.", "err");
  } finally {
    state.startInFlight = false;
    startBtn.textContent = originalStartText;
    syncStatusButtons();
  }
}

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
    await updateDoc(doc(db, "processRuns", state.currentRunId), {
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

export async function holdRunAndReset(reason, remarks, setStepFn, resetAllDataFn, hideOverlayFn, showOverlayFn) {
  if (!state.currentRunId) return;

  const durationMs = getElapsedMs();
  stopStopwatch();

  showOverlayFn?.("Saving (On Hold)...");

  try {
    await updateDoc(doc(db, "processRuns", state.currentRunId), {
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