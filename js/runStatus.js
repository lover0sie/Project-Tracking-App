import { db, doc, onSnapshot } from "./firebase.js";
import { state, saveState } from "./state.js";
import { el, renderStopwatch, startStopwatch, stopStopwatch, showScanStatus, syncStatusButtons } from "./ui.js";

let unsubscribe = null;
let watchedPath = null;
let generation = 0;
let lastStatus = null;

function epochMs(value) {
  return Number(value?.toMillis?.() ?? value ?? 0) || 0;
}

// Elapsed time is reconstructed from the saved duration and the current running segment.
export function getRunDurationMs(run) {
  const base = Number(run.durationMs);
  if (Number.isFinite(base) && base >= 0) return base;
  if (run.status === "running") return 0;
  const start = epochMs(run.resumedEpochMs || run.resumedAt || run.startEpochMs || run.startAt);
  const end = epochMs(run.holdEpochMs || run.holdAt || run.endEpochMs || run.endAt);
  return start && end ? Math.max(0, end - start) : 0;
}

// Server-confirmed status is applied without another hold being written to Firestore.
export function applyRunStatus(run, notify = true) {
  const previousStatus = lastStatus;
  lastStatus = run?.status || "missing";

  stopStopwatch();
  state.runAccumMs = run ? getRunDurationMs(run) : 0;
  state.resumeRunStatus = run?.status || null;
  state.resumeProcessName = run?.processName || null;
  state.resumeLocked = !!run && ["running", "on_hold"].includes(run.status);
  state.startLockedByStatus = false;

  if (run?.status === "running") {
    const owner = String(run.resumedByNumber || run.startedByNumber || "").trim();
    const me = String(state.employeeData?.employeeNumber || "").trim();
    if (owner && owner !== me) {
      state.startLockedByStatus = true;
      showScanStatus("This process is running under another operator. Timer stopped in this session.", "info");
    } else {
      const start = epochMs(run.resumedEpochMs || run.resumedAt || run.startEpochMs || run.startAt);
      state.runAccumMs += start ? Math.max(0, Date.now() - start) : 0;
      startStopwatch();
      if (notify && previousStatus !== "running") showScanStatus("Firestore status is RUNNING. Timer continued.", "ok");
    }
  } else {
    // Open confirmations are dismissed when the run is no longer running.
    el("holdModal")?.classList.add("hidden");
    el("completeModal")?.classList.add("hidden");
    if (run?.status === "on_hold") {
      if (notify && previousStatus !== "on_hold" && !state.runWriteInFlight) {
        const reason = run.holdReason ? ` Reason: ${run.holdReason}.` : "";
        // Historical auto-stop fields are ignored unless they identify the current hold.
        const autoStopMs = epochMs(run.autoStopAtEpochMs);
        const isAutoHold = run.autoStopped === true && autoStopMs > 0 &&
          autoStopMs === epochMs(run.holdEpochMs) &&
          ["scheduled_auto_stop", "auto_stop"].includes(run.autoStopSource);
        const label = isAutoHold ? "Auto hold" : "On hold";
        showScanStatus(`${label}: Firestore status is ON HOLD. Timer paused.${reason} Press Start to resume.`, "info");
      }
    } else {
      state.startLockedByStatus = true;
      if (notify) showScanStatus(run?.status === "completed"
        ? "This process is COMPLETED. Timer stopped."
        : "The run is missing or its status is unavailable. Timer stopped.", "info");
    }
  }

  renderStopwatch();
  saveState();
  syncStatusButtons();
}

// One listener is retained for the current run, and the previous listener is detached on context changes.
export function syncRunStatusListener(force = false) {
  const path = state.chillerSerialNumber && state.currentRunId
    ? `processRuns/${state.chillerSerialNumber}/runs/${state.currentRunId}`
    : null;
  if (!force && path === watchedPath) return;
  unsubscribe?.();
  unsubscribe = null;
  watchedPath = path;
  lastStatus = null;
  const currentGeneration = ++generation;
  state.runStatusPending = !!path;
  if (!path) return;

  unsubscribe = onSnapshot(doc(db, path), { includeMetadataChanges: true }, snapshot => {
    if (currentGeneration !== generation) return;
    // Cached data and unconfirmed local writes are excluded from status reconciliation.
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
    state.runStatusPending = false;
    applyRunStatus(snapshot.exists() ? snapshot.data() : null);
  }, error => {
    if (currentGeneration !== generation) return;
    console.error("Run status listener failed:", error);
    stopStopwatch();
    state.runStatusPending = true;
    showScanStatus("Live status could not be monitored. Timer paused. Reconnect or refresh before continuing.", "err");
    syncStatusButtons();
  });
}
