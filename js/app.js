/* Firebase imports */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
    import {
      getFirestore, 
      collection, 
      addDoc, 
      serverTimestamp,
      query, 
      where, 
      orderBy, 
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

/* Helper functions 
    1 - Trim status to remove spaces and convert to lower case
    2 - Get phase from status either rework or process
    3 - Check if the normalize status contains start and returns true
    4 - Check if the normalize status contains end and returns true

*/
    function normalizeStatus(status) {
      return (status || "").trim().toLowerCase();
    }

    function getPhaseFromStatus(status) {
      return normalizeStatus(status).includes("rework")
        ? "rework"
        : "process";
    }

    function isStartLike(status) {
      return normalizeStatus(status).includes("start");
    }

    function isEndLike(status) {
      return normalizeStatus(status).includes("end");
    }

/* Initialize variables */

    let html5QrcodeScanner = null;
    let vesselData = null;   // vessel
    let employeeData = null; // employee
    let qrScanned = false;
    let started = false;

    // Steps: "employee" -> "project" -> "status"
    let currentStep = "employee";

    // Prevent repeated prompts from the same QR / rapid callbacks
    let lastDecodedText = "";
    let lastDecodedAt = 0;
    let alertLock = false;

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

    function setStep(step) {
      currentStep = step;

      // Screens
      el("screen-employee").classList.toggle("hidden", step !== "employee");
      el("screen-project").classList.toggle("hidden", step !== "project");
      el("screen-status").classList.toggle("hidden", step !== "status");

      // Step indicator
      el("step1").classList.toggle("active", step === "employee");
      el("step2").classList.toggle("active", step === "project");
      el("step3").classList.toggle("active", step === "status");

      // Update notes requirement hint
      updateNotesRuleUI();

      // hide scan button when at status step
      const hideScan = (step === "status");
      el("reader").classList.toggle("hidden", hideScan);

      // After updating UI, manage scanner automatically
      if (step === "status") {
        stopScanner();
      } else {
        // employee or project step
        startScanner();
      }

    }

    function updateNotesRuleUI() {
    const status = el("status")?.value || "Start Process";
    const phase = getPhaseFromStatus(status);

    // Process notes optional, Rework notes compulsory
    const mustHaveNotes = phase === "rework";

    el("notes-hint").textContent = mustHaveNotes
        ? "Notes are REQUIRED for Rework."
        : "Notes are OPTIONAL for Process.";
    }


/* Get the station state from firestore */ 

    async function getStationState(db, serialNumber, station, phase) {
      const q = query(
        collection(db, "processLogs"),
        where("serialNumber", "==", serialNumber),
        where("location", "==", station),
        orderBy("createdAt", "asc"),
        limit(100)
      );

      const snap = await getDocs(q);

      let started = false;
      let completed = false;

      snap.forEach(doc => {
        const data = doc.data();
        const status = (data.status || "").toLowerCase();

        // Infer phase from STATUS, not from caller
        const eventPhase = status.includes("rework") ? "rework" : "process";

        // Ignore other phase completely
        if (eventPhase !== phase) return;

        // Project has started if the status includes start
        if (status.includes("start")) started = true;

        // Project has completed if the status includes end and started is true
        if (status.includes("end") && started) completed = true;
      });

      // If the project has not started, return idle status
      if (!started) return "idle";
      
      if (started && !completed) return "running";

      return "completed";
    }

/* Function to clear the form*/

    function clearForm() {
      el("qr-result").innerText = "None";
      el("projectName").innerText = "-";
      el("description").innerText = "-";
      el("materialNumber").innerText = "-";
      el("serialNumber").innerText = "-";

      el("empName").innerText = "-";
      el("empNo").innerText = "-";
      el("empStation").innerText = "-";

      el("notes").value = "";
      el("status").selectedIndex = 0;

      vesselData = null;
      employeeData = null;
      qrScanned = false;
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

            el("empName").innerText = employeeName;
            el("empNo").innerText = employeeNumber;
            el("empStation").innerText = station;


        } else {
            // PROJECT QR: D1;Project Name; Description; Material Number; Serial Number; Model; Chiller Type; Refrigerant
            const parts = text.split(";");
            if (parts.length !== 8) {
            alert("Invalid Project QR format! Expected 8 fields separated by ';'");
            return;
            }

            const [version, projectName, description, materialNumber, serialNumber, model, type, refrigerant] = parts;
            vesselData = { version, projectName, description, materialNumber, serialNumber, model, type, refrigerant };
            qrScanned = true;

            el("projectName").innerText = projectName;
            el("description").innerText = description;
            el("materialNumber").innerText = materialNumber;
            el("serialNumber").innerText = serialNumber;

        }

        // stop scanner after successful scan
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().then(() => (html5QrcodeScanner = null));
        }
        }


    function onScanFailure(_) {}
    
   function startScanner() {
      if (currentStep === "status") return; // scanning disabled on status step
      if (html5QrcodeScanner) return;

      html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
      html5QrcodeScanner.render(onScanSuccess, onScanFailure);
    }

    async function stopScanner() {
      if (!html5QrcodeScanner) return;
      try {
        await html5QrcodeScanner.clear();
      } catch (e) {
        console.warn("Scanner clear failed:", e);
      } finally {
        html5QrcodeScanner = null;
      }
    }

    // EMPLOYEE page submit → go to project page
    el("to-project").addEventListener("click", () => {
      if (!employeeData) {
        alert("Please scan employee QR first.");
        return;
      }
      setStep("project");
    });

    // PROJECT page submit → go to status page
    el("to-status").addEventListener("click", () => {
      if (!vesselData) {
        alert("Please scan project QR first.");
        return;
      }
      setStep("status");
    });


    el("status").addEventListener("change", updateNotesRuleUI);

    

    /* Submit data when submit button is clicked */
    el("submit-data").addEventListener("click", async () => {

    // If QR code not scanned OR vessel data is empty
    if (!qrScanned || !vesselData) {
      alert("Scan Project QR first!");
      return;
    }
    // If employee data is empty
    if (!employeeData) {
      alert("Scan Employee QR first!");
      return;
    }

    // Initilaize serial, station and status
    const serial = vesselData.serialNumber;
    const station = employeeData.station;
    const status = el("status").value;
    const notes = (el("notes").value || "").trim();
    const phase = getPhaseFromStatus(status);

    // Notes rule: REQUIRED for rework, optional for process
    if (phase === "rework" && notes.length === 0) {
    alert("Notes are required for Rework (Start/End Rework).");
    return;
    }

    try {

      const phase = getPhaseFromStatus(status);
      const state = await getStationState(db, serial, station, phase);

      // Check PROCESS state only for normal process
      if (phase === "process") {
        const processState = await getStationState(db, serial, station, "process");

        if (status === "Start Process" && processState !== "idle") {
          alert(`Error: Project ${serial} at ${station} is already running.`);
          return;
        }

        if (status === "End Process" && processState !== "running") {
          alert(`Error: Project ${serial} at ${station} is not running yet.`);
          return;
        }
      }

      // Check REWORK state separately
      if (phase === "rework") {
        const reworkState = await getStationState(db, serial, station, "rework");

        if (status.toLowerCase().includes("start") && reworkState === "running") {
          alert(`Error: Rework for Project ${serial} is already running.`);
          return;
        }

        if (status.toLowerCase().includes("end") && reworkState !== "running") {
          alert(`Error: Rework for Project ${serial} is not running yet.`);
          return;
        }
      }

      // Send data to firestore
      const payload = {
        ...vesselData,
        location: station,
        status,
        notes,
        employeeName: employeeData.employeeName,
        employeeNumber: employeeData.employeeNumber,
        employeeStation: employeeData.station,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, "processLogs"), payload);

      alert("Saved!");
      clearForm();
      setStep("employee");
    } catch (err) {
      console.error(err);

      // Most common: index not ready
      if (err?.code === "failed-precondition" && (err?.message || "").toLowerCase().includes("index")) {
        alert("Firestore index is still building. Wait until it becomes ENABLED, then try again.");
        return;
      }

      if (err?.code === "permission-denied") {
        alert("Permission denied. Check Firestore Rules (write/read).");
        return;
      }

      alert("Error: " + (err?.message || err));
    }
});

window.addEventListener("DOMContentLoaded", () => {
  // start scanning immediately on load (employee step)
  startScanner();
});