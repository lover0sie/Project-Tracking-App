/* Camera scanning is started, stopped, and routed into QR-driven state and UI updates. */

import { state, saveState, shouldIgnoreDuplicate, isFabricationMode } from "./state.js";
import {
  parseChillerQR,
  parseEmployeeQR,
  parseFabricationItemQR,
  parsePvQR
} from "./qr.js";
import { el, setText, showScanStatus, loadProcessesForCurrentUnit, renderFabricationItemList } from "./ui.js";

/* Html5Qrcode is global */

function isDuplicateFabricationItem(newItem) {
  return state.scannedItems.some(item =>
    String(item.itemID).trim().toUpperCase() === String(newItem.itemID).trim().toUpperCase()
  );
}

function handleFabricationItemScan(text) {
  try {
    if (state.scannedItems.length >= 20) {
      showScanStatus("Maximum 20 items per batch session.", "err");
      return;
    }

    const item = parseFabricationItemQR(text);
    if (isDuplicateFabricationItem(item)) {
      showScanStatus(`Duplicate blocked: ${item.itemID}`, "err");
      return;
    }

    state.scannedItems.push(item);
    renderFabricationItemList();
    saveState();
    showScanStatus(`Added item ${item.itemID}`, "ok", 1500);
  } catch (err) {
    showScanStatus(err.message || "Invalid fabrication item QR.", "err");
  }
}

export function updateScanButtonUI() {
  const btn = el("start-scan");
  if (!btn) return;

  btn.disabled = state.currentStep === "status" || state.scanStarting || state.scanStopping;

  if (state.scanStarting) {
    btn.textContent = "Starting Camera...";
    btn.style.background = "#6b7280";
    btn.style.color = "#fff";
  } else if (state.scanStopping) {
    btn.textContent = "Stopping Camera...";
    btn.style.background = "#6b7280";
    btn.style.color = "#fff";
  } else if (state.scanning) {
    btn.textContent = "Stop Scanning";
    btn.style.background = "#dc2626";
    btn.style.color = "#fff";
  } else {
    btn.textContent = "Start Scanning";
    btn.style.background = "#2563eb";
    btn.style.color = "#fff";
  }
}

function resetScanGuard() {
  state.lastDecodedText = "";
  state.lastDecodedAt = 0;
  state.scanHandling = false;
}

function createScanSuccessHandler(onScanSuccessFn) {
  return (decodedText) => {
    if (state.scanHandling || state.scanStopping) return;

    state.scanHandling = true;

    Promise.resolve(onScanSuccessFn(decodedText))
      .catch((err) => {
        console.error("Scan handler failed:", err);
        showScanStatus("Scan failed. Please try again.", "err");
      })
      .finally(() => {
        if (state.scanning) {
          state.scanHandling = false;
        }
      });
  };
}

export async function startScanner(onScanSuccessFn) {
  if (state.currentStep === "status") return;
  if (state.scanning || state.scanStarting || state.scanStopping) return;

  if (typeof Html5Qrcode === "undefined") {
    alert("QR scanner library is still loading. Please try again.");
    return;
  }

  try {
    state.scanStarting = true;
    resetScanGuard();
    updateScanButtonUI();

    state.html5Qr = new Html5Qrcode("reader");
    const handleDecodedText = createScanSuccessHandler(onScanSuccessFn);

    try {
      await state.html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        handleDecodedText,
        () => {}
      );
      state.scanning = true;
      return;
    } catch (e) {
      console.warn("facingMode environment failed, falling back to deviceId...", e);
    }

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) throw new Error("No camera found.");

    const backCam =
      cameras.find(c => /back|rear|environment/i.test(c.label || "")) ||
      cameras[cameras.length - 1];

    await state.html5Qr.start(
      { deviceId: { exact: backCam.id } },
      { fps: 10, qrbox: 250 },
      handleDecodedText,
      () => {}
    );
    state.scanning = true;
  } catch (err) {
    console.error(err);
    state.scanning = false;
    state.html5Qr = null;
    alert("Failed to start camera. Check browser permissions.");
  } finally {
    state.scanStarting = false;
    updateScanButtonUI();
  }
}

export async function stopScanner() {
  if (state.scanStopping) return;

  state.scanStopping = true;
  updateScanButtonUI();

  if (!state.html5Qr) {
    state.scanning = false;
    state.scanStarting = false;
    state.scanStopping = false;
    resetScanGuard();
    updateScanButtonUI();
    return;
  }

  const scanner = state.html5Qr;

  try {
    if (state.scanning) await scanner.stop();
    await scanner.clear();
  } catch (err) {
    console.warn("Stop scanner error:", err);
  } finally {
    state.scanning = false;
    state.scanStarting = false;
    state.scanStopping = false;
    state.html5Qr = null;
    resetScanGuard();
    updateScanButtonUI();
  }
}

export async function onScanSuccess(decodedText, setStepFn) {
  const text = decodedText.trim();

  if (shouldIgnoreDuplicate(text)) return;

  if (el("qr-result")) el("qr-result").innerText = text;

  const isEmployee = text.startsWith("EMP;");

  if (state.currentStep === "employee" && !isEmployee) {
    showScanStatus("Wrong QR. Please scan EMPLOYEE QR.", "err", 2000);
    return;
  }

  if (state.currentStep === "status") {
    showScanStatus("Scanning is disabled on Status page.", "err");
    return;
  }

  if (isEmployee) {
    if (state.currentStep !== "employee") {
      showScanStatus(isFabricationMode() ? "Wrong QR. Please scan ITEM QR." : "Wrong QR. Please scan PROJECT QR.", "err", 2000);
      return;
    }

    let employee;
    try {
      employee = parseEmployeeQR(text);
    } catch {
      showScanStatus("Invalid Employee QR format.", "err");
      return;
    }

    state.employeeData = { ...employee, manpower: null };
    state.scannedItems = [];
    state.vesselData = null;
    state.chillerSerialNumber = null;
    state.activeScope = null;

    setText("empName", employee.employeeName);
    setText("empNo", employee.employeeNumber);
    setText("empStation", employee.station);

    const mp = el("manpowerInput");
    if (mp) mp.value = "";

    saveState();
    showScanStatus("Employee QR code successfully scanned.", "ok");
    await stopScanner();
    return;
  }

  if (state.currentStep === "items" || (state.currentStep === "project" && isFabricationMode())) {
    handleFabricationItemScan(text);
    return;
  }

  if (state.currentStep === "project" && isEmployee) {
    showScanStatus("Wrong QR. Please scan PROJECT QR.", "err", 2000);
    return;
  }

  let pv = null;
  let ch = null;

  try {
    pv = parsePvQR(text);
    ch = parseChillerQR(text);
  } catch (err) {
    showScanStatus(err.message || "Invalid Project QR format!", "err");
    return;
  }

  if (pv) {
    state.chillerSerialNumber = pv.chillerSerialNumber;
    state.vesselData = {
      ...pv,
      serialNumber: pv.pvSerialNumber,
      description: pv.partNumber
    };
    state.activeScope = "PV";

    setText("projectName", pv.projectName);
    setText("description", pv.partNumber);
    setText("materialNumber", pv.materialNumber);
    setText("serialNumber", pv.pvSerialNumber);
    setText("type", pv.vesselType);

    loadProcessesForCurrentUnit();
    showScanStatus("PV QR code successfully scanned.", "ok");
    state.currentStep = "project";
    saveState();
    return;
  }

  if (ch) {
    state.chillerSerialNumber = ch.chillerSerialNumber;
    state.vesselData = { ...ch, serialNumber: ch.chillerSerialNumber };
    state.activeScope = "CHILLER";

    setText("projectName", ch.projectName);
    setText("description", ch.description);
    setText("materialNumber", ch.materialNumber);
    setText("serialNumber", ch.chillerSerialNumber);
    setText("type", ch.coolingType);

    loadProcessesForCurrentUnit();
    showScanStatus("Chiller QR code successfully scanned.", "ok");
    state.currentStep = "project";
    saveState();
    return;
  }

  showScanStatus("Invalid Project QR format!", "err");
}

