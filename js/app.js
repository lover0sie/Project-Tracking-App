/* Firebase imports */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
    import {
      getFirestore, 
      collection, 
      updateDoc,
      doc,
      addDoc,
      serverTimestamp,
      query, 
      where, 
      getDocs, 
      limit
    } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* Firebase configuration and database initialization */
  const firebaseConfig = {
    apiKey: "AIzaSyBePrEYgwU4tD9h82n9PbjfxtTyQMXm6Kk",
    authDomain: "qrcodetesting-4f86e.firebaseapp.com",
    projectId: "qrcodetesting-4f86e",
    storageBucket: "qrcodetesting-4f86e.firebasestorage.app",
    messagingSenderId: "746921254909",
    appId: "1:746921254909:web:7acce026b9d96c97880394"
   };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const el = (id) => document.getElementById(id);

  /* ============== Initialize variables ================================ */
  /* Initialize variables */

    const STATE_KEY = "qrAppState_v1";

    let html5Qr = null;
    let scanning = false;
    let vesselData = null;   // vessel
    let employeeData = null; // employee
      
    // Process run state
    let currentRunId = null;      // Firestore doc id for the running process
    let runStartEpoch = 0;        // epoch for stopwatch
    let runTimer = null;
    let runRunning = false;
    let runAccumMs = 0;    

    // Steps: "employee" -> "project" -> "status"
    let currentStep = "employee";

    // Prevent repeated prompts from the same QR / rapid callbacks
    let lastDecodedText = "";
    let lastDecodedAt = 0;
    let stateEnabled = true;

    let resumeLocked = false;
    let resumeRunStatus = null; // "on_hold" | null
    let resumeProcessName = null;
    let startLockedByStatus = false;  // completed lock
    let startInFlight = false;
    let pendingStop = null; // stores {runId, durationMs} until modal saved

   /* ============== Helper functions ====================================== */

    function getVesselTypeFromPvSerial(pvSerial = "") {
    const suffix = pvSerial.trim().slice(-1).toUpperCase();
    const map = {
      E: "EVAPORATOR",
      C: "CONDENSER",
      J: "ECONOMIZER",
      Y: "OIL SEPARATOR",
    };
    return map[suffix] || "UNKNOWN";
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.innerText = value ?? "-";
  }

  /* Get the previous stations */
  function getAllPrevProcessNames(station, currentProcessName) {
    const list = PROCESS_BY_STATION[station] || [];
    const idx = list.indexOf(currentProcessName);
    if (idx <= 0) return [];
    return list.slice(0, idx); // everything before current
  }

   /* Helper to find the hold status */
 
  async function findOnHoldRun(serialNumber, station, processName) {
  const q = query(
    collection(db, "processRuns"),
    where("serialNumber", "==", serialNumber),
    where("station", "==", station),
    where("processName", "==", processName),
    where("status", "==", "on_hold"),
    limit(1)
  );

  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

  /* Function to open hold modal */
  function openHoldModal() {
  el("holdModal").classList.remove("hidden");
  el("holdReason").value = "";
  el("holdRemarks").value = "";

  // force hide remarks every time modal opens
  el("holdRemarks").classList.add("hidden");

  setTimeout(() => el("holdReason").focus(), 0);
}

  /* Function to close hold modal */
  function closeHoldModal() {
      el("holdModal").classList.add("hidden");
  }

  /* Function to convert time to Malaysian time DD-MM-YYYY */
  function getMYDateKey(d = new Date()) {
    // "YYYY-MM-DD" in Asia/Kuala_Lumpur time
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);

    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const day = parts.find(p => p.type === "day").value;
    return `${y}-${m}-${day}`;
  }

  /* Update the stepper for each page */
