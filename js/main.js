/* Main heart of the program */

import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { db } from "./firebase.js"; // adjust if your path differs

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
  startStopwatch,
  stopStopwatch
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
  findActiveRun
} from "./processRuns.js";

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
      el("statusType") && (el("statusType").innerText = state.vesselData.vesselType || state.vesselData.type || "-");
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
  saveState();
}

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

window.addEventListener("DOMContentLoaded", async () => {
  loadState();
  restoreUIFromState();
  syncStatusButtons();

  await stopScanner();
  updateScanButtonUI();

  // If we are already in status, processes exist, so try auto-resume
  if (state.currentStep === "status") {
    await autoResumeAfterReload();
  }
});

/* ===== Event listeners ===== */

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

el("to-status")?.addEventListener("click", () => {
  if (!state.vesselData) {
    alert("Please scan project QR first.");
    return;
  }

  //  pre-load processes before switching screen
  loadProcessesForCurrentUnit();;

  setStep("status");
});

el("start-scan")?.addEventListener("click", async () => {
  if (state.currentStep === "status") return;
  hideScanStatus();

  if (state.scanning) await stopScanner();
  else await startScanner((decodedText) => onScanSuccess(decodedText, setStep));
});

el("btnStartProcess")?.addEventListener("click", startOrResumeRun);

el("btnStopProcess")?.addEventListener("click", async () => {
  await completeRunAndReset(setStep, resetAllData, hideSaveOverlay, showSaveOverlay);
});

el("btnHoldProcess")?.addEventListener("click", () => {
  if (!state.currentRunId) return showScanStatus("No running process to hold.", "err");
  openHoldModal();
});

el("holdCancel")?.addEventListener("click", () => {
  closeHoldModal();
  syncStatusButtons();
});

el("holdReason")?.addEventListener("change", () => {
  const reason = el("holdReason")?.value;
  const remarksBox = el("holdRemarks");
  if (!remarksBox) return;

  if (reason === "others") {
    remarksBox.classList.remove("hidden");
  } else {
    remarksBox.classList.add("hidden");
    remarksBox.value = "";
  }
});

el("holdSave")?.addEventListener("click", async () => {
  if (!state.currentRunId) {
    closeHoldModal();
    return;
  }

  const reason = (el("holdReason")?.value || "").trim();
  const remarksRaw = (el("holdRemarks")?.value || "").trim();

  if (!reason) return showScanStatus("Please select a hold reason.", "err");
  if (reason === "others" && !remarksRaw) {
    showScanStatus("Remarks are required when 'Others' is selected.", "err");
    el("holdRemarks")?.focus();
    return;
  }

  const finalRemarks = (reason === "others") ? remarksRaw : "";

  closeHoldModal();
  await holdRunAndReset(finalRemarks ? "others" : reason, finalRemarks, setStep, resetAllData, hideSaveOverlay, showSaveOverlay);
});

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
    // 0) running (block)
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      // hard reset local timer so it never shows running here
      state.runRunning = false;
      state.runStartEpoch = 0;
      state.runAccumMs = 0;
      if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }

      state.currentRunId = active.id;

      // lock Start (cannot start another timer)
      state.startLockedByStatus = true;
      state.resumeLocked = false; // allow choosing other process
      state.resumeRunStatus = "running";

      // choose “resumed” info if available, otherwise “started”
      const whoName =
        active.resumedByName || active.startedByName || "Unknown";
      const whoNo =
        active.resumedByNumber || active.startedByNumber || "-";

      const verb = active.resumedByName ? "Resumed by" : "Started by";

      showScanStatus(
        `This process is already RUNNING. ${verb}: ${whoName} (${whoNo}).`,
        "err"
      );

      renderStopwatch(); // will show 00:00:00 (intentionally)
      saveState();
      syncStatusButtons();
      return;
    }


    // 1) on_hold
    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (onHold) {
      applyResumeRunToUI(onHold);
      hideScanStatus();
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

function requestAutoHold(reason = "browser_closed") {
  autoHoldActiveRun(reason); // best-effort
}

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
window.addEventListener("pagehide", () => {
  requestAutoHold("browser_closed");
});

window.addEventListener("DOMContentLoaded", async () => {
  loadState();
  restoreUIFromState();
  syncStatusButtons();

  // do not auto start scanner
  await stopScanner();
  updateScanButtonUI();
});

window.addEventListener("pageshow", () => {
  // When page is shown again (Safari BFCache), restore timer tick if needed
  if (state.runRunning && !state.runTimer) {
    state.runTimer = setInterval(renderStopwatch, 200);
  }
  renderStopwatch();
  syncStatusButtons();
});


