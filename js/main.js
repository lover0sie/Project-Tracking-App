/* Main heart of the program */

import {
  state,
  loadState,
  saveState,
  isInsulationStation
} from "./state.js";

import {
  INSULATION_ITEM_BY_MODEL,
  INSULATION_PROCESS_BY_ITEM
} from "./processList.js";

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
  hideSaveOverlay
} from "./ui.js";

import { startScanner, stopScanner, updateScanButtonUI, onScanSuccess } from "./scanner.js";

import {
  findOnHoldRun,
  applyResumeRunToUI,
  hasCompletedProcess,
  startOrResumeRun,
  completeRunAndReset,
  holdRunAndReset,
  findActiveRun,
  reconnectToRunning,
  resolveRunIdentity
} from "./processRuns.js";

// Added app versioning for checking purposes
const APP_VERSION = "2026-07-31-01";
let updateAvailable = false;
let latestVersion = APP_VERSION;

// Array of reason that require remarks
const reasonsRequireRemarks = [
  "rework",
  "parts_shortage",
  "parts_ng",
  "drawing_ng",
  "others",
  "supplier_machining",
  "qc_checking"
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

function getSelectedInsulationItemType() {
  return (el("insulationItemSelect")?.value || "").trim();
}

function requiresInsulationItemSelection() {
  return (
    isInsulationStation(state.employeeData?.station) &&
    state.vesselData?.qrKind === "CHILLER"
  );
}

function getInsulationItemsForModel(model = "") {
  const modelKey = String(model || "").trim().toUpperCase();
  if (!modelKey) return [];

  if (INSULATION_ITEM_BY_MODEL[modelKey]) {
    return INSULATION_ITEM_BY_MODEL[modelKey];
  }

  const matchedKey = Object.keys(INSULATION_ITEM_BY_MODEL)
    .sort((a, b) => b.length - a.length)
    .find(key => modelKey.startsWith(key));

  return matchedKey ? INSULATION_ITEM_BY_MODEL[matchedKey] : [];
}

function getInsulationProcessForItem(itemType = "") {
  return INSULATION_PROCESS_BY_ITEM[String(itemType || "").trim().toUpperCase()] || "";
}

function syncInsulationProcessForItem(itemType = "") {
  const procSel = el("processSelect");
  if (!procSel || !requiresInsulationItemSelection()) return;

  const processName = getInsulationProcessForItem(itemType);
  procSel.value = processName;
  state.selectedProcessName = processName || null;
}

function populateInsulationItemsForCurrentModel() {
  const itemBox = el("insulationItemBox");
  const itemSel = el("insulationItemSelect");
  if (!itemBox || !itemSel) return;

  itemSel.innerHTML = `<option value="">Select item...</option>`;

  if (!requiresInsulationItemSelection()) {
    itemBox.classList.add("hidden");
    state.selectedInsulationItemType = null;
    return;
  }

  const itemTypes = getInsulationItemsForModel(state.vesselData?.model);
  itemBox.classList.remove("hidden");

  itemTypes.forEach(type => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    itemSel.appendChild(opt);
  });

  if (
    state.selectedInsulationItemType &&
    itemTypes.includes(state.selectedInsulationItemType)
  ) {
    itemSel.value = state.selectedInsulationItemType;
    syncInsulationProcessForItem(state.selectedInsulationItemType);
  } else {
    state.selectedInsulationItemType = null;
    syncInsulationProcessForItem("");
  }

  if (!itemTypes.length) {
    showScanStatus("No insulation item list found for this model.", "err");
  }
}

async function checkCurrentRunStatusForSelection() {
  if (state.currentStep !== "status") return;
  if (!state.employeeData || !state.vesselData) return;
  if (state.runRunning) return;

  const processName = el("processSelect")?.value || "";
  if (!processName) return;

  const selectedInsulationItemType = getSelectedInsulationItemType();
  if (requiresInsulationItemSelection() && !selectedInsulationItemType) {
    if (!getInsulationItemsForModel(state.vesselData?.model).length) {
      showScanStatus("No insulation item list found for this model.", "err");
    } else {
      hideScanStatus();
    }
    return;
  }

  showScanStatus("Checking status...", "info");
  state.statusCheckInFlight = true;
  syncStatusButtons();

  state.resumeLocked = false;
  state.resumeRunStatus = null;
  state.resumeProcessName = null;
  state.currentRunId = null;
  state.runAccumMs = 0;
  state.runStartEpoch = 0;
  state.startLockedByStatus = false;

  renderStopwatch();
  saveState();
  syncStatusButtons();

  const station = state.employeeData.station;

  try {
    const { serialNumber } = await resolveRunIdentity(
      state.vesselData,
      station,
      selectedInsulationItemType
    );

    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      const lastEmp = String(active.resumedByNumber || active.startedByNumber || "").trim();
      const me = String(state.employeeData.employeeNumber || "").trim();

      if (lastEmp && lastEmp === me) {
        reconnectToRunning(active);
        return;
      }

      state.runRunning = false;
      state.runStartEpoch = 0;
      state.runAccumMs = 0;
      if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }

      state.currentRunId = active.id;
      state.startLockedByStatus = true;
      state.resumeLocked = false;

      const whoName = active.resumedByName || active.startedByName || "Unknown";
      const whoNo = active.resumedByNumber || active.startedByNumber || "-";
      const verb = active.resumedByName ? "Resumed by" : "Started by";

      showScanStatus(`This process is already RUNNING. ${verb}: ${whoName} (${whoNo}).`, "err");

      renderStopwatch();
      saveState();
      syncStatusButtons();
      return;
    }

    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (onHold) {
      applyResumeRunToUI(onHold);
      syncStatusButtons();
      return;
    }

    const completed = await hasCompletedProcess(serialNumber, processName);
    if (completed) {
      state.startLockedByStatus = true;
      showScanStatus("This process is already COMPLETED.", "err");
      syncStatusButtons();
      return;
    }

    hideScanStatus();
    syncStatusButtons();
  } catch (e) {
    console.warn("process status check failed:", e);
    showScanStatus("Failed to check status. Try again.", "err");
    state.startLockedByStatus = false;
    syncStatusButtons();
  } finally {
    state.statusCheckInFlight = false;
    syncStatusButtons();
  }
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

    populateInsulationItemsForCurrentModel();

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

    await checkCurrentRunStatusForSelection();
  }

  syncStatusButtons();

  // Show update banner if the page is employee and there is an update
  if (step === "employee" && updateAvailable && !state.runRunning) {
  showUpdateBanner();
  }

  saveState();
}

// UI fields are restored from the persisted state snapshot.
async function restoreUIFromState() {
  if (state.employeeData) {
    el("empName").innerText = state.employeeData.employeeName || "-";
    el("empNo").innerText = state.employeeData.employeeNumber || "-";
    el("empStation").innerText = state.employeeData.station || "-";

    if (state.vesselData) {
      loadProcessesForCurrentUnit();
    }
  }

  if (state.vesselData) {
    el("projectName").innerText = state.vesselData.projectName || "-";
    el("description").innerText = state.vesselData.description || "-";
    el("materialNumber").innerText = state.vesselData.materialNumber || "-";
    el("serialNumber").innerText = state.vesselData.serialNumber || "-";
    el("type").innerText =
      state.vesselData.vesselType ||
      state.vesselData.coolingType ||
      state.vesselData.type ||
      "-";
  }

  await setStep(state.currentStep);

  renderStopwatch();

  if (state.runRunning && !state.runTimer) {
    state.runTimer = setInterval(renderStopwatch, 200);
  }

  syncStatusButtons();
}

// Initial state hydration and startup synchronization are performed when DOM content is loaded.
window.addEventListener("DOMContentLoaded", async () => {
  loadState();

  await restoreUIFromState();
  syncStatusButtons();

  await stopScanner();
  updateScanButtonUI();

  await checkForAppUpdate();
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
    saveState();
    if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }
  }
});


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
  const proc = el("processSelect");

  if (proc) {
    state.selectedProcessName = proc.value;
  }

  state.selectedInsulationItemType = null;
  populateInsulationItemsForCurrentModel();

  saveState();

  syncStatusButtons();

  await checkCurrentRunStatusForSelection();
});

el("insulationItemSelect")?.addEventListener("change", async () => {
  state.selectedInsulationItemType = getSelectedInsulationItemType() || null;
  syncInsulationProcessForItem(state.selectedInsulationItemType);
  saveState();
  syncStatusButtons();
  await checkCurrentRunStatusForSelection();
});

// Timer rendering is restored when the page is shown again from cache/navigation.
window.addEventListener("pageshow", () => {
  // Safari may fire pageshow when the same tab returns from background/BFCache.
  // The operator should stay on the current workflow step; only the timer/UI are revived.
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