function updateStepper(step) {
  const idx = step === "employee" ? 1 : step === "project" ? 2 : 3;

  const s1 = el("step1"), s2 = el("step2"), s3 = el("step3");
  [s1, s2, s3].forEach(x => x && x.classList.remove("done","current"));

  if (idx === 1) {
    s1.classList.add("current");
  } else if (idx === 2) {
    s1.classList.add("done");
    s2.classList.add("current");
  } else {
    s1.classList.add("done");
    s2.classList.add("done");
    s3.classList.add("current");
  }

  const fill = el("stepFill");
  if (fill) {
    // 3 steps => 0%, 50%, 100%
    fill.style.width = (idx === 1 ? 0 : idx === 2 ? 50 : 100) + "%";
  }
}

/* Get the range of day */
function getMYDayRange() {
  // Build "today" in Asia/Kuala_Lumpur, then convert to Date objects.
  const now = new Date();

  // Get MY date parts
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find(p => p.type === "year").value);
  const m = Number(parts.find(p => p.type === "month").value);
  const d = Number(parts.find(p => p.type === "day").value);

  // Create MY midnight and next midnight in *local JS Date* by using UTC then offsetting is messy.
  // Use Date.UTC with MY date, then treat as "MY day" boundaries by formatting.
  const myDateStr = `${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  // Turn "YYYY-MM-DDT00:00:00+08:00" into Date
  const start = new Date(`${myDateStr}T00:00:00+08:00`);
  const end   = new Date(`${myDateStr}T24:00:00+08:00`);

  return { start, end, myDateStr };
}

/* Function to reset all data */
function resetAllData() {
  resumeLocked = false;
  resumeRunStatus = null;
  resumeProcessName = null;
  stateEnabled = false;
  localStorage.removeItem(STATE_KEY);

  employeeData = null;
  vesselData = null;

  currentRunId = null;
  runRunning = false;
  runStartEpoch = 0;
  runAccumMs = 0;

  if (runTimer) { clearInterval(runTimer); runTimer = null; }
  renderStopwatch();

  el("empName").innerText = "-";
  el("empNo").innerText = "-";
  el("empStation").innerText = "-";

  el("projectName").innerText = "-";
  el("description").innerText = "-";
  el("materialNumber").innerText = "-";
  el("serialNumber").innerText = "-";

  if (el("statusProject")) el("statusProject").innerText = "-";
  if (el("statusMaterial")) el("statusMaterial").innerText = "-";
  if (el("statusSerial")) el("statusSerial").innerText = "-";
  if (el("statusStation")) el("statusStation").innerText = "-";

  if (el("manpowerInput")) el("manpowerInput").value = "";
  if (el("statusManpower")) el("statusManpower").innerText = "-";

  const sel = el("processSelect");
  if (sel) {
    sel.innerHTML = "";
    sel.disabled = false;
  }

  hideScanStatus();
  if (el("qr-result")) el("qr-result").textContent = "";

  stateEnabled = true;
  startLockedByStatus = false;
}


/* Show the circle of save overlay */
function showSaveOverlay(text = "Saving...", isSuccess = false) {
  const overlay = el("saveOverlay");
  const txt = el("saveOverlayText");
  if (!overlay || !txt) return;

  txt.textContent = text;
  txt.classList.toggle("success", !!isSuccess);

   overlay.classList.remove("hidden");
}


/* Hide the circle of save overlay */
function hideSaveOverlay() {
  const overlay = el("saveOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
}

function showScanStatus(msg, type = "info") {
  const box = el("scan-status");
  if (!box) return;

  box.textContent = msg;
  box.classList.remove("hidden", "ok", "err", "info");
  box.classList.add(type); // "ok" | "err" | "info"
}

function hideScanStatus() {
  const box = el("scan-status");
  if (!box) return;
  box.classList.add("hidden");
  box.textContent = "";
  box.classList.remove("ok", "err", "info");
}

function saveState() {
  if (!stateEnabled) return; //  block saving completely when disabled

  const state = {
    currentStep,
    employeeData,
    vesselData,
    currentRunId,
    runRunning,
    runStartEpoch,
    runAccumMs,
    resumeLocked,
    resumeRunStatus,
    resumeProcessName
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}


  function shouldIgnoreDuplicate(text, windowMs = 1200) {
    const now = Date.now();
    const same = text === lastDecodedText && (now - lastDecodedAt) < windowMs;
    lastDecodedText = text;
    lastDecodedAt = now;
    return same;
  }

  // Set process to stations
  const PROCESS_BY_STATION = {
    "PV 1": [
      "6 - Hole bevelling", 
      "7 - Connector welding",
      "8 - Fitting internal plate and GMAW C&B",
      "9 - Fitting and welding distribution box", 
      "10 - Tube support and bush fitting, tube sheet fitting",
      "11 - Tubesheet welding",
      "12 - Bracket and attachment welding",
      "13 - Unit side plate and base welding",
      "14 - Tube slotting and expansion",
    ],

  
    "PV 2": [
      "6 - Hole bevelling", 
      "7 - Connector welding",
      "8 - Fitting internal plate and GMAW C&B",
      "9 - Fitting and welding distribution box", 
      "10 - Tube support and bush fitting, tube sheet fitting",
      "11 - Tubesheet welding",
      "12 - Bracket and attachment welding",
      "13 - Unit side plate and base welding",
      "14 - Tube slotting and expansion",
    ]

    // Add more stations here peeps
  };

  

// Load the station drop down menu
  function loadProcessesForStation(station) {
    const list = PROCESS_BY_STATION[station] || ["General Process"];
    const sel = el("processSelect");
    sel.innerHTML = "";
    list.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });
  }

  // apply loaded resume to GUI -> locked the process, and user need to click Start to resume
  function applyResumeRunToUI(runDoc) {
    currentRunId = runDoc.id;

    runRunning = false;
    runStartEpoch = 0;
    runAccumMs = Number(runDoc.durationMs || 0);

    resumeLocked = true;
    resumeRunStatus = "on_hold";
    resumeProcessName = runDoc.processName;

    const procSel = el("processSelect");
    if (procSel) {
      procSel.value = runDoc.processName;
      procSel.disabled = true;
    }

    renderStopwatch();
    saveState();

    showScanStatus(
      `Found ON HOLD: "${runDoc.processName}". Time: ${formatMs(runAccumMs)}. Press Start to resume.`,
      "info"
    );

    syncStatusButtons();
  }

  function loadState() {
    
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;

    try {
      const state = JSON.parse(raw);

      currentStep = state.currentStep || "employee";
      employeeData = state.employeeData || null;
      vesselData = state.vesselData || null;

      currentRunId = state.currentRunId || null;
      runRunning = !!state.runRunning;
      runStartEpoch = state.runStartEpoch || 0;
      runAccumMs = state.runAccumMs || 0;

      resumeLocked = !!state.resumeLocked;
      resumeRunStatus = state.resumeRunStatus || null;
      resumeProcessName = state.resumeProcessName || null;

      // restore UI
      if (employeeData) {
        el("empName").innerText = employeeData.employeeName;
        el("empNo").innerText = employeeData.employeeNumber;
        el("empStation").innerText = employeeData.station;
        loadProcessesForStation(employeeData.station);
      }

      if (vesselData) {
        el("projectName").innerText = vesselData.projectName;
        el("description").innerText = vesselData.description;
        el("materialNumber").innerText = vesselData.materialNumber;
        el("serialNumber").innerText = vesselData.serialNumber;
      }

      setStep(currentStep);

      // resume stopwatch if running
      if (runRunning) {
        runTimer = setInterval(renderStopwatch, 200);
      }

      renderStopwatch();

    } catch (e) {
      console.error("State load failed", e);
      localStorage.removeItem(STATE_KEY);
    }
 }

  function syncStatusButtons() {
    const startBtn = el("btnStartProcess");
    const stopBtn  = el("btnStopProcess");
    const holdBtn  = el("btnHoldProcess");
    const procSel  = el("processSelect");
    if (!startBtn || !stopBtn || !holdBtn) return;

    // Start is allowed when:
    // - NOT running
    // - NOT in-flight
    // - NOT locked as completed
    const startDisabled = runRunning || startInFlight || startLockedByStatus;

    startBtn.disabled = startDisabled;
    stopBtn.disabled  = !runRunning;
    holdBtn.disabled  = !runRunning;

    // process dropdown locked if running or resume-locked
    if (procSel) procSel.disabled = runRunning || resumeLocked;
  }

  function restoreUIFromState() {
    // Restore employee UI
    if (employeeData) {
      el("empName").innerText = employeeData.employeeName || "-";
      el("empNo").innerText = employeeData.employeeNumber || "-";
      el("empStation").innerText = employeeData.station || "-";
      loadProcessesForStation(employeeData.station);
    }

    // Restore project UI
    if (vesselData) {
      el("projectName").innerText = vesselData.projectName || "-";
      el("description").innerText = vesselData.description || "-";
      el("materialNumber").innerText = vesselData.materialNumber || "-";
      el("serialNumber").innerText = vesselData.serialNumber || "-";
    }

    // Go to correct screen (this also stops scanner if status)
    setStep(currentStep);

    // Resume stopwatch display/tick if it was running
    renderStopwatch();
    if (runRunning && !runTimer) {
      if (!runTimer) runTimer = setInterval(renderStopwatch, 200);
      // If a run is active, keep buttons consistent
      el("btnStartProcess").disabled = true;
      el("btnStopProcess").disabled = false;
      el("btnHoldProcess").disabled = false;
    }

    // Disable process dropdown if running
    const proc = el("processSelect");
    if (proc) proc.disabled = runRunning;
  }

  // Check database if previous process has completed or not (same serial and station)
  // Global completion -  if any station has completed the process
  async function hasCompletedProcess(serialNumber, station, processName) {
  const q = query(
    collection(db, "processRuns"),
    where("serialNumber", "==", serialNumber),
    where("processName", "==", processName),
    where("status", "==", "completed"),
    limit(1)
  );

  const snap = await getDocs(q);
  return !snap.empty;
}
  // Function for changing screen
  async function setStep(step) {
    hideScanStatus();
    currentStep = step;
    updateStepper(step);

    // SHOW/HIDE SCREENS 
    el("screen-employee")?.classList.toggle("hidden", step !== "employee");
    el("screen-project")?.classList.toggle("hidden", step !== "project");
    el("screen-status")?.classList.toggle("hidden", step !== "status");

    const inStatus = (step === "status");

    // Hide scanner UI in Status
    el("reader")?.classList.toggle("hidden", inStatus);

    // Disable/hide Scan button in Status
    const scanBtn = el("start-scan");
    if (scanBtn) {
        scanBtn.disabled = inStatus;
        scanBtn.classList.toggle("hidden", inStatus);
    }

    if (inStatus) {
      if (employeeData?.station) loadProcessesForStation(employeeData.station);
      await stopScanner();
      renderStopwatch();
      syncStatusButtons();

      if (!runRunning && !resumeLocked) {
        currentRunId = null;
        runAccumMs = 0;
        runStartEpoch = 0;
      }

      // show project info on top
      if (employeeData) {
        el("statusStation") && (el("statusStation").innerText = employeeData.station || "-");
        el("statusManpower") && (el("statusManpower").innerText = employeeData.manpower ?? "-");
      }
      if (vesselData) {
        el("statusProject") && (el("statusProject").innerText = vesselData.projectName || "-");
        el("statusMaterial") && (el("statusMaterial").innerText = vesselData.materialNumber || "-");
        el("statusSerial") && (el("statusSerial").innerText = vesselData.serialNumber || "-");
      }

      // lock process dropdown when running
        const proc = el("processSelect");
        if (proc) proc.disabled = runRunning;

         // If we have enough data, auto-check for on_hold for the currently selected process
        if (employeeData && vesselData) {
          const serialNumber = vesselData.serialNumber;
          const station = employeeData.station;
          const procSel = el("processSelect");
          const processName = procSel ? procSel.value : null;

          if (processName) {
            try {
              const onHold = await findOnHoldRun(serialNumber, station, processName);
              if (onHold) {
                // DO NOT updateDoc here
                // DO NOT startStopwatch here
                 applyResumeRunToUI(onHold);   // just load + lock UI
              }
              else {
                // No on-hold, normal idle state
                resumeLocked = false;
                resumeRunStatus = null;
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


  /* Get the station state from firestore */ 

  async function findActiveRun(serialNumber, station, processName) {
    const q = query(
      collection(db, "processRuns"),
      where("serialNumber", "==", serialNumber),
      where("station", "==", station),
      where("processName", "==", processName),
      where("status", "==", "running"),
      limit(1)
      );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }



/* Function to parse the scanned QR code when scan succeeded */

  async function onScanSuccess(decodedText) {
        const text = decodedText.trim();

        // Ignore repeated reads of the same QR within a short window
        if (shouldIgnoreDuplicate(text)) return;

        el("qr-result").innerText = text;

        const isEmployee = text.startsWith("EMP;");

        // Enforce step order
        // Enforce step order (NO popup)
        if (currentStep === "employee" && !isEmployee) {
          showScanStatus("Wrong QR. Please scan EMPLOYEE QR.", "err");
          return;
        }
        if (currentStep === "project" && isEmployee) {
          showScanStatus("Wrong QR. Please scan PROJECT QR.", "err");
          setTimeout(hideScanStatus, 2000);
          return;
        }
        if (currentStep === "status") {
          showScanStatus("Scanning is disabled on Status page.", "err");
          return;
        }

        // EMPLOYEE QR: EMP;EmpNo;Name;Station
        if (isEmployee) {
          const parts = text.split(";");
          if (parts.length !== 4) {
            showScanStatus("Invalid Employee QR format.", "err");
            return;
          }

          const [, employeeNumber, employeeName, station] = parts;

          // manpower NOT collected yet
          employeeData = { employeeNumber, employeeName, station, manpower: null };

          // update UI
          el("empName").innerText = employeeName;
          el("empNo").innerText = employeeNumber;
          el("empStation").innerText = station;

          // reset manpower field each time new employee is scanned
          const mp = el("manpowerInput");
          if (mp) mp.value = "";

          loadProcessesForStation(station);

          saveState();

          // stop scanning but stay on employee screen
          showScanStatus("Employee QR code successfully scanned.", "ok");
          await stopScanner();

          return;


        } else {
            // PROJECT QR: D1;Project Name; Description; Material Number; Serial Number; Model; Chiller Type; Refrigerant
            const parts = text.split(";");
            if (parts.length !== 8) {
            showScanStatus("Invalid Project QR format!", "err");
            return;
            }

            const [version, projectName, description, materialNumber, serialNumber, model, type, refrigerant] = parts;
            vesselData = { 
              version, 
              projectName, 
              description, 
              materialNumber, 
              serialNumber, 
              model, 
              type, 
              refrigerant 
            };

            showScanStatus("Project QR code successfully scanned.","ok");
            stopScanner();          // stop camera
            saveState();            // keep everything

            el("projectName").innerText = projectName;
            el("description").innerText = description;
            el("materialNumber").innerText = materialNumber;
            el("serialNumber").innerText = serialNumber;

        }

  }


  function onScanFailure(_) {}

  function updateScanButtonUI() {
    const btn = el("start-scan");
    if (!btn) return;

    if (scanning) {
      btn.textContent = "Stop Scanning";
      btn.style.background = "#dc2626"; // red
      btn.style.color = "#fff";
    } else {
      btn.textContent = "Start Scanning";
      btn.style.background = "#2563eb"; // blue
      btn.style.color = "#fff";
    }
  }

    
  async function startScanner() {
    if (currentStep === "status") return;
    if (scanning) return;

    if (!html5Qr) html5Qr = new Html5Qrcode("reader");

    try {
      scanning = true;
      updateScanButtonUI();

      // 1) Try force back camera (best for iPhone)
    try {
      await html5Qr.start(
      { facingMode: "environment" }, //  back camera
      { fps: 10, qrbox: 250 },
      (decodedText) => onScanSuccess(decodedText),
        () => {}
      );
      return; // success
      } catch (e) {
        // If facingMode fails on some devices, fall back to deviceId
        console.warn("facingMode environment failed, falling back to deviceId...", e);
      }

      // 2) Fallback: pick a back camera from list
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        throw new Error("No camera found.");
      }

      const backCam =
        cameras.find(c => /back|rear|environment/i.test(c.label || "")) ||
        cameras[cameras.length - 1];

      await html5Qr.start(
        { deviceId: { exact: backCam.id } },
        { fps: 10, qrbox: 250 },
        (decodedText) => onScanSuccess(decodedText),
          () => {}
      );
    } catch (err) {
      console.error(err);
      scanning = false;
      updateScanButtonUI();
      alert("Failed to start camera. Check browser permissions.");
    }
  }


  async function stopScanner() {
    if (!html5Qr) {
      scanning = false;
      updateScanButtonUI();
      return;
    }

    try {
    if (scanning) {
      await html5Qr.stop();
    }

    // Clear camera UI safely
    await html5Qr.clear();

    } catch (err) {
      console.warn("Stop scanner error:", err);
    } finally {
      scanning = false;
      html5Qr = null;   //  IMPORTANT: reset instance for clean restart
      updateScanButtonUI();
    }
}

 

    function formatMs(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    }


    function getElapsedMs() {
      if (!runRunning) return runAccumMs;
      return runAccumMs + (Date.now() - runStartEpoch);
    }

    // update UI
    function renderStopwatch() {
      el("stopwatch").textContent = formatMs(getElapsedMs());
    }

    
    function startStopwatch() {
      if (runRunning) return;
      runRunning = true;
      runStartEpoch = Date.now();
      runTimer = setInterval(renderStopwatch, 200);
      renderStopwatch();
      saveState();
    }

   function stopStopwatch() {
      if (!runRunning) return;
      runAccumMs += Date.now() - runStartEpoch;
      runRunning = false;
      clearInterval(runTimer);
      runTimer = null;
      renderStopwatch();
    }

    // refresh display when returning from background
        document.addEventListener("visibilitychange", () => {
      if (!document.hidden) renderStopwatch();
    });

    // initial display
    renderStopwatch();


    // EMPLOYEE page submit, go to project page
    el("to-project").addEventListener("click", async () => {
      if (!employeeData) {
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

      employeeData.manpower = manpower;
      saveState();

      showScanStatus("Manpower saved. Now scan Project QR.", "ok");
      await setStep("project");
    });


    // PROJECT page submit → go to status page
    el("to-status").addEventListener("click", () => {
      if (!vesselData) {
        alert("Please scan project QR first.");
        return;
      }
      setStep("status");
    });


    el("start-scan").addEventListener("click", async () => {
      if (currentStep === "status") return;

      
      hideScanStatus();

      if (scanning) await stopScanner();
      else await startScanner();
    });


 el("btnStartProcess").addEventListener("click", async () => {
  if (startInFlight || runRunning) return;
  if (!employeeData) return showScanStatus("Scan employee QR first.", "err");
  if (!vesselData) return showScanStatus("Scan project QR first.", "err");

  const startBtn = el("btnStartProcess");
  const stopBtn  = el("btnStopProcess");
  const holdBtn  = el("btnHoldProcess");
  const processSel = el("processSelect");
  const originalStartText = startBtn.textContent;

  startInFlight = true;
  syncStatusButtons();

  try {
    const serialNumber = vesselData.serialNumber;
    const station = employeeData.station;
    const processName = processSel.value;
    const runDate = getMYDateKey();

    // 1) Block if already running
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      showScanStatus("This process is already running.", "err");
      startLockedByStatus = true;      // lock start after this error
      syncStatusButtons();
      return;
    }

    // 2) RESUME FIRST if UI already loaded an on-hold run
    if (resumeRunStatus === "on_hold" && currentRunId) {
      startBtn.textContent = "Starting...";
      showScanStatus("Resuming process...", "info");

      if (resumeProcessName && processSel.value !== resumeProcessName) {
        processSel.value = resumeProcessName;
      }
      processSel.disabled = true;
      resumeLocked = true;

      await updateDoc(doc(db, "processRuns", currentRunId), {
        status: "running",
        resumedAt: serverTimestamp(),
        resumedEpochMs: Date.now(),
        resumedByName: employeeData.employeeName,
        resumedByNumber: employeeData.employeeNumber
      });

      stopBtn.disabled = false;
      holdBtn.disabled = false;

      startStopwatch();
      showScanStatus("Process resumed (running).", "ok");
      saveState();
      return;
    }

    // 3) If not loaded yet, check DB for ON HOLD and load it
    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (onHold) {
      applyResumeRunToUI(onHold);
      showScanStatus(`Loaded ON HOLD run. Press Start to resume.`, "info");
      return;
    }

    // 4) Block if completed
   const completed = await hasCompletedProcess(serialNumber, station, processName);
    if (completed) {
      startLockedByStatus = true;
      showScanStatus("This process is already COMPLETED. Start is blocked.", "err");
      syncStatusButtons();
      return;
    }

    // Now we are truly starting a new run
    startBtn.textContent = "Starting...";
    showScanStatus("Starting process...", "info");

    // 5) Prerequisite check
    const prevList = getAllPrevProcessNames(station, processName);
    for (const p of prevList) {
      const ok = await hasCompletedProcess(serialNumber, station, p);
      if (!ok) {
        showScanStatus(`Cannot start. Please complete: ${p} first.`, "err");
        return;
      }
    }

    // 6) New run
    processSel.disabled = true;
    resumeLocked = false;

    const payload = {
      serialNumber,
      station,
      processName,
      runDate,
      status: "running",
      startedByName: employeeData.employeeName,
      startedByNumber: employeeData.employeeNumber,
      manpower: employeeData.manpower,
      startAt: serverTimestamp(),
      startEpochMs: Date.now(),
      projectName: vesselData.projectName,
      materialNumber: vesselData.materialNumber,
      description: vesselData.description,
      version: vesselData.version
    };

    const ref = await addDoc(collection(db, "processRuns"), payload);
    currentRunId = ref.id;
    saveState();

    stopBtn.disabled = false;
    holdBtn.disabled = false;

    runAccumMs = 0;
    startStopwatch();
    showScanStatus("Process is running.", "ok");

  } catch (err) {
    console.error(err);
    showScanStatus("Failed to start/resume process. Please try again.", "err");
  } finally {
    startInFlight = false;
    startBtn.textContent = originalStartText;
    syncStatusButtons();
  }
});

el("btnStopProcess").addEventListener("click", async () => {
  if (!currentRunId) {
    showScanStatus("No running process to complete.", "err");
    return;
  }

  if (!runRunning) {
    showScanStatus("Process is not running.", "err");
    return;
  }

  const durationMs = getElapsedMs();
  stopStopwatch();

  showSaveOverlay("Saving (Completed)...");

  try {
    await updateDoc(doc(db, "processRuns", currentRunId), {
      status: "completed",
      endAt: serverTimestamp(),
      endEpochMs: Date.now(),
      durationMs
    });

    showSaveOverlay("Process completed", true);

    setTimeout(async () => {
      hideSaveOverlay();
      resetAllData();
      startLockedByStatus = false;   // unlock everything
      await setStep("employee");
      syncStatusButtons();
    }, 900);

  } catch (err) {
    console.error(err);
    hideSaveOverlay();
    showScanStatus("Failed to complete process. Try again.", "err");
  }
});


el("btnHoldProcess").addEventListener("click", () => {
  if (!currentRunId) return showScanStatus("No running process to hold.", "err");
  openHoldModal();
});

const holdCancelBtn = el("holdCancel");
if (holdCancelBtn) {
  holdCancelBtn.addEventListener("click", () => {
    closeHoldModal();
    syncStatusButtons();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  loadState();
  restoreUIFromState();
  syncStatusButtons();

  // DO NOT auto start scanner
  stopScanner();
  updateScanButtonUI();
});

window.addEventListener("beforeunload", (e) => {
  if (runRunning) {
    e.preventDefault();
    e.returnValue = "";
  }
});


el("holdReason").addEventListener("change", () => {
  const reason = el("holdReason").value;
  const remarksBox = el("holdRemarks");

  if (reason === "others") {
    remarksBox.classList.remove("hidden");
  } else {
    remarksBox.classList.add("hidden");
    remarksBox.value = "";
  }
});

el("holdSave").addEventListener("click", async () => {
  if (!currentRunId) return closeHoldModal();

  const reason = (el("holdReason").value || "").trim();
  const remarksRaw = (el("holdRemarks").value || "").trim();

  if (!reason) return showScanStatus("Please select a hold reason.", "err");

  // require remarks ONLY if others
  if (reason === "others" && !remarksRaw) {
    showScanStatus("Remarks are required when 'Others' is selected.", "err");
    el("holdRemarks").focus();
    return;
  }

  const finalRemarks = (reason === "others") ? remarksRaw : "";

  // capture duration before stopping
  const durationMs = getElapsedMs();
  stopStopwatch();

  closeHoldModal();
  showSaveOverlay("Saving (On Hold)...");

  try {
    await updateDoc(doc(db, "processRuns", currentRunId), {
      status: "on_hold",
      holdAt: serverTimestamp(),
      holdEpochMs: Date.now(),
      durationMs,
      holdReason: reason,
      remarks: finalRemarks
    });

    showSaveOverlay("Saved as On Hold", true);

    setTimeout(async () => {
      hideSaveOverlay();
      resetAllData();
      await setStep("employee");
    }, 900);

  } catch (err) {
    console.error(err);
    hideSaveOverlay();
    showScanStatus("Failed to save On Hold. Try again.", "err");
  }
});

el("processSelect")?.addEventListener("change", async () => {
  if (currentStep !== "status") return;
  if (!employeeData || !vesselData) return;
  if (runRunning) return;

  showScanStatus("Checking status...", "info");

  // Reset selection state
  resumeLocked = false;
  resumeRunStatus = null;
  resumeProcessName = null;
  currentRunId = null;
  runAccumMs = 0;
  runStartEpoch = 0;

  // IMPORTANT: unlock completed lock when user selects a different process
  startLockedByStatus = false;

  renderStopwatch();
  saveState();
  syncStatusButtons();

  const serialNumber = vesselData.serialNumber;
  const station = employeeData.station;
  const processName = el("processSelect").value;

  try {
    // 1) on_hold -> load UI, Start should be enabled
    const onHold = await findOnHoldRun(serialNumber, station, processName);
    if (onHold) {
      applyResumeRunToUI(onHold); // sets resumeLocked/resumeRunStatus/currentRunId/runAccumMs
      hideScanStatus();
      syncStatusButtons();
      return;
    }

    // 2) completed -> lock Start
    const completed = await hasCompletedProcess(serialNumber, station, processName);
    if (completed) {
      startLockedByStatus = true;
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
    startLockedByStatus = false; // safe default
    syncStatusButtons();
  }
});
