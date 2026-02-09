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

/* Debug messages */

    const el = (id) => document.getElementById(id);
    const debug = (msg) => {
      console.log(msg);
      el("debug").textContent = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
    };


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

/* Function to clear the form and update debug */

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

      debug("Cleared. Ready.");
    }

/* Function to parse the scanned QR code when scan succeeded */

    function onScanSuccess(decodedText) {
      const text = decodedText.trim();
      el("qr-result").innerText = text;

        // EMPLOYEE QR: EMP;EmpNo;Name;Station
        if (text.startsWith("EMP;")) {
            const parts = text.split(";");
            if (parts.length !== 4) {
            alert("Invalid Employee QR format! Use: EMP;EmpNo;Name;Station 1");
            return;
            }

        // Store in array
        const [, employeeNumber, employeeName, station] = parts;

        employeeData = { employeeNumber, employeeName, station };

        el("empName").innerText = employeeName;
        el("empNo").innerText = employeeNumber;
        el("empStation").innerText = station;

        // Update debug 
        debug({ employeeScanned: employeeData });

      } else {
        // PROJECT QR: D1;Project Name; Description; Material Number; Serial Number; Model; Chiller Type; Refrigerant
        const parts = text.split(";");
        if (parts.length !== 8) {
          alert("Invalid Project QR format!");
          return;
        }

        // Store in array
        const [version, projectName, description, materialNumber, serialNumber, model, type, refrigerant] = parts;
        vesselData = { version, projectName, description, materialNumber, serialNumber, model, type, refrigerant };
        qrScanned = true;

        el("projectName").innerText = projectName;
        el("description").innerText = description;
        el("materialNumber").innerText = materialNumber;
        el("serialNumber").innerText = serialNumber;

        // Update debug
        debug({ projectScanned: vesselData });
      }

      // Stops and removes QR code scanner if its running
      if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().then(() => html5QrcodeScanner = null);
      }
    }

    function onScanFailure(_) {}
    
    /* Starts QR code scanning when scan qr code button is pressed */
    el("start-scan").addEventListener("click", () => {
      if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
        html5QrcodeScanner.render(onScanSuccess, onScanFailure);
        debug("Scanner started...");
      }
    });

    /* Calls function to clear form when button clear button is clicked */
    el("clear-data").addEventListener("click", clearForm);
    debug("Clear button clicked.")

    /* Submit data when submit button is clicked */
    el("submit-data").addEventListener("click", async () => {

    // If QR code not scanned OR vessel data is empty
    if (!qrScanned || !vesselData) {
      alert("Scan Project QR first!");
      debug("Blocked: project not scanned");
      return;
    }
    // If employee data is empty
    if (!employeeData) {
      alert("Scan Employee QR first!");
      debug("Blocked: employee not scanned");
      return;
    }

    // Initilaize serial, station and status
    const serial = vesselData.serialNumber;
    const station = employeeData.station;
    const status = el("status").value;

    try {
      debug({ step: "validating", serial, station, status });

      const phase = getPhaseFromStatus(status);
      const state = await getStationState(db, serial, station, phase);
      debug({ validation: { serial, station, status, state } });

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
        notes: el("notes").value,
        employeeName: employeeData.employeeName,
        employeeNumber: employeeData.employeeNumber,
        employeeStation: employeeData.station,
        createdAt: serverTimestamp()
      };

      debug({ step: "saving", payload });

      const docRef = await addDoc(collection(db, "processLogs"), payload);

      debug({ saved: true, docId: docRef.id });
      alert("Saved!");
      clearForm();
    } catch (err) {
      console.error(err);
      debug({ error: err?.message || String(err), code: err?.code || null });

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

    debug("Ready.");