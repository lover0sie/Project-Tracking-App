/* Main heart of the program */

import { updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { state, loadState, saveState, getElapsedMs } from "./state.js";
import {
  el,
  hideScanStatus,
  showScanStatus,
  updateStepper,
  loadProcessesForCurrentUnit,
  renderStopwatch,
  syncStatusButtons,
  openHoldModal,
  closeHoldModal,
  resetAllData,
  showSaveOverlay,
  hideSaveOverlay,
  startStopwatch
} from "./ui.js";

import { startScanner, stopScanner, updateScanButtonUI, onScanSuccess } from "./scanner.js";

import {
  findOnHoldRun,
  applyResumeRunToUI,
  hasCompletedProcess,
  startOrResumeRun,
  completeRunAndReset,
  holdRunAndReset,
  runDoc,
  findActiveRun,
  reconnectToRunning
} from "./processRuns.js";

const APP_VERSION = "2026-03-06-03"; 
let updateAvailable = false;
let latestVersion = APP_VERSION;

// Array of reason that require remarks
const reasonsRequireRemarks = [
  "rework",
  "item_missing",
  "item_shortage",
  "others"
];

// Functions to show updated code 

function showUpdateBanner() {
  el("updateBanner")?.classList.remove("hidden");
}

function hideUpdateBanner() {
  el("updateBanner")?.classList.add("hidden");
}

function canPromptForRefresh() {
  // Only show refresh prompt when user is not actively running a process
  return !state.runRunning;
}

async function checkForAppUpdate() {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, {
      cache: "no-store"
    });

    if (!res.ok) return;

    const data = await res.json();
    const serverVersion = String(data.version || "").trim();

    if (!serverVersion) return;

    latestVersion = serverVersion;

    if (serverVersion !== APP_VERSION) {
      updateAvailable = true;

      if (canPromptForRefresh()) {
        showUpdateBanner();
      }
    }
  } catch (e) {
    console.warn("Version check failed:", e);
  }
}


// A confirmation modal is prepared and opened before process completion is committed.
function openCompleteModal() {
  const processName =
    el("processSelect")?.value || state.selectedProcessName || "";

  const text = el("completeText");
  if (text) {
    text.textContent = processName
      ? `Are you sure "${processName}" is complete? This action cannot be undone.`
      : `Are you sure this process is complete? This action cannot be undone.`;
  }

  el("completeModal")?.classList.remove("hidden");
  setTimeout(() => el("completeConfirm")?.focus(), 0);
}

// The process-completion confirmation modal is hidden.
function closeCompleteModal() {
  el("completeModal")?.classList.add("hidden");
}

// A previously auto-held run is detected and resumed after page reload when allowed.
async function autoResumeAfterReload() {
  const pending = sessionStorage.getItem("pendingReload");
  if (!pending) return;

  // Clear flag ASAP so it doesn't auto-resume forever
  sessionStorage.removeItem("pendingReload");

  if (!state.employeeData || !state.vesselData) return;

  const procSel = el("processSelect");
  const processName = procSel?.value;
  if (!processName) return;

  const serialNumber = state.vesselData.serialNumber;
  const station = state.employeeData.station;

  try {
    // 1) If it's already running in DB, do nothing
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) return;

    // 2) If it's on_hold, auto-resume
    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (!onHold) return;

    // Only auto-resume if same employee
    const lastEmp = onHold.resumedByNumber || onHold.startedByNumber;
    if (lastEmp && lastEmp !== state.employeeData.employeeNumber) {
      // show classic UI instead of silent return
      applyResumeRunToUI(onHold);
      return;
    }

    // Only auto-resume if browser_closed
    if (onHold.holdReason && onHold.holdReason !== "browser_closed") {
      applyResumeRunToUI(onHold);
      return;
    }

    // Show classic message + load time
    applyResumeRunToUI(onHold);

    // (optional) small info message so user knows it's going to resume
    showScanStatus("Auto-resuming after refresh...", "info");

    // Update Firestore to running
    await updateDoc(runDoc(onHold.id), {
      status: "running",
      resumedAt: serverTimestamp(),
      resumedEpochMs: Date.now(),
      resumedByName: state.employeeData.employeeName,
      resumedByNumber: state.employeeData.employeeNumber
    });

    // Start stopwatch immediately
    state.autoHoldSent = false;
    startStopwatch();

    showScanStatus("Auto-resumed after refresh.", "ok");
    syncStatusButtons();
    saveState();
  } catch (e) {
    console.warn("autoResumeAfterReload failed:", e);
  }
}

