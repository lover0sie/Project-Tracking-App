import { state, loadState, saveState } from "./state.js";
import {
  el,
  hideScanStatus,
  showScanStatus,
  updateStepper,
  loadProcessesForStation,
  renderStopwatch,
  syncStatusButtons,
  openHoldModal,
  closeHoldModal,
  resetAllData,
  showSaveOverlay,
  hideSaveOverlay
} from "./ui.js";

import { startScanner, stopScanner, updateScanButtonUI, onScanSuccess } from "./scanner.js";

import {
  findOnHoldRun,
  applyResumeRunToUI,
  hasCompletedProcess,
  startOrResumeRun,
  completeRunAndReset,
  holdRunAndReset
} from "./processRuns.js";

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
    if (state.employeeData?.station) loadProcessesForStation(state.employeeData.station);

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
    if (state.employeeData && state.vesselData) {
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
    loadProcessesForStation(state.employeeData.station);
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

/* ===== Event listeners ===== */

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderStopwatch();
});

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

window.addEventListener("beforeunload", (e) => {
  if (state.runRunning) {
    e.preventDefault();
    e.returnValue = "";
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  loadState();
  restoreUIFromState();
  syncStatusButtons();

  // do not auto start scanner
  await stopScanner();
  updateScanButtonUI();
});