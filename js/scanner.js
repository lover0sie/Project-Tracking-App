import { state, saveState, shouldIgnoreDuplicate } from "./state.js";
import { el, setText, showScanStatus, loadProcessesForCurrentUnit } from "./ui.js";

/* Html5Qrcode is global */

// A CHILLER QR payload is parsed into structured fields.
function parseChillerQR(text) {
  const p = text.split(";").map(s => s.trim());
  if (p.length !== 8) return null;

  const [version, projectName, description, materialNumber, chillerSerialNumber, model, coolingType, refrigerant] = p;

  return {
    qrKind: "CHILLER",
    version, 
    projectName, 
    description, 
    materialNumber,
    chillerSerialNumber, 
    model, 
    coolingType, 
    refrigerant
  };
}

// A PV QR payload is parsed into structured fields.
function parsePvQR(text) {
  const p = text.split(";").map(s => s.trim());
  if (p.length !== 9) return null;

  const [version, projectName, partNumber, materialNumber, chillerSerialNumber, pvSerialNumber, vesselType, model, refrigerant] = p;

  return {
    qrKind: "PV",
    version, 
    projectName, 
    partNumber, 
    materialNumber,
    chillerSerialNumber,
    pvSerialNumber,
    vesselType, 
    model, 
    refrigerant
  };
}

// Wiring Shop QR support is still in progress.
// function parseWdQR (text) {
//   const p = text.split(";").map(s => s.trim());
//   if (p.length !== 8) return null;
//
//   const [version, projectName, description, materialNumber, serialNumber, model, coolingType, item] = p;
//
//   return {
//     qrKind: "Wiring Shop",
//     version,
//     projectName,
//     description,
//     materialNumber,
//     serialNumber,
//     model,
//     coolingType,
//     item
//   };
// }

// The scan button label and style are synchronized with scanner state.
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

// The camera scanner is started with back-camera fallback behavior.
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

// The camera scanner is stopped and scanner resources are released.
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


// A decoded QR value is validated and routed through the step-based flow.
export async function onScanSuccess(decodedText, setStepFn) {
  const text = decodedText.trim();

  if (shouldIgnoreDuplicate(text)) return;

  if (el("qr-result")) el("qr-result").innerText = text;

  const isEmployee = text.startsWith("EMP;");

  // enforce step order
  if (state.currentStep === "employee" && !isEmployee) {
    showScanStatus("Wrong QR. Please scan EMPLOYEE QR.", "err", 2000);
    return;
  }
  if (state.currentStep === "project" && isEmployee) {
    showScanStatus("Wrong QR. Please scan PROJECT QR.", "err", 2000);
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

    const [, employeeNumberRaw, employeeNameRaw, stationRaw] = parts;

    const employeeNumber = (employeeNumberRaw || "").trim();
    const employeeName   = (employeeNameRaw   || "").trim();
    const station        = (stationRaw        || "").trim();

    state.employeeData = { employeeNumber, employeeName, station, manpower: null };

    setText("empName", employeeName);
    setText("empNo", employeeNumber);
    setText("empStation", station);

    const mp = el("manpowerInput");
    if (mp) mp.value = "";

    saveState();

    showScanStatus("Employee QR code successfully scanned.", "ok");
    await stopScanner();
    return;
  }

    // PROJECT QR
  const pv = parsePvQR(text);
  const ch = parseChillerQR(text);

  // ---- PV QR (REQUIRED) ----
  if (pv) {
    // enforce: must scan PV to work (requirement)
    state.chillerSerialNumber = pv.chillerSerialNumber;
    state.vesselData = {
      ...pv,
      // unify some UI fields app already uses
      serialNumber: pv.pvSerialNumber,  // what you show in UI
      description: pv.partNumber        // what you show as description
    };
    state.activeScope = "PV";

    setText("projectName", pv.projectName);
    setText("description", pv.partNumber);
    setText("materialNumber", pv.materialNumber);
    setText("serialNumber", pv.pvSerialNumber);
    setText("type", pv.vesselType);

    // update process dropdown now that we know vesselType
    loadProcessesForCurrentUnit();

    
    showScanStatus("PV QR code successfully scanned.", "ok");
    state.currentStep = "project";
    saveState();
    await stopScanner();
    return;
  }

  // ---- CHILLER QR (optional: allow view only OR block) ----
  if (ch) {

    // Otherwise: allow storing chiller info but keep scope CHILLER
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