// Screen visibility, scanner state, and status context are synchronized for the active step.
async function setStep(step) {
  hideScanStatus();
  state.currentStep = step;
  updateStepper(step);

  el("screen-employee")?.classList.toggle("hidden", step !== "employee");
  el("screen-project")?.classList.toggle("hidden", step !== "project");
  el("screen-status")?.classList.toggle("hidden", step !== "status");

  const inStatus = (step === "status");

  // hide scanner in Status
  el("reader")?.classList.toggle("hidden", inStatus);

  // disable/hide scan button in Status
  const scanBtn = el("start-scan");
  if (scanBtn) {
    scanBtn.disabled = inStatus;
    scanBtn.classList.toggle("hidden", inStatus);
  }

  if (inStatus) {
    if (state.vesselData) {
      loadProcessesForCurrentUnit();
    }

    //  restore selection BEFORE any DB checks
    const procSel = el("processSelect");
    if (procSel && state.selectedProcessName) {
        procSel.value = state.selectedProcessName;
    } else if (procSel) {
        // fallback: store whatever is currently selected (initial process)
        state.selectedProcessName = procSel.value || null;
        saveState();
    }

    await stopScanner();
    renderStopwatch();
    syncStatusButtons();

    if (!state.runRunning && !state.resumeLocked) {
      state.currentRunId = null;
      state.runAccumMs = 0;
      state.runStartEpoch = 0;
    }

    // show status top info
    if (state.employeeData) {
      el("statusStation") && (el("statusStation").innerText = state.employeeData.station || "-");
      el("statusManpower") && (el("statusManpower").innerText = state.employeeData.manpower ?? "-");
    }
   if (state.vesselData) {
    el("statusProject") && (el("statusProject").innerText = state.vesselData.projectName || "-");
    el("statusMaterial") && (el("statusMaterial").innerText = state.vesselData.materialNumber || "-");
    el("statusSerial") && (el("statusSerial").innerText = state.vesselData.serialNumber || "-");

    let displayType = "-";

    if (state.vesselData.qrKind === "CHILLER") {
      displayType = state.vesselData.coolingType || "-";
    } else if (state.vesselData.qrKind === "PV") {
      displayType = state.vesselData.vesselType || "-";
    }

    el("statusType") && (el("statusType").innerText = displayType);
  }

    // auto-check on hold for selected process
    if (state.employeeData && state.vesselData && procSel?.value) {
      const serialNumber = state.vesselData.serialNumber;
      const station = state.employeeData.station;
      const procSel = el("processSelect");
      const processName = procSel ? procSel.value : null;

      if (processName) {
        try {
          const onHold = await findOnHoldRun(serialNumber, station, processName);
          if (onHold) {
            applyResumeRunToUI(onHold);
          } else {
            state.resumeLocked = false;
            state.resumeRunStatus = null;
            syncStatusButtons();
          }
        } catch (e) {
          console.warn("On-hold check failed:", e);
        }
      }
    }
  }

  syncStatusButtons();

  // Show update banner if the page is employee and there is an update
  if (step === "employee" && updateAvailable && !state.runRunning) {
  showUpdateBanner();
  }

  saveState();
}

// UI fields are restored from the persisted state snapshot.
function restoreUIFromState() {
  // restore employee UI
  if (state.employeeData) {
    el("empName").innerText = state.employeeData.employeeName || "-";
    el("empNo").innerText = state.employeeData.employeeNumber || "-";
    el("empStation").innerText = state.employeeData.station || "-";
    if (state.vesselData) {
      loadProcessesForCurrentUnit();;
    }
  }

  // restore project UI
  if (state.vesselData) {
    el("projectName").innerText = state.vesselData.projectName || "-";
    el("description").innerText = state.vesselData.description || "-";
    el("materialNumber").innerText = state.vesselData.materialNumber || "-";
    el("serialNumber").innerText = state.vesselData.serialNumber || "-";
    el("type").innerText = state.vesselData.vesselType || state.vesselData.type || "-";
  }

  setStep(state.currentStep);

  // resume stopwatch if running
  renderStopwatch();
  if (state.runRunning && !state.runTimer) {
    state.runTimer = setInterval(renderStopwatch, 200);
  }
  syncStatusButtons();
}

// Initial state hydration and startup synchronization are performed when DOM content is loaded.
window.addEventListener("DOMContentLoaded", async () => {
  loadState();
  restoreUIFromState();
  syncStatusButtons();

  await stopScanner();
  updateScanButtonUI();

  await checkForAppUpdate();

  // If we are already in status, processes exist, so try auto-resume
  if (state.currentStep === "status") {
    await autoResumeAfterReload();
  }
  
});

/* ===== Event listeners ===== */

// Timer rendering is paused/resumed based on document visibility changes.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (state.runRunning && !state.runTimer) {
      state.runTimer = setInterval(renderStopwatch, 200);
    }
    renderStopwatch();
    syncStatusButtons();
  } else {
    if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }
  }
});


// A best-effort auto-hold update is sent for an active running process.
async function autoHoldActiveRun(reason = "browser_closed") {
  if (state.autoHoldSent) return;
  if (!state.currentRunId) return;
  if (!state.runRunning) return;

  state.autoHoldSent = true;

  try {
    await updateDoc(runDoc(state.currentRunId), {
      status: "on_hold",
      holdReason: reason,
      holdAt: serverTimestamp(),
      holdEpochMs: Date.now(),
      durationMs: getElapsedMs(),
      remarks: "-"
    });
  } catch (e) {
    console.warn("Auto-hold failed:", e);
  }
}


// Employee submit input is validated and the flow is advanced to project scanning.
el("to-project")?.addEventListener("click", async () => {
  if (!state.employeeData) {
    showScanStatus("Please scan employee QR first.", "err");
    return;
  }

  const manpowerStr = (el("manpowerInput")?.value || "").trim();
  const manpower = Number(manpowerStr);

  if (!manpowerStr) {
    showScanStatus("Please fill in Manpower before Submit.", "err");
    return;
  }
  if (!Number.isFinite(manpower) || manpower <= 0) {
    showScanStatus("Manpower must be a number 1 or above.", "err");
    return;
  }

  state.employeeData.manpower = manpower;
  saveState();

  showScanStatus("Manpower saved. Now scan Project QR.", "ok");
  await setStep("project");
});

// Project submission is validated and the flow is advanced to status view.
el("to-status")?.addEventListener("click", () => {
  if (!state.vesselData) {
    alert("Please scan project QR first.");
    return;
  }

  //  pre-load processes before switching screen
  loadProcessesForCurrentUnit();;

  setStep("status");
});

// Scanner start/stop is toggled from the scan button outside status view.
el("start-scan")?.addEventListener("click", async () => {
  if (state.currentStep === "status") return;
  hideScanStatus();

  if (state.scanning) await stopScanner();
  else await startScanner((decodedText) => onScanSuccess(decodedText, setStep));
});

// Start or resume behavior is delegated to run-management logic.
el("btnStartProcess")?.addEventListener("click", startOrResumeRun);

// Completion intent is guarded and then routed to the completion confirmation modal.
el("btnStopProcess")?.addEventListener("click", () => {
  if (!state.currentRunId) return showScanStatus("No running process to complete.", "err");
  if (!state.runRunning) return showScanStatus("Process is not running.", "err");
  openCompleteModal();
});

// Hold intent is guarded and then routed to the on-hold modal.
el("btnHoldProcess")?.addEventListener("click", () => {
  if (!state.currentRunId) return showScanStatus("No running process to hold.", "err");
  openHoldModal();
});

// On-hold modal dismissal is handled and button states are re-synchronized.
el("holdCancel")?.addEventListener("click", () => {
  closeHoldModal();
  syncStatusButtons();
});

// On-hold reason changes are reflected by conditional remarks input visibility.
el("holdReason")?.addEventListener("change", () => {
  const reason = (el("holdReason")?.value || "").trim();
  const remarksBox = el("holdRemarks");

  if (!remarksBox) return;

  const mustFillRemark = reasonsRequireRemarks.includes(reason);

  // If the reason is in the array, then the remarks box will appear

  if (mustFillRemark){
    remarksBox.classList.remove("hidden");
    remarksBox.required = true;
  } else {
    remarksBox.classList.add("hidden");
    remarksBox.required = false;
    remarksBox.value = ""

  }

});

// On-hold data is validated and persisted through hold-run flow.
el("holdSave")?.addEventListener("click", async () => {
  if (!state.currentRunId) {
    closeHoldModal();
    return;
  }

  const reason = (el("holdReason")?.value || "").trim();
  const remarksRaw = (el("holdRemarks")?.value || "").trim();

  if (!reason) return showScanStatus("Please select a hold reason.", "err");
  
  const mustFillRemarks = reasonsRequireRemarks.includes(reason);

  // If the reason is in the array, then it is required to fill in
  if (mustFillRemarks && !remarksRaw){
    showScanStatus("Remarks are required for this reason.", "err");
    el("holdRemarks")?.focus();
    return;
  }

  const finalRemarks = mustFillRemarks ? remarksRaw : "";

  closeHoldModal();
  await holdRunAndReset(reason, finalRemarks, setStep, resetAllData, hideSaveOverlay, showSaveOverlay);
});

// Process-selection changes are persisted and run status is re-evaluated against Firestore.
el("processSelect")?.addEventListener("change", async () => {
  const proc = el("processSelect")
  if (proc) state.selectedProcessName = proc.value;
  saveState()


  syncStatusButtons(); // Start button re-enables as soon as a real process is selected:
  
  if (state.currentStep !== "status") return;
  if (!state.employeeData || !state.vesselData) return;
  if (state.runRunning) return;

  showScanStatus("Checking status...", "info");

  // reset selection state
  state.resumeLocked = false;
  state.resumeRunStatus = null;
  state.resumeProcessName = null;
  state.currentRunId = null;
  state.runAccumMs = 0;
  state.runStartEpoch = 0;

  // unlock completed lock when selecting different process
  state.startLockedByStatus = false;

  renderStopwatch();
  saveState();
  syncStatusButtons();

  const serialNumber = state.vesselData.serialNumber;
  const station = state.employeeData.station;
  const processName = el("processSelect").value;

  try {
    // 0) running
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      const lastEmp = String(active.resumedByNumber || active.startedByNumber || "").trim();
      const me = String(state.employeeData.employeeNumber || "").trim();

      //  running by YOU -> reconnect and show time
      if (lastEmp && lastEmp === me) {
        reconnectToRunning(active);
        return;
      }

      //  running by someone else -> block Start, but allow selecting other process
      state.runRunning = false;
      state.runStartEpoch = 0;
      state.runAccumMs = 0;
      if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }

      state.currentRunId = active.id;
      state.startLockedByStatus = true;
      state.resumeLocked = false;

      const whoName = active.resumedByName || active.startedByName || "Unknown";
      const whoNo   = active.resumedByNumber || active.startedByNumber || "-";
      const verb    = active.resumedByName ? "Resumed by" : "Started by";

      showScanStatus(`This process is already RUNNING. ${verb}: ${whoName} (${whoNo}).`, "err");

      renderStopwatch(); // 00:00:00 by design for "not yours"
      saveState();
      syncStatusButtons();
      return;
    }


    // 1) on_hold
    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (onHold) {
      applyResumeRunToUI(onHold);
      syncStatusButtons();
      return;
    }

    // 2) completed
    const completed = await hasCompletedProcess(serialNumber, processName);
    if (completed) {
      state.startLockedByStatus = true;
      showScanStatus("This process is already COMPLETED.", "err");
      syncStatusButtons();
      return;
    }

    // 3) available
    hideScanStatus();
    syncStatusButtons();

  } catch (e) {
    console.warn("processSelect check failed:", e);
    showScanStatus("Failed to check status. Try again.", "err");
    state.startLockedByStatus = false;
    syncStatusButtons();
  }
});

// Auto-hold execution is requested as a thin wrapper for unload events.
function requestAutoHold(reason = "browser_closed") {
  autoHoldActiveRun(reason); // best-effort
}

// Active-run state is protected during page unload via best-effort auto-hold.
window.addEventListener("beforeunload", (e) => {
  if (state.runRunning) {
    // Mark that this tab is reloading/navigating (sessionStorage survives refresh)
    sessionStorage.setItem("pendingReload", "1");

    // Best-effort hold (may or may not reach Firestore)
    requestAutoHold("browser_closed");

    e.preventDefault();
    e.returnValue = "";
  }
});

// pagehide fires on tab close + navigation + iOS Safari cases
// Auto-hold is requested on page-hide scenarios, including BFCache-related cases.
window.addEventListener("pagehide", () => {
  requestAutoHold("browser_closed");
});

// Timer rendering is restored when the page is shown again from cache/navigation.
window.addEventListener("pageshow", () => {
  // When page is shown again (Safari BFCache), restore timer tick if needed
  if (state.runRunning && !state.runTimer) {
    state.runTimer = setInterval(renderStopwatch, 200);
  }
  renderStopwatch();
  syncStatusButtons();
});

// Completion modal cancellation is handled without state mutation.
el("completeCancel")?.addEventListener("click", () => {
  closeCompleteModal();
});

// Completion confirmation is committed through complete-run flow.
el("completeConfirm")?.addEventListener("click", async () => {
  closeCompleteModal();
  await completeRunAndReset(setStep, resetAllData, hideSaveOverlay, showSaveOverlay);
});

// Refresh button logic
el("refreshAppBtn")?.addEventListener("click", () => {
  window.location.reload();
});

// Check for updates every 3 minutes
setInterval(async () => {
  await checkForAppUpdate();

  if (updateAvailable && canPromptForRefresh()) {
    showUpdateBanner();
  }
}, 3 * 60 * 1000);
