import { state, saveState, getMYDateKey, getMYCompactDateKey, normalizeRunIdPart } from "./state.js";
import {
  db,
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion
} from "./firebase.js";
import { buildLaneSummary, groupItemsByChiller } from "./qr.js";

/* Fabrication run management functions for starting, holding, resuming, and completing batch runs. */ 
function buildRunId(chillerSerialNumber, epochMs) {
  return `${normalizeRunIdPart(chillerSerialNumber, "_")}_${getMYCompactDateKey()}_FABRICATION_BATCH_${epochMs}`;
}

/* Fabrication batch session ID format: FAB_YYYYMMDD_HHMMSS */
function buildBatchSessionId(epochMs) {
  return `FAB_${getMYCompactDateKey()}_${epochMs}`;
}

function clearBatchTimer() {
  if (state.runTimer) {
    clearInterval(state.runTimer);
    state.runTimer = null;
  }
}

function getItemSignature(items = []) {
  return items
    .map(item => String(item?.itemID || "").trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join("|");
}

function getBatchSignature(groups = []) {
  return groups
    .map(group => {
      const chiller = String(group.chillerSerialNumber || "").trim().toUpperCase();
      return `${chiller}:${getItemSignature(group.items)}`;
    })
    .sort()
    .join("||");
}

function getRunItemSignature(runDoc = {}) {
  return getItemSignature(Array.isArray(runDoc.items) ? runDoc.items : []);
}

function getRunBatchSignature(runDoc = {}) {
  return String(runDoc.batchItemSignature || "").trim().toUpperCase();
}

function getItemIdSet(items = []) {
  return new Set(
    items
      .map(item => String(item?.itemID || "").trim().toUpperCase())
      .filter(Boolean)
  );
}

function hasItemOverlap(leftItems = [], rightItems = []) {
  const leftIds = getItemIdSet(leftItems);
  return rightItems.some(item => leftIds.has(String(item?.itemID || "").trim().toUpperCase()));
}

async function findOnHoldBatchRunsForChiller(chillerSerialNumber, processName) {
  const runsRef = collection(db, "processRuns", chillerSerialNumber, "runs");
  const q = query(
    runsRef,
    where("runType", "==", "fabrication_batch"),
    where("serialNumber", "==", chillerSerialNumber),
    where("station", "==", "Fabrication"),
    where("processName", "==", processName),
    where("status", "==", "on_hold")
  );

  const snap = await getDocs(q);
  return snap.docs.map(run => ({ id: run.id, ...run.data() }));
}

async function findMatchingOnHoldBatch(processName) {
  const grouped = groupItemsByChiller(state.scannedItems);
  const scannedBatchSignature = getBatchSignature(grouped);
  const groupedByChiller = new Map(
    grouped.map(group => [
      String(group.chillerSerialNumber || "").trim().toUpperCase(),
      group
    ])
  );

  const onHoldRuns = [];

  for (const group of grouped) {
    const runs = await findOnHoldBatchRunsForChiller(group.chillerSerialNumber, processName);
    onHoldRuns.push(...runs);
  }

  if (!onHoldRuns.length) return { match: null, hasMismatch: false };

  const runsByBatchSession = new Map();
  for (const run of onHoldRuns) {
    const batchSessionId = String(run.batchSessionId || "").trim();
    if (!batchSessionId) continue;
    if (!runsByBatchSession.has(batchSessionId)) runsByBatchSession.set(batchSessionId, []);
    runsByBatchSession.get(batchSessionId).push(run);
  }

  for (const [batchSessionId, runs] of runsByBatchSession) {
    const storedBatchSignature = getRunBatchSignature(runs[0]);
    if (storedBatchSignature && storedBatchSignature !== scannedBatchSignature) continue;
    if (Number(runs[0].batchGroupCount || grouped.length) !== grouped.length) continue;
    if (runs.length !== grouped.length) continue;

    const allGroupsMatch = runs.every(run => {
      const chiller = String(run.chillerSerialNumber || run.serialNumber || "").trim().toUpperCase();
      const scannedGroup = groupedByChiller.get(chiller);
      return scannedGroup && getRunItemSignature(run) === getItemSignature(scannedGroup.items);
    });

    if (!allGroupsMatch) continue;

    const durationMs = Math.max(...runs.map(run => Number(run.durationMs || 0)), 0);
    const activeRunDocs = runs.map(run => ({
      chillerSerialNumber: run.chillerSerialNumber || run.serialNumber,
      runId: run.id
    }));

    return {
      match: {
        batchSessionId,
        activeRunDocs,
        durationMs
      },
      hasMismatch: false
    };
  }

  const hasMismatch = onHoldRuns.some(run => {
    const chiller = String(run.chillerSerialNumber || run.serialNumber || "").trim().toUpperCase();
    const scannedGroup = groupedByChiller.get(chiller);
    return scannedGroup && hasItemOverlap(scannedGroup.items, run.items);
  });

  return { match: null, hasMismatch };
}

export async function startOrResumeBatchRun(processName) {
  if (!state.employeeData) throw new Error("Employee data missing.");
  if (!state.scannedItems.length) throw new Error("No scanned items.");
  if (!processName) throw new Error("Please select a process.");

  const resumeCheck = await findMatchingOnHoldBatch(processName);
  if (resumeCheck.match) {
    state.activeBatchSessionId = resumeCheck.match.batchSessionId;
    state.activeRunDocs = resumeCheck.match.activeRunDocs;
    state.runAccumMs = resumeCheck.match.durationMs;
    state.runRunning = false;
    state.runStartEpoch = null;
    state.currentStatus = "on_hold";
    saveState();

    await resumeBatchRun();

    return {
      mode: "resumed",
      batchSessionId: state.activeBatchSessionId,
      activeRunDocs: state.activeRunDocs
    };
  }

  if (resumeCheck.hasMismatch) {
    throw new Error("This process has an ON HOLD batch, but the scanned items are not the same. Scan the exact same items to resume.");
  }

  return startBatchRun(processName);
}

export async function startBatchRun(processName) {
  if (!state.employeeData) throw new Error("Employee data missing.");
  if (!state.scannedItems.length) throw new Error("No scanned items.");
  if (!processName) throw new Error("Please select a process.");

  const nowMs = Date.now();
  const batchSessionId = buildBatchSessionId(nowMs);
  const grouped = groupItemsByChiller(state.scannedItems);
  const batchItemSignature = getBatchSignature(grouped);
  const activeRunDocs = [];

  for (const group of grouped) {
    const chillerSerialNumber = String(group.chillerSerialNumber || "").trim();
    const runId = buildRunId(chillerSerialNumber, nowMs);

    const payload = {
      runType: "fabrication_batch",
      batchSessionId,
      batchGroupCount: grouped.length,
      batchItemSignature,

      qrKind: group.items[0]?.qrKind || "FABRICATION_ITEM",
      version: group.items[0]?.version || null,
      serialNumber: chillerSerialNumber,
      chillerSerialNumber,
      projectName: group.projectName,
      materialNumber: group.items[0]?.materialNumber || null,
      model: group.items[0]?.model || null,
      refrigerant: group.items[0]?.refrigerant || null,

      station: "Fabrication",
      processName,
      status: "running",

      startedByName: state.employeeData.employeeName,
      startedByNumber: state.employeeData.employeeNumber,
      employeeStation: state.employeeData.station,
      manpower: state.employeeData.manpower,

      startAt: serverTimestamp(),
      startEpochMs: nowMs,
      resumedAt: null,
      resumedEpochMs: null,
      endAt: null,
      endEpochMs: null,

      holds: [],
      resumes: [],

      runDate: getMYDateKey(),
      itemCount: group.items.length,
      items: group.items.map(item => ({
        itemID: item.itemID,
        item: item.item,
        description: item.description,
        partNumber: item.partNumber,
        laneType: item.laneType
      })),
      laneSummary: buildLaneSummary(group.items)
    };

    const runRef = doc(db, "processRuns", chillerSerialNumber, "runs", runId);
    await setDoc(runRef, payload);

    activeRunDocs.push({
      chillerSerialNumber,
      runId
    });
  }

  state.activeBatchSessionId = batchSessionId;
  state.activeRunDocs = activeRunDocs;
  state.currentStatus = "running";
  saveState();
  state.runAccumMs = 0;
  state.runRunning = true;
  state.runStartEpoch = nowMs;
  saveState();

  return {
    batchSessionId,
    activeRunDocs
  };
}

export async function holdBatchRun(holdReason = "others", remarks = "") {
  if (!state.activeRunDocs.length) throw new Error("No active batch runs.");

  const holdAtEpochMs = Date.now();
  if (state.runRunning && state.runStartEpoch) {
    state.runAccumMs += holdAtEpochMs - state.runStartEpoch;
  }

  const holdObj = {
    holdAtEpochMs,
    holdReason,
    remarks,
    byName: state.employeeData?.employeeName || "",
    byNumber: state.employeeData?.employeeNumber || ""
  };

  for (const refInfo of state.activeRunDocs) {
    const runRef = doc(db, "processRuns", refInfo.chillerSerialNumber, "runs", refInfo.runId);
    await updateDoc(runRef, {
      status: "on_hold",
      durationMs: state.runAccumMs,
      holdAt: serverTimestamp(),
      holdEpochMs: holdAtEpochMs,
      holdReason,
      remarks,
      holds: arrayUnion(holdObj)
    });
  }

  state.runRunning = false;
  state.runStartEpoch = null;
  clearBatchTimer();
  state.currentStatus = "on_hold";
  saveState();
}

export async function resumeBatchRun() {
  if (!state.activeRunDocs.length) throw new Error("No active batch runs.");

  const resumedAtEpochMs = Date.now();
  const resumeObj = {
    resumedAtEpochMs,
    resumedByName: state.employeeData?.employeeName || "",
    resumedByNumber: state.employeeData?.employeeNumber || ""
  };

  for (const refInfo of state.activeRunDocs) {
    const runRef = doc(db, "processRuns", refInfo.chillerSerialNumber, "runs", refInfo.runId);
    await updateDoc(runRef, {
      status: "running",
      resumedAt: serverTimestamp(),
      resumedEpochMs: resumedAtEpochMs,
      resumedByName: state.employeeData?.employeeName || "",
      resumedByNumber: state.employeeData?.employeeNumber || "",
      resumes: arrayUnion(resumeObj)
    });
  }

  state.runRunning = true;
  state.runStartEpoch = resumedAtEpochMs;
  state.currentStatus = "running";
  saveState();
}

export async function completeBatchRun() {
  if (!state.activeRunDocs.length) throw new Error("No active batch runs.");

  const endEpochMs = Date.now();

  if (state.runRunning && state.runStartEpoch) {
    state.runAccumMs += endEpochMs - state.runStartEpoch;
  }

  for (const refInfo of state.activeRunDocs) {
    const runRef = doc(db, "processRuns", refInfo.chillerSerialNumber, "runs", refInfo.runId);
    await updateDoc(runRef, {
      status: "completed",
      endAt: serverTimestamp(),
      endEpochMs,
      actualDurationMs: state.runAccumMs
    });
  }

  state.runRunning = false;
  state.runStartEpoch = null;
  clearBatchTimer();
  state.currentStatus = "completed";
  saveState();
}
