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

  /* Helper functions */

  function resetAllData() {
    stateEnabled = false;
    localStorage.removeItem(STATE_KEY);

    employeeData = null;
    vesselData = null;
    qrScanned = false;

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
  }

  function showSaveOverlay(text = "Saving...", isSuccess = false) {
    const overlay = el("saveOverlay");
    const txt = el("saveOverlayText");
    if (!overlay || !txt) return;

    txt.textContent = text;
    txt.classList.toggle("success", !!isSuccess);

    overlay.classList.remove("hidden");
  }

  function hideSaveOverlay() {
    const overlay = el("saveOverlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
  }

    function showScanStatus(msg) {
      const box = el("scan-status");
      if (!box) return;
      box.textContent = msg;
      box.classList.remove("hidden");
  }

  function hideScanStatus() {
      const box = el("scan-status");
      if (!box) return;
      box.classList.add("hidden");
      box.textContent = "";
  }


  const STATE_KEY = "qrAppState_v1";

    function openRemarksModal() {
      el("remarksModal").classList.remove("hidden");
      el("remarksInput").value = "";
      setTimeout(() => el("remarksInput").focus(), 0);
    }

    function closeRemarksModal() {
      el("remarksModal").classList.add("hidden");
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
      runAccumMs
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

/* Initialize variables */

    let html5Qr = null;
    let scanning = false;
    let vesselData = null;   // vessel
    let employeeData = null; // employee
    let suppressNextSave = false;
    let qrScanned = false;
    
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
    let alertLock = false;

    let stateEnabled = true;

    function safeAlert(msg, cooldownMs = 1500) {
      if (alertLock) return;
      alertLock = true;
      alert(msg);
      setTimeout(() => (alertLock = false), cooldownMs);
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
        "Hole Bevelling", 
        "Connector welding", 
        "Fitting and welding distribution box", 
        "Tube support and bush fitting tube sheet fitting",
        "Tubesheet welding",
        "Bracket and attachment welding",
        "Unit side plate and base welding",
        "Tube slotting and expansion",
        "Tube slotting and expansion",
      ],

      // My own testing
      "Station X": [
        "Process 1", 
        "Process 2", 
        "Process 3", 
        "Process 4"],
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
      }

      // disable process dropdown if running
      const proc = el("processSelect");
      if (proc) proc.disabled = runRunning;
    }


    // Function for changing screen
    // Function for changing screen
    async function setStep(step) {
      hideScanStatus();
      currentStep = step;

      // Screens
      el("screen-employee").classList.toggle("hidden", step !== "employee");
      el("screen-project").classList.toggle("hidden", step !== "project");
      el("screen-status").classList.toggle("hidden", step !== "status");

      // Step indicator
      el("step1").classList.toggle("active", step === "employee");
      el("step2").classList.toggle("active", step === "project");
      el("step3").classList.toggle("active", step === "status");

      const inStatus = (step === "status");

      // Hide scanner UI in Status
      el("reader").classList.toggle("hidden", inStatus);

      // Disable/hide Scan button in Status
      const scanBtn = el("start-scan");
      if (scanBtn) {
        scanBtn.disabled = inStatus;
        scanBtn.classList.toggle("hidden", inStatus); // optional
      }

      if (inStatus) {
        await stopScanner(); //  now valid

        renderStopwatch();

        el("btnStartProcess").disabled = runRunning;
        el("btnStopProcess").disabled = !runRunning;

        if (!runRunning) {
          currentRunId = null;
          runAccumMs = 0;
          runStartEpoch = 0;
        }

        // show project info on top
        if (employeeData) {
          if (el("statusStation")) el("statusStation").innerText = employeeData.station || "-";
          if (el("statusManpower")) el("statusManpower").innerText = employeeData.manpower ?? "-";
        }

        if (vesselData) {
          if (el("statusProject")) el("statusProject").innerText = vesselData.projectName || "-";
          if (el("statusMaterial")) el("statusMaterial").innerText = vesselData.materialNumber || "-";
          if (el("statusSerial")) el("statusSerial").innerText = vesselData.serialNumber || "-";
        }

        // lock process dropdown when running
        const proc = el("processSelect");
        if (proc) proc.disabled = runRunning;

      }

      if (suppressNextSave) suppressNextSave = false;
      else saveState();
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

    function onScanSuccess(decodedText) {
        const text = decodedText.trim();

        // Ignore repeated reads of the same QR within a short window
        if (shouldIgnoreDuplicate(text)) return;

        el("qr-result").innerText = text;

        const isEmployee = text.startsWith("EMP;");

        // Enforce step order
        if (currentStep === "employee" && !isEmployee) {
          safeAlert("Please scan EMPLOYEE QR first (EMP;EmpNo;Name;Station).");
          return;
        }
        if (currentStep === "project" && isEmployee) {
          safeAlert("Employee already scanned. Now scan PROJECT QR (D1;...;Refrigerant).");
          return;
        }
        if (currentStep === "status") {
          safeAlert("Status page: scanning is disabled. Submit to continue.");
          return;
        }

        // EMPLOYEE QR: EMP;EmpNo;Name;Station
        if (isEmployee) {
            const parts = text.split(";");
            if (parts.length !== 4) {
            safeAlert("Invalid Employee QR format! Use: EMP;EmpNo;Name;Station");
            return;
            }

            const [, employeeNumber, employeeName, station] = parts;
            employeeData = { employeeNumber, employeeName, station };

            showScanStatus("QR successfully scanned.");
            stopScanner();          // stop camera
            saveState();            // keep everything

            el("empName").innerText = employeeName;
            el("empNo").innerText = employeeNumber;
            el("empStation").innerText = station;

            loadProcessesForStation(employeeData.station);
            

        } else {
            // PROJECT QR: D1;Project Name; Description; Material Number; Serial Number; Model; Chiller Type; Refrigerant
            const parts = text.split(";");
            if (parts.length !== 8) {
            alert("Invalid Project QR format! Expected 8 fields separated by ';'");
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

            showScanStatus("QR successfully scanned.");
            stopScanner();          // stop camera
            saveState();            // keep everything

            qrScanned = true;

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
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras || cameras.length === 0) {
          alert("No camera found.");
          return;
        }

        scanning = true;
        updateScanButtonUI();

        await html5Qr.start(
          { deviceId: { exact: cameras[0].id } }, // pick first camera
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
    if (!html5Qr || !scanning) {
      scanning = false;
      updateScanButtonUI();
      return;
    }

    try {
      await html5Qr.stop();
      await html5Qr.clear();
    } catch (err) {
      console.warn("Stop scanner error:", err);
    } finally {
      scanning = false;
      updateScanButtonUI();
    }
  }

    let swRunning = false;
    let swStartEpoch = 0;   // when started
    let swAccumMs = 0;      // accumulated time
    let swTimer = null;

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


    // EMPLOYEE page submit → go to project page
    el("to-project").addEventListener("click", async () => {
      if (!employeeData) {
        alert("Please scan employee QR first.");
        return;
      }

      const manpower = Number(el("manpowerInput").value || 0);
      if (!Number.isFinite(manpower) || manpower <= 0) {
        alert("Please enter Manpower (must be 1 or more).");
        return;
      }

      employeeData.manpower = manpower; //  store inside employeeData
      saveState();

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
    if (!employeeData) return alert("Scan employee QR first.");
    if (!vesselData) return alert("Scan project QR first.");

    const serialNumber = vesselData.serialNumber;
    const station = employeeData.station;
    const processName = el("processSelect").value;

    // prevent double-running same process
    const active = await findActiveRun(serialNumber, station, processName);
    if (active) {
      currentRunId = active.id; // optional: attach to it
      saveState();
      alert("This process is already running.");
      return;
    }

    const payload = {
      serialNumber,
      station,
      processName,
      status: "running",

      startedByName: employeeData.employeeName,
      startedByNumber: employeeData.employeeNumber,

      manpower: employeeData.manpower ?? null, // ✅ add this

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

    // UI
    el("processSelect").disabled = true;
    el("btnStartProcess").disabled = true;
    el("btnStopProcess").disabled = false;

    // stopwatch
    runAccumMs = 0;
    startStopwatch();
  });

let pendingStop = null; // stores {runId, durationMs} until modal saved

el("btnStopProcess").addEventListener("click", async () => {
  if (!currentRunId) return alert("No running process to stop.");

  // DON'T stop stopwatch here
  pendingStop = {
    runId: currentRunId,
    durationMs: getElapsedMs() // capture current duration as "snapshot"
  };

  openRemarksModal();
});

el("remarksCancel").addEventListener("click", () => {
  pendingStop = null;
  closeRemarksModal();
  // stopwatch was never stopped, so it keeps moving
});

el("remarksSave").addEventListener("click", async () => {
  if (!pendingStop) return closeRemarksModal();

  const { runId } = pendingStop;
  const remarks = (el("remarksInput").value || "").trim();
  pendingStop = null;

  // final duration at save moment
  const durationMs = getElapsedMs();
  stopStopwatch();

  closeRemarksModal();
  showSaveOverlay("Saving process...");

  try {
    await updateDoc(doc(db, "processRuns", runId), {
      status: "completed",
      endAt: serverTimestamp(),
      endEpochMs: Date.now(),
      durationMs,
      remarks
    });

    showSaveOverlay("Process saved", true);

    setTimeout(async () => {
      hideSaveOverlay();
      resetAllData();
      await setStep("employee");
    }, 1200);

  } catch (err) {
    console.error(err);
    hideSaveOverlay();
    alert("Error saving: " + (err?.message || err));
  }

  el("processSelect").disabled = false;
});



window.addEventListener("DOMContentLoaded", () => {
  loadState();
  restoreUIFromState();

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