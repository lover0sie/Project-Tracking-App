const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Browser storage, clock, and Firestore events are simulated without production writes.
async function main() {
  let now = 100000;
  let timerId = 0;
  const timers = new Set();
  const listeners = [];
  const writes = [];
  let databaseRun;
  const nodes = new Map();
  const storage = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {
        value: id === "processSelect" ? "Assembly" : "", textContent: "", disabled: false,
        classList: { add: (...items) => items.forEach(x => classes.add(x)), remove: (...items) => items.forEach(x => classes.delete(x)),
          contains: item => classes.has(item), toggle: (item, on) => on ? classes.add(item) : classes.delete(item) }
      });
    }
    return nodes.get(id);
  }
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    console, Date: Clock, URL,
    setInterval: () => { timers.add(++timerId); return timerId; },
    clearInterval: id => timers.delete(id), setTimeout: () => 1, clearTimeout: () => {},
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: node, title: "Test" },
    window: { location: { href: "https://example.test/?tab=test" }, history: { replaceState: () => {} } }
  });
  const firebase = {
    db: {}, doc: (...parts) => parts.slice(1).join("/"),
    onSnapshot: (ref, options, next, error) => {
      const listener = { ref, next, error, stopped: false };
      listeners.push(listener);
      return () => { listener.stopped = true; };
    },
    runTransaction: async (db, fn) => fn({
      get: async () => ({ exists: () => !!databaseRun, data: () => databaseRun }),
      update: (ref, payload) => writes.push({ ref, payload })
    }),
    collection: () => ({}), query: () => ({}), where: () => ({}), limit: () => ({}),
    getDocs: async () => ({ empty: true }), addDoc: async () => {}, setDoc: async () => {},
    serverTimestamp: () => ({}), arrayUnion: value => value
  };
  const modules = new Map();
  const firebaseModule = new vm.SyntheticModule(Object.keys(firebase), function () {
    for (const [key, value] of Object.entries(firebase)) this.setExport(key, value);
  }, { context });
  function load(filename) {
    filename = path.resolve(filename);
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), { context, identifier: filename }));
    return modules.get(filename);
  }
  const entry = load(path.join(__dirname, "../js/processRuns.js"));
  await entry.link((specifier, parent) => specifier === "./firebase.js" ? firebaseModule : load(path.resolve(path.dirname(parent.identifier), specifier)));
  await entry.evaluate();
  const state = load(path.join(__dirname, "../js/state.js")).namespace.state;
  const ui = load(path.join(__dirname, "../js/ui.js")).namespace;
  const live = load(path.join(__dirname, "../js/runStatus.js")).namespace;
  Object.assign(state, { employeeData: { employeeNumber: "E1", station: "Assembly" }, chillerSerialNumber: "C1", currentRunId: "R1" });
  const running = { status: "running", processName: "Assembly", startedByNumber: "E1", startEpochMs: 90000, durationMs: 5000 };
  function emit(data, metadata = {}) {
    listeners.at(-1).next({ exists: () => !!data, data: () => data, metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });
  }

  ui.syncStatusButtons();
  assert.equal(listeners.length, 1);
  assert.equal(state.runStatusPending, true);
  emit(running, { fromCache: true });
  assert.equal(state.runStatusPending, true);
  emit(running, { hasPendingWrites: true });
  assert.equal(state.runStatusPending, true);
  emit(running);
  assert.equal(state.runRunning, true);
  assert.equal(state.runAccumMs, 15000);
  assert.equal(timers.size, 1);
  ui.syncStatusButtons();
  assert.equal(listeners.length, 1);

  now += 2000;
  const held = { ...running, status: "on_hold", durationMs: 16000, holdEpochMs: 101000,
    holdReason: "end_of_shift", autoStopped: true, autoStopAtEpochMs: 101000, autoStopSource: "scheduled_auto_stop" };
  emit(held);
  assert.equal(state.runRunning, false);
  assert.equal(state.runAccumMs, 16000);
  assert.equal(timers.size, 0);
  assert.match(node("scan-status").textContent, /Auto hold/);
  assert.equal(node("holdModal").classList.contains("hidden"), true);
  assert.equal(node("completeModal").classList.contains("hidden"), true);
  assert.equal(node("btnHoldProcess").disabled, true);
  assert.equal(writes.length, 0);
  emit(held);
  assert.equal(state.runAccumMs, 16000);
  emit({ ...held, durationMs: 0 });
  assert.equal(state.runAccumMs, 0);

  // A later manual hold is labelled independently of historical auto-stop fields.
  emit(running);
  emit({ ...held, holdEpochMs: now, holdReason: "resume_tomorrow" });
  assert.match(node("scan-status").textContent, /^On hold:/);
  assert.match(node("scan-status").textContent, /resume_tomorrow/);
  assert.doesNotMatch(node("scan-status").textContent, /Auto hold/);
  live.syncRunStatusListener(true);
  emit({ ...held, holdEpochMs: now, holdReason: "resume_tomorrow" });
  assert.match(node("scan-status").textContent, /^On hold:/);
  emit(running);
  emit({ ...held, autoStopSource: "running_cleanup" });
  assert.match(node("scan-status").textContent, /^On hold:/);

  emit({ ...held, status: "running", resumedEpochMs: now });
  assert.equal(state.runRunning, true);
  assert.equal(state.runAccumMs, 16000);
  assert.equal(timers.size, 1);
  emit({ ...held, status: "completed" });
  assert.equal(state.runRunning, false);
  assert.equal(state.startLockedByStatus, true);
  emit({ ...running, resumedByNumber: "E2" });
  assert.equal(state.runRunning, false);
  assert.equal(state.startLockedByStatus, true);
  emit(null);
  assert.equal(state.runRunning, false);
  assert.equal(state.startLockedByStatus, true);

  // A scheduled hold is preserved when a stale manual action is submitted.
  emit(running);
  databaseRun = held;
  await entry.namespace.holdRunAndReset("others", "manual");
  assert.equal(writes.length, 0);
  assert.equal(state.runAccumMs, 16000);
  assert.equal(state.runRunning, false);
  emit(running);
  await entry.namespace.completeRunAndReset();
  assert.equal(writes.length, 0);
  assert.equal(state.runRunning, false);

  // An explicit resume is based on the saved database duration.
  state.vesselData = { qrKind: "PV", serialNumber: "PV1" };
  await entry.namespace.startOrResumeRun();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.status, "running");
  assert.equal(state.runStatusPending, true);
  assert.equal(state.runRunning, false);
  emit({ ...held, status: "running", resumedEpochMs: now });
  assert.equal(state.runAccumMs, 16000);
  assert.equal(state.runRunning, true);

  databaseRun = running;
  await entry.namespace.holdRunAndReset("others", "manual");
  assert.equal(writes.length, 2);
  assert.equal(writes[1].payload.status, "on_hold");

  const previous = listeners.at(-1);
  state.currentRunId = "R2";
  ui.syncStatusButtons();
  assert.equal(previous.stopped, true);
  previous.next({ exists: () => true, data: () => held, metadata: {} });
  assert.equal(state.runStatusPending, true);
  emit(running);
  assert.equal(state.runRunning, true);
  ui.resetAllData();
  assert.equal(listeners.at(-1).stopped, true);
  assert.equal(state.runStatusPending, false);
  assert.equal(timers.size, 0);
  console.log("PASS: live hold/resume, saved duration, completion, ownership, stale-action protection, resume, and listener cleanup");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
