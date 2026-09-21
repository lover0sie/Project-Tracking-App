/* Camera scanning is started, stopped, and routed into QR-driven state and UI updates. */

import { state, saveState, shouldIgnoreDuplicate, isFabricationMode } from "./state.js";
import {
  parseChillerQR,
  parseEmployeeQR,
  parseFabricationProjectQR,
  parsePvQR
} from "./qr.js";
import { el, setText, showScanStatus, loadProcessesForCurrentUnit } from "./ui.js";

/* Html5Qrcode is global */

export function updateScanButtonUI() {
  const btn = el("start-scan");
  if (!btn) return;

  if (state.scanning) {
    btn.textContent = "Stop Scanning";
    btn.style.background = "#dc2626";
    btn.style.color = "#fff";
  } else {
    btn.textContent = "Start Scanning";
    btn.style.background = "#2563eb";
    btn.style.color = "#fff";
  }
}

export async function startScanner(onScanSuccessFn) {
  if (state.currentStep === "status") return;
  if (state.scanning) return;

  if (!state.html5Qr) state.html5Qr = new Html5Qrcode("reader");

  try {
    state.scanning = true;
    updateScanButtonUI();

    try {
      await state.html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => onScanSuccessFn(decodedText),
        () => {}
      );
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
      (decodedText) => onScanSuccessFn(decodedText),
      () => {}
    );
  } catch (err) {
    console.error(err);
    state.scanning = false;
    updateScanButtonUI();
    alert("Failed to start camera. Check browser permissions.");
  }
}

export async function stopScanner() {
  if (!state.html5Qr) {
    state.scanning = false;
    updateScanButtonUI();
    return;
  }

  try {
    if (state.scanning) await state.html5Qr.stop();
    await state.html5Qr.clear();
  } catch (err) {
    console.warn("Stop scanner error:", err);
  } finally {
    state.scanning = false;
    state.html5Qr = null;
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
      showScanStatus(isFabricationMode() ? "Wrong QR. Please scan PV or Chiller QR." : "Wrong QR. Please scan PROJECT QR.", "err", 2000);
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

  if (state.currentStep === "project" && isEmployee) {
    showScanStatus("Wrong QR. Please scan PROJECT QR.", "err", 2000);
    return;
  }

  let pv = null;
  let ch = null;

  try {
    if (isFabricationMode()) {
      pv = parseFabricationProjectQR(text);
    } else {
      pv = parsePvQR(text);
      ch = parseChillerQR(text);
    }
  } catch (err) {
    showScanStatus(err.message || "Invalid Project QR format!", "err");
    return;
  }

  if (pv && isFabricationMode()) {
    state.chillerSerialNumber = pv.chillerSerialNumber;
    state.vesselData = pv;
    state.activeScope = "FABRICATION_ITEM";

    setText("projectName", pv.projectName);
    setText("description", pv.description);
    setText("materialNumber", pv.materialNumber);
    setText("serialNumber", pv.chillerSerialNumber);
    setText("type", pv.type);

    loadProcessesForCurrentUnit();
    showScanStatus("Project QR code successfully scanned.", "ok");
    state.currentStep = "project";
    saveState();
    await stopScanner();
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
    await stopScanner();
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
    await stopScanner();
    return;
  }

  showScanStatus("Invalid Project QR format!", "err");
}

