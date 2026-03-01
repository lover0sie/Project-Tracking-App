/* Update the UI */

import { state, PROCESS_BY_PV, PROCESS_BY_CHILLER,  getVesselTypeKey, formatMs, getElapsedMs, saveState } from "./state.js";

export const el = (id) => document.getElementById(id);

export function setText(id, value) {
  const node = el(id);
  if (node) node.innerText = value ?? "-";
}

export function showScanStatus(msg, type = "info") {
  const box = el("scan-status");
  if (!box) return;

  box.textContent = msg;
  box.classList.remove("hidden", "ok", "err", "info");
  box.classList.add(type);
}

export function hideScanStatus() {
  const box = el("scan-status");
  if (!box) return;
  box.classList.add("hidden");
  box.textContent = "";
  box.classList.remove("ok", "err", "info");
}

export function showSaveOverlay(text = "Saving...", isSuccess = false) {
  const overlay = el("saveOverlay");
  const txt = el("saveOverlayText");
  if (!overlay || !txt) return;

  txt.textContent = text;
  txt.classList.toggle("success", !!isSuccess);
  overlay.classList.remove("hidden");
}

export function hideSaveOverlay() {
  const overlay = el("saveOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

export function updateStepper(step) {
  const idx = step === "employee" ? 1 : step === "project" ? 2 : 3;

  const s1 = el("step1"), s2 = el("step2"), s3 = el("step3");
  [s1, s2, s3].forEach(x => x && x.classList.remove("done", "current"));

  if (idx === 1) {
    s1?.classList.add("current");
  } else if (idx === 2) {
    s1?.classList.add("done");
    s2?.classList.add("current");
  } else {
    s1?.classList.add("done");
    s2?.classList.add("done");
    s3?.classList.add("current");
  }

  const fill = el("stepFill");
  if (fill) fill.style.width = (idx === 1 ? 0 : idx === 2 ? 50 : 100) + "%";
}

export function loadProcessesForCurrentUnit() {
  const sel = el("processSelect");
  if (!sel) return;

  sel.innerHTML = "";

  const kind = (state.vesselData?.qrKind || state.activeScope || "").toUpperCase();

  let list = [];
  if (kind === "PV") {
    const vesselKey = getVesselTypeKey(state.vesselData?.vesselType);
    list = PROCESS_BY_PV[vesselKey] || [];
  } else if (kind === "CHILLER") {
    const coolKey = getVesselTypeKey(state.vesselData?.coolingType);
    list = PROCESS_BY_CHILLER[coolKey] || [];
  }

  // placeholder (disabled; not a real selection)
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = list.length ? "Select process..." : "No process list for this unit";
  ph.disabled = true;
  ph.selected = true;
  sel.appendChild(ph);

  list.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });

  // restore if still valid
  if (state.selectedProcessName && list.includes(state.selectedProcessName)) {
    sel.value = state.selectedProcessName;
  } else {
    sel.value = "";
    state.selectedProcessName = null;
    saveState();
  }
}

export function renderStopwatch() {
  const sw = el("stopwatch");
  if (!sw) return;
  sw.textContent = formatMs(getElapsedMs());
}

export function startStopwatch() {
  if (state.runRunning) return;
  state.runRunning = true;
  state.runStartEpoch = Date.now();
  state.runTimer = setInterval(renderStopwatch, 200);
  renderStopwatch();
  saveState();
}

export function stopStopwatch() {
  if (!state.runRunning) return;
  state.runAccumMs += Date.now() - state.runStartEpoch;
  state.runRunning = false;
  clearInterval(state.runTimer);
  state.runTimer = null;
  renderStopwatch();
}

export function syncStatusButtons() {
  const startBtn = el("btnStartProcess");
  const stopBtn = el("btnStopProcess");
  const holdBtn = el("btnHoldProcess");
  const procSel = el("processSelect");
  if (!startBtn || !stopBtn || !holdBtn) return;

  const noProcessSelected = !procSel?.value;
  const startDisabled =
    state.runRunning ||
    state.startInFlight ||
    state.startLockedByStatus ||
    noProcessSelected;

  startBtn.disabled = startDisabled;
  stopBtn.disabled = !state.runRunning;
  holdBtn.disabled = !state.runRunning;

  if (procSel) procSel.disabled = state.runRunning || state.resumeLocked;
}

export function openHoldModal() {
  el("holdModal")?.classList.remove("hidden");
  if (el("holdReason")) el("holdReason").value = "";
  if (el("holdRemarks")) el("holdRemarks").value = "";
  el("holdRemarks")?.classList.add("hidden");
  setTimeout(() => el("holdReason")?.focus(), 0);
}

export function closeHoldModal() {
  el("holdModal")?.classList.add("hidden");
}

export function resetAllData() {
  state.resumeLocked = false;
  state.resumeRunStatus = null;
  state.resumeProcessName = null;

  state.stateEnabled = false;
  sessionStorage.removeItem("qrAppState_v1");

  state.employeeData = null;
  state.vesselData = null;

  state.currentRunId = null;
  state.runRunning = false;
  state.runStartEpoch = 0;
  state.runAccumMs = 0;

  if (state.runTimer) { clearInterval(state.runTimer); state.runTimer = null; }
  renderStopwatch();

  setText("empName", "-");
  setText("empNo", "-");
  setText("empStation", "-");

  setText("projectName", "-");
  setText("description", "-");
  setText("materialNumber", "-");
  setText("serialNumber", "-");
  setText("type", "-");

  setText("statusProject", "-");
  setText("statusMaterial", "-");
  setText("statusSerial", "-");
  setText("statusStation", "-");
  setText("statusType", "-");

  if (el("manpowerInput")) el("manpowerInput").value = "";
  setText("statusManpower", "-");

  const sel = el("processSelect");
  if (sel) {
    sel.innerHTML = "";
    sel.disabled = false;
  }

  hideScanStatus();
  if (el("qr-result")) el("qr-result").textContent = "";

  state.stateEnabled = true;
  state.startLockedByStatus = false;
}