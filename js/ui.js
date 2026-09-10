/* Update the UI */

import {
  state,
  isInsulationStation,
  isFabricationMode,
  getVesselTypeKey,
  formatMs,
  getElapsedMs,
  saveState,
  clearPersistedState
} from "./state.js";

import {
  PROCESS_BY_PV,
  PROCESS_BY_CHILLER,
  INSULATION_PROCESSES,
  FABRICATION_PROCESSES
} from "./processList.js";

import { groupItemsByChiller } from "./qr.js";

export const el = (id) => document.getElementById(id);

export function setText(id, value) {
  const node = el(id);
  if (node) node.innerText = value ?? "-";
}

export function showScanStatus(msg, type = "info", autoHideMs = 0) {
  const box = el("scan-status");
  if (!box) return;

  if (state.scanStatusTimeout) {
    clearTimeout(state.scanStatusTimeout);
    state.scanStatusTimeout = null;
  }

  box.textContent = msg;
  box.classList.remove("hidden", "ok", "err", "info");
  box.classList.add(type);

  if (autoHideMs > 0) {
    state.scanStatusTimeout = setTimeout(() => {
      hideScanStatus();
      state.scanStatusTimeout = null;
    }, autoHideMs);
  }
}

export function hideScanStatus() {
  const box = el("scan-status");
  if (!box) return;

  if (state.scanStatusTimeout) {
    clearTimeout(state.scanStatusTimeout);
    state.scanStatusTimeout = null;
  }

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
  el("saveOverlay")?.classList.add("hidden");
}

export function updateStepper(step) {
  const idx = step === "employee" ? 1 : (step === "project" || step === "items") ? 2 : 3;

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

  const step2Label = el("step2")?.querySelector(".sLbl");
  if (step2Label) step2Label.textContent = isFabricationMode() ? "QR ITEMS" : "QR PROJECT";
}

export function loadProcessesForCurrentUnit() {
  const sel = el("processSelect");
  if (!sel) return;

  sel.innerHTML = "";

  const kind = (state.vesselData?.qrKind || state.activeScope || "").toUpperCase();
  const station = state.employeeData?.station || "";
  let list = [];

  if (isFabricationMode()) {
    list = FABRICATION_PROCESSES;
  } else if (kind === "CHILLER" && isInsulationStation(station)) {
    list = INSULATION_PROCESSES[station] || [];
  } else if (kind === "PV") {
    const vesselKey = getVesselTypeKey(state.vesselData?.vesselType);
    list = PROCESS_BY_PV[vesselKey] || [];
  } else if (kind === "CHILLER") {
    const coolKey = getVesselTypeKey(state.vesselData?.coolingType);
    list = PROCESS_BY_CHILLER[coolKey] || [];
  }

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

  if (state.selectedProcessName && list.includes(state.selectedProcessName)) {
    sel.value = state.selectedProcessName;
  } else {
    sel.value = "";
    state.selectedProcessName = null;
    saveState();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderFabricationItemList() {
  const count = el("itemCount");
  const list = el("itemList");

  if (count) count.textContent = String(state.scannedItems.length);
  if (!list) return;

  if (!state.scannedItems.length) {
    list.innerHTML = `<div class="hint">No items scanned yet.</div>`;
    return;
  }

  list.innerHTML = state.scannedItems.map((item, idx) => `
    <div class="itemCard">
      <div class="itemCardTop">
        <div class="itemTitle">${idx + 1}. ${escapeHtml(item.itemID)}</div>
        <button type="button" class="btnDanger itemRemoveBtn" data-index="${idx}">Remove</button>
      </div>
      <div class="itemMeta">
        <div><b>Project:</b> ${escapeHtml(item.projectName)}</div>
        <div><b>Serial:</b> ${escapeHtml(item.chillerSerialNumber)}</div>
        <div><b>Description:</b> ${escapeHtml(item.description)} <span class="laneTag">${escapeHtml(item.laneType)}</span></div>
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".itemRemoveBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      state.scannedItems.splice(idx, 1);
      renderFabricationItemList();
      saveState();
      showScanStatus("Item removed.", "info");
    });
  });
}

export function renderFabricationStatusSummary() {
  const grouped = groupItemsByChiller(state.scannedItems);

  setText("statusEmployee", state.employeeData?.employeeName || "-");
  setText("statusEmpNo", state.employeeData?.employeeNumber || "-");
  setText("statusStation", state.employeeData?.station || "-");
  setText("statusManpower", state.employeeData?.manpower ?? "-");
  setText("statusTotalItems", String(state.scannedItems.length || 0));
  setText("statusTotalProjects", String(grouped.length || 0));

  const summary = el("fabricationSummary");
  const groupedItems = el("groupedItems");
  summary?.classList.toggle("hidden", !grouped.length);
  if (!groupedItems) return;

  if (!grouped.length) {
    groupedItems.innerHTML = `<div class="hint">No grouped items.</div>`;
    return;
  }

  groupedItems.innerHTML = grouped.map(group => `
    <div class="groupBlock">
      <div class="groupHead">${escapeHtml(group.projectName)} - ${escapeHtml(group.chillerSerialNumber)}</div>
      <div class="groupItems">
        ${group.items.map(item => `
          <div class="groupItem">
            <span class="groupItemBullet">•</span>
            <span class="groupItemText">
              <span class="groupItemId">${escapeHtml(item.itemID)}</span>
              <span class="groupItemDivider">-</span>
              <span class="groupItemDescription">${escapeHtml(item.description)}</span>
            </span>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");
}

export function renderStopwatch() {
  const sw = el("stopwatch");
  if (!sw) return;
  sw.textContent = formatMs(getElapsedMs());
}

export function startStopwatch() {
  if (state.runRunning) {
    if (!state.runTimer) {
      if (!state.runStartEpoch || state.runStartEpoch <= 0) {
        state.runStartEpoch = Date.now();
      }
      state.runTimer = setInterval(renderStopwatch, 200);
      renderStopwatch();
      saveState();
    }
    return;
  }

  state.runRunning = true;
  state.runStartEpoch = Date.now();
  state.runTimer = setInterval(renderStopwatch, 200);
  renderStopwatch();
  saveState();
}

export function stopStopwatch() {
  if (!state.runRunning) return;

  if (state.runStartEpoch && state.runStartEpoch > 0) {
    state.runAccumMs += Date.now() - state.runStartEpoch;
  }

  state.runRunning = false;
  state.runStartEpoch = 0;

  if (state.runTimer) {
    clearInterval(state.runTimer);
    state.runTimer = null;
  }

  renderStopwatch();
  saveState();
}

export function syncStatusButtons() {
  const startBtn = el("btnStartProcess");
  const stopBtn = el("btnStopProcess");
  const holdBtn = el("btnHoldProcess");
  const backToItemsBtn = el("btnBackToItems");
  const procSel = el("processSelect");
  const insulationSel = el("insulationItemSelect");
  if (!startBtn || !stopBtn || !holdBtn) return;

  const noProcessSelected = !procSel?.value;
  const kind = (state.vesselData?.qrKind || state.activeScope || "").toUpperCase();
  const station = state.employeeData?.station || "";
  const noRequiredInsulationItem =
    kind === "CHILLER" &&
    isInsulationStation(station) &&
    !insulationSel?.value;
  const hasFabricationBatch = isFabricationMode() && state.activeRunDocs.length > 0;
  const startDisabled =
    state.runRunning ||
    state.startInFlight ||
    state.statusCheckInFlight ||
    state.startLockedByStatus ||
    noProcessSelected ||
    noRequiredInsulationItem ||
    hasFabricationBatch;

  startBtn.disabled = startDisabled;
  stopBtn.disabled = isFabricationMode()
    ? !hasFabricationBatch || (state.currentStatus !== "running" && state.currentStatus !== "on_hold")
    : !state.runRunning;
  holdBtn.disabled = isFabricationMode()
    ? !hasFabricationBatch || state.currentStatus !== "running"
    : !state.runRunning;

  backToItemsBtn?.classList.toggle(
    "hidden",
    !isFabricationMode() || hasFabricationBatch || state.runRunning || state.startInFlight
  );

  if (procSel) {
    procSel.disabled =
      state.runRunning ||
      state.resumeLocked ||
      (kind === "CHILLER" && isInsulationStation(station));
  }

  if (insulationSel) {
    insulationSel.disabled = state.runRunning || state.resumeLocked;
  }
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
  clearPersistedState();

  state.employeeData = null;
  state.vesselData = null;
  state.chillerSerialNumber = null;
  state.activeScope = null;
  state.selectedProcessName = null;
  state.selectedInsulationItemType = null;
  state.scannedItems = [];
  state.activeBatchSessionId = null;
  state.activeRunDocs = [];
  state.currentStatus = "idle";
  state.currentStep = "employee";

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
  setText("statusManpower", "-");
  setText("statusEmployee", "-");
  setText("statusEmpNo", "-");
  setText("statusTotalItems", "-");
  setText("statusTotalProjects", "-");

  if (el("manpowerInput")) el("manpowerInput").value = "";
  if (el("itemCount")) el("itemCount").textContent = "0";
  if (el("itemList")) el("itemList").innerHTML = `<div class="hint">No items scanned yet.</div>`;
  el("fabricationSummary")?.classList.add("hidden");
  const sel = el("processSelect");
  if (sel) {
    sel.innerHTML = "";
    sel.disabled = false;
  }

  const insulationBox = el("insulationItemBox");
  const insulationSel = el("insulationItemSelect");
  insulationBox?.classList.add("hidden");
  if (insulationSel) {
    insulationSel.innerHTML = `<option value="">Select item...</option>`;
    insulationSel.disabled = false;
  }

  hideScanStatus();
  if (el("qr-result")) el("qr-result").textContent = "";

  state.stateEnabled = true;
  state.startLockedByStatus = false;
}

