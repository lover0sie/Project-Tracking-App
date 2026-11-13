# Firestore live status changes

1. `onSnapshot` and `runTransaction` are exported from `js/firebase.js` so the existing Firebase SDK can be reused.
2. A single document listener is maintained by `js/runStatus.js` for `processRuns/{chillerSerialNumber}/runs/{currentRunId}`. The previous listener is detached when the run changes or the form is reset. Callbacks from detached listeners are ignored.
3. When a confirmed server snapshot reports `on_hold`, the timer is stopped, the saved `durationMs` is loaded, and open Hold and Complete confirmations are dismissed. An Auto hold notice is displayed only when `autoStopped` is true, `autoStopSource` is `scheduled_auto_stop` or `auto_stop`, and `autoStopAtEpochMs` matches the current `holdEpochMs`. Other holds are labelled On hold, including manual holds with historical auto-stop fields. No hold record is written by the listener, so the scheduled hold is not duplicated by the browser.
4. When the status is `running`, elapsed time is reconstructed from `durationMs` plus the time since `resumedEpochMs` or `startEpochMs`. The timer is continued for its current operator. A completed, missing, or unrecognized run is kept stopped; a run belonging to another operator is also kept stopped in this session.
5. Hold, Complete, and Resume are checked inside Firestore transactions in `js/processRuns.js`. A manual Hold or Complete is committed only while the saved status is still `running` and the operator still owns the run. A Resume is committed only while the saved status is still `on_hold`. If the status has changed, the latest saved state is applied instead. Concurrent client writes are blocked while a save is in progress.
6. `runStatusPending` and `runWriteInFlight` are added to transient state. Relevant controls are disabled while the first server status is awaited or a transition is being saved. Cached snapshots and pending local writes are excluded from status reconciliation. A newly started or resumed timer is continued after a confirmed snapshot is received.
7. Monitoring is reattached when the page becomes visible, is restored from navigation, or comes online. Listener errors are reported and the timer is paused. The app version is updated to `2026-11-13-01` so the existing refresh banner can announce the deployed change.

The added code comments are written in passive voice. Examples include “Server-confirmed status is applied without another hold being written to Firestore” and “The latest status is checked atomically before a run transition is committed.”

## Scheduled function expectations

The existing 5:30 pm and 9:30 pm Firebase functions remain responsible for scheduling and saving holds. No replacement browser schedule is added. Each hold should update the same run document with `status: "on_hold"`, the accumulated `durationMs` at the scheduled cutoff, and preferably `holdEpochMs` and `holdReason`. The listener uses those fields. The saved duration is expected to include all previously completed running segments. If that duration is absent, a timestamp fallback is available, but prior segments cannot be reconstructed reliably from one start/hold timestamp pair.

A running status is continued automatically; a completed status is kept stopped. After a scheduled hold, an explicit Start is still used to request a resume unless another authorized client changes the saved status to `running`.

## Verification

Run `node --experimental-vm-modules tests/run-status.test.cjs`. The actual application modules are exercised with a simulated browser, clock, and Firestore adapter. Hold/resume timing, duplicate notifications, zero duration, completed/deleted runs, ownership, cached/pending snapshots, stale manual actions, resume writes, and listener cleanup are covered. Production Firestore is not written by these tests.

For a deployed check, start a test run, change that document to `on_hold` with a known duration, and confirm the timer freezes at that duration and the notice appears. Change it to `running` with a fresh `resumedEpochMs` and confirm the timer continues. Check a scheduled cutoff and an open Hold confirmation using a test run. Live Firebase functions, security rules, and the scheduled cutoffs have not been exercised by the local tests.
