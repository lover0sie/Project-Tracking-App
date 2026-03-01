import { state, saveState, shouldIgnoreDuplicate, getVesselTypeFromPvSerial } from "./state.js";
import { el, setText, showScanStatus, loadProcessesForVessel } from "./ui.js";

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

    // 1) Try back camera
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

    // 2) fallback: select a back camera
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

  // enforce step order
  if (state.currentStep === "employee" && !isEmployee) {
    showScanStatus("Wrong QR. Please scan EMPLOYEE QR.", "err");
    return;
  }
  if (state.currentStep === "project" && isEmployee) {
    showScanStatus("Wrong QR. Please scan PROJECT QR.", "err");
    setTimeout(() => showScanStatus("", "info"), 2000);
    return;
  }
  if (state.currentStep === "status") {
    showScanStatus("Scanning is disabled on Status page.", "err");
    return;
  }

  // EMPLOYEE QR
  if (isEmployee) {
    const parts = text.split(";");
    if (parts.length !== 4) {
      showScanStatus("Invalid Employee QR format.", "err");
      return;
    }

    const [, employeeNumber, employeeName, station] = parts;

    state.employeeData = { employeeNumber, employeeName, station, manpower: null };

    setText("empName", employeeName);
    setText("empNo", employeeNumber);
    setText("empStation", station);

    const mp = el("manpowerInput");
    if (mp) mp.value = "";

    loadProcessesForVessel(state.vesselData);

    saveState();

    showScanStatus("Employee QR code successfully scanned.", "ok");
    await stopScanner();
    return;
  }

  // PROJECT QR
  const parts = text.split(";").map(s => s.trim());

  // PV QR (9 fields)
  if (parts.length === 9) {
    const [
      version,
      projectName,
      partNumber,
      materialNumber,
      chillerSerialNumber,
      pvSerialNumber,
      typeText,
      model,
      refrigerant
    ] = parts;

    const derived = getVesselTypeFromPvSerial(pvSerialNumber);
    const vesselType = (typeText || "").trim() || derived;

    state.vesselData = {
      qrKind: "PV",
      version,
      projectName,
      partNumber,
      partDescription: partNumber, // keep if you want (optional)
      materialNumber,
      chillerSerialNumber,
      pvSerialNumber,
      vesselType,
      model,
      refrigerant,

      serialNumber: pvSerialNumber,
      description: partNumber
    };

    showScanStatus("PV QR code successfully scanned.", "ok");
    await stopScanner();
    saveState();

    setText("projectName", projectName);
    setText("description", partNumber);
    setText("materialNumber", materialNumber);
    setText("serialNumber", pvSerialNumber);
    setText("type", vesselType);

    return;
  }

  // CHILLER QR (8 fields)
  if (parts.length === 8) {
    const [version, projectName, description, materialNumber, serialNumber, model, type, refrigerant] = parts;

    state.vesselData = {
      qrKind: "CHILLER",
      version,
      projectName,
      description,
      materialNumber,
      serialNumber,
      model,
      type,
      refrigerant
    };

    showScanStatus("Chiller QR code successfully scanned.", "ok");
    await stopScanner();
    saveState();

    setText("projectName", projectName);
    setText("description", description);
    setText("materialNumber", materialNumber);
    setText("serialNumber", serialNumber);
    setText("type", type);

    return;
  }

  showScanStatus("Invalid Project QR format!", "err");
}