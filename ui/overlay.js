(async function () {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("uid");
  const taskId = params.get("tid");
  const mode = String(params.get("mode") || "").toUpperCase();
  const framework = String(params.get("framework") || "crewai").toLowerCase();
  const sequenceIndex = Number.parseInt(params.get("idx") || "0", 10);
  const studyPhase = String(params.get("phase") || "measured").toLowerCase();
  const studyCode = String(
    params.get("code") || window.sessionStorage.getItem("gear_study_code") || ""
  ).trim();

  if (!userId || !taskId || !["GEAR", "MANUAL"].includes(mode)) return;

  document.body.classList.add(
    "experiment-active",
    mode === "MANUAL" ? "experiment-manual" : "experiment-gear"
  );

  let taskConfig = {};
  try {
    const response = await fetch(`/api/experiment/task_info/${encodeURIComponent(taskId)}`);
    if (response.ok) taskConfig = await response.json();
    else console.warn("Unable to load task timing; using the default duration.");
  } catch (error) {
    console.warn("Unable to load task timing; using the default duration.", error);
  }

  const modeLabel = mode === "GEAR" ? "Gear" : "Manual";
  const frameworkLabel = framework === "adk" ? "Google ADK" : "CrewAI";
  const taskLabel = taskId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "TASK";
  document.title = `${taskLabel} · ${frameworkLabel} · Gear Experiment`;
  const phaseLabels = {
    training: "Training",
    familiarization: "Familiarization",
    first_implementation: "Measured task",
    translation: "Framework translation"
  };
  const phaseLabel = phaseLabels[studyPhase] || "Experiment";
  const studyCodeMarkup = studyCode
    ? `<span class="exp-study-code" title="Copy this code to the operator sheet">${escapeHtml(studyCode)}</span>`
    : "";

  const overlayHTML = `
    <div id="expBar" role="region" aria-label="Experiment controls">
      <div class="exp-info">
        <span class="exp-task-id" aria-label="Current task">${taskLabel}</span>
        <span class="exp-label">${phaseLabel}</span>
        <span class="exp-mode">${modeLabel} · ${frameworkLabel}</span>
        ${studyCodeMarkup}
      </div>
      <div class="exp-timer" id="expTimer" aria-live="polite">Loading...</div>
      <div class="exp-actions">
        <span class="exp-operator-label">Operator controls</span>
        <button class="exp-btn exp-btn-info exp-btn-operator" id="btnPause" type="button" disabled
                title="Protected by the operator PIN">🔒 Pause</button>
        <button class="exp-btn exp-btn-danger exp-btn-operator" id="btnTechnicalFailure" type="button" disabled
                title="Protected by the operator PIN">
          🔒 Technical failure
        </button>
        <button class="exp-btn exp-btn-validate" id="btnValidate" type="button">
          Confirm &amp; Finish
        </button>
      </div>
    </div>
    <div id="expPauseOverlay" class="exp-pause-overlay" hidden role="dialog" aria-modal="true">
      <div class="exp-pause-card">
        <span class="exp-pause-icon" aria-hidden="true">Ⅱ</span>
        <h2>Technical pause</h2>
        <p>The task timer is stopped. Do not modify the solution until the operator resumes it.</p>
        <div class="exp-pause-actions">
          <button class="exp-btn exp-btn-validate exp-btn-operator" id="btnResume" type="button">
            🔒 Resume task
          </button>
          <button class="exp-btn exp-btn-danger exp-btn-operator" id="btnPausedTechnicalFailure" type="button">
            🔒 End as technical failure
          </button>
        </div>
      </div>
    </div>
    <div id="expOperatorPinDialog" class="exp-operator-dialog" hidden role="dialog" aria-modal="true"
         aria-labelledby="expOperatorPinTitle">
      <form id="expOperatorPinForm" class="exp-operator-card">
        <span class="exp-operator-lock" aria-hidden="true">🔒</span>
        <h2 id="expOperatorPinTitle">Operator authorization</h2>
        <p id="expOperatorPinMessage">Enter the operator PIN to continue.</p>
        <label for="expOperatorPinInput">Operator PIN</label>
        <input id="expOperatorPinInput" type="password" inputmode="numeric" autocomplete="off"
               maxlength="128" required>
        <p id="expOperatorPinError" class="exp-operator-error" hidden></p>
        <div class="exp-operator-actions">
          <button class="exp-btn exp-btn-info" id="btnOperatorCancel" type="button">Cancel</button>
          <button class="exp-btn exp-btn-validate" id="btnOperatorAuthorize" type="submit">Authorize</button>
        </div>
      </form>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", overlayHTML);

  const timerEl = document.getElementById("expTimer");
  const btnValidate = document.getElementById("btnValidate");
  const btnPause = document.getElementById("btnPause");
  const btnResume = document.getElementById("btnResume");
  const btnTechnicalFailure = document.getElementById("btnTechnicalFailure");
  const btnPausedTechnicalFailure = document.getElementById("btnPausedTechnicalFailure");
  const pauseOverlay = document.getElementById("expPauseOverlay");
  const operatorDialog = document.getElementById("expOperatorPinDialog");
  const operatorForm = document.getElementById("expOperatorPinForm");
  const operatorMessage = document.getElementById("expOperatorPinMessage");
  const operatorInput = document.getElementById("expOperatorPinInput");
  const operatorError = document.getElementById("expOperatorPinError");
  const btnOperatorCancel = document.getElementById("btnOperatorCancel");
  const btnOperatorAuthorize = document.getElementById("btnOperatorAuthorize");

  const durationSeconds = Number(taskConfig.time_limit_seconds ?? 600);
  let timerInterval = null;
  let endTime = null;
  let remainingMs = Math.max(0, durationSeconds) * 1000;
  let logId = null;
  let finishing = false;
  let paused = false;
  let pauseBusy = false;
  let operatorControlsAvailable = false;
  let operatorPinResolver = null;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function closeOperatorDialog(value = null) {
    operatorDialog.hidden = true;
    operatorInput.value = "";
    operatorError.hidden = true;
    operatorError.textContent = "";
    btnOperatorAuthorize.disabled = false;
    const resolver = operatorPinResolver;
    operatorPinResolver = null;
    if (resolver) resolver(value);
  }

  function requestOperatorPin(actionDescription) {
    if (!operatorControlsAvailable) {
      showToast(
        "Operator controls are unavailable. Configure GEAR_OPERATOR_PIN and restart Gear.",
        "error"
      );
      return Promise.resolve(null);
    }
    if (operatorPinResolver) closeOperatorDialog(null);
    operatorMessage.textContent = `Enter the operator PIN to ${actionDescription}.`;
    operatorDialog.hidden = false;
    operatorInput.value = "";
    operatorError.hidden = true;
    window.setTimeout(() => operatorInput.focus(), 0);
    return new Promise((resolve) => {
      operatorPinResolver = resolve;
    });
  }

  function updateOperatorButtons() {
    const unavailable = !operatorControlsAvailable || finishing || pauseBusy;
    btnPause.disabled = unavailable || paused;
    btnTechnicalFailure.disabled = unavailable;
    btnResume.disabled = unavailable || !paused;
    btnPausedTechnicalFailure.disabled = unavailable;

    const title = operatorControlsAvailable
      ? "Protected by the operator PIN"
      : "Set GEAR_OPERATOR_PIN and restart Gear to enable this control";
    for (const button of [btnPause, btnTechnicalFailure, btnResume, btnPausedTechnicalFailure]) {
      button.title = title;
    }
  }

  operatorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const pin = operatorInput.value;
    if (!pin) {
      operatorError.textContent = "Enter the operator PIN.";
      operatorError.hidden = false;
      return;
    }

    btnOperatorAuthorize.disabled = true;
    operatorError.hidden = true;
    try {
      const response = await fetch("/api/experiment/operator/verify", {
        method: "POST",
        headers: { "X-Gear-Operator-Pin": pin }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        operatorError.textContent = result.error || "Operator authorization failed.";
        operatorError.hidden = false;
        operatorInput.select();
        return;
      }
      closeOperatorDialog(pin);
    } catch (error) {
      console.error(error);
      operatorError.textContent = "Unable to verify the operator PIN.";
      operatorError.hidden = false;
    } finally {
      btnOperatorAuthorize.disabled = false;
    }
  });

  btnOperatorCancel.addEventListener("click", () => closeOperatorDialog(null));
  operatorDialog.addEventListener("click", (event) => {
    if (event.target === operatorDialog) closeOperatorDialog(null);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !operatorDialog.hidden) closeOperatorDialog(null);
  });

  function getUserCode() {
    if (mode === "MANUAL") {
      return document.getElementById("manualInput")?.value || "";
    }
    if (typeof window.getExperimentSubmission === "function") {
      try {
        return window.getExperimentSubmission() || "";
      } catch (error) {
        console.error("Unable to serialize the Studio project", error);
      }
    }
    const legacyOutput = document.querySelector(".yaml-output");
    return legacyOutput?.value || legacyOutput?.textContent || "";
  }

  function clearTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function captureRemainingTime() {
    if (durationSeconds > 0 && endTime !== null) {
      remainingMs = Math.max(0, endTime - Date.now());
    }
    clearTimer();
    endTime = null;
  }

  function startTimer(milliseconds = remainingMs) {
    clearTimer();
    if (durationSeconds === 0) {
      timerEl.textContent = paused ? "PAUSED" : "No time limit";
      timerEl.classList.toggle("is-paused", paused);
      timerEl.classList.add("is-unlimited");
      return;
    }

    remainingMs = Math.max(0, Number(milliseconds) || 0);
    endTime = Date.now() + remainingMs;

    function updateTimerDisplay() {
      const timeLeftMs = Math.max(0, endTime - Date.now());
      remainingMs = timeLeftMs;
      if (timeLeftMs <= 0) {
        timerEl.textContent = "00:00";
        timerEl.classList.add("is-critical");
        clearTimer();
        endTime = null;
        forceEndTask();
        return;
      }
      const totalSecondsLeft = Math.ceil(timeLeftMs / 1000);
      const minutes = Math.floor(totalSecondsLeft / 60).toString().padStart(2, "0");
      const seconds = (totalSecondsLeft % 60).toString().padStart(2, "0");
      timerEl.textContent = `${minutes}:${seconds}`;
      timerEl.classList.toggle("is-critical", totalSecondsLeft < 60);
      timerEl.classList.remove("is-paused");
    }

    updateTimerDisplay();
    timerInterval = window.setInterval(updateTimerDisplay, 1000);
  }

  function setPausedUi(value) {
    paused = Boolean(value);
    pauseOverlay.hidden = !paused;
    document.body.classList.toggle("experiment-paused", paused);
    btnValidate.disabled = paused || finishing;
    updateOperatorButtons();
    if (paused) {
      captureRemainingTime();
      timerEl.textContent = "PAUSED";
      timerEl.classList.add("is-paused");
      timerEl.classList.remove("is-critical");
    }
  }

  function setRemainingFromActiveElapsed(activeElapsedSeconds) {
    if (durationSeconds === 0) return;
    const elapsed = Math.max(0, Number(activeElapsedSeconds) || 0);
    remainingMs = Math.max(0, durationSeconds - elapsed) * 1000;
  }

  updateOperatorButtons();
  startTimer();

  let logStartPromise = null;
  let logStartError = null;

  function publishLogState(status, error = null) {
    window.currentExperimentLogState = {
      status,
      error: error ? String(error.message || error) : null
    };
    window.dispatchEvent(new CustomEvent("gear:experiment-log-state", {
      detail: window.currentExperimentLogState
    }));
  }

  async function startExperimentLog() {
    publishLogState("starting");
    const response = await fetch("/api/experiment/log_start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        task_id: taskId,
        mode,
        framework,
        sequence_index: Number.isFinite(sequenceIndex) ? sequenceIndex : null
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Unable to start the experiment log (HTTP ${response.status}).`);
    }

    const resolvedPhase = data.study_phase || studyPhase;
    if (
      (data.log_id === undefined || data.log_id === null || data.log_id === "")
      && resolvedPhase !== "training"
    ) {
      throw new Error(
        data.tracking === false
          ? "Research tracking is disabled; this experiment task cannot be executed."
          : "The experiment server did not create a task log."
      );
    }

    logId = data.log_id;
    window.currentLogId = logId;
    operatorControlsAvailable = Boolean(data.operator_controls_available && logId);
    updateOperatorButtons();
    if (data.resumed && durationSeconds > 0) {
      setRemainingFromActiveElapsed(data.active_elapsed_seconds);
      if (data.paused) {
        clearTimer();
        endTime = null;
        setPausedUi(true);
      } else {
        startTimer(remainingMs);
      }
    }
    const context = {
      active: true,
      task_log_id: logId,
      task_id: taskId,
      mode,
      framework,
      sequence_index: Number.isFinite(sequenceIndex) ? sequenceIndex : null,
      study_phase: resolvedPhase,
      primary_analysis: Boolean(data.included_in_primary_analysis),
      study_code: studyCode,
      record_mlflow: Boolean(logId)
    };
    logStartError = null;
    window.currentExperimentRunContext = context;
    publishLogState("ready");
    return context;
  }

  function ensureExperimentLog({ retry = false } = {}) {
    if (window.currentExperimentRunContext && !window.currentExperimentRunContext.error) {
      return Promise.resolve(window.currentExperimentRunContext);
    }
    if (logStartPromise) return logStartPromise;
    if (logStartError && !retry) return Promise.reject(logStartError);

    logStartPromise = startExperimentLog()
      .catch((error) => {
        logStartError = error;
        operatorControlsAvailable = false;
        updateOperatorButtons();
        window.currentExperimentRunContext = {
          active: true,
          task_log_id: null,
          task_id: taskId,
          mode,
          framework,
          sequence_index: Number.isFinite(sequenceIndex) ? sequenceIndex : null,
          study_phase: studyPhase,
          primary_analysis: false,
          study_code: studyCode,
          record_mlflow: false,
          error: true
        };
        publishLogState("error", error);
        console.error("Error starting experiment log", error);
        throw error;
      })
      .finally(() => {
        logStartPromise = null;
      });
    return logStartPromise;
  }

  window.getExperimentRunContext = async () => {
    let error = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await ensureExperimentLog({ retry: true });
      } catch (currentError) {
        error = currentError;
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
    }
    throw new Error(`Experiment task log unavailable: ${error?.message || "unknown error"}`);
  };

  ensureExperimentLog().catch(() => {
    // Run will retry and surface the original failure if the initial request was transient.
  });

  async function stopActiveExecution() {
    const stops = [];
    if (typeof window.isManualExecutionRunning === "function" && window.isManualExecutionRunning()
      && typeof window.stopManualExecution === "function") {
      stops.push(window.stopManualExecution());
    }
    if (typeof window.isStudioExecutionRunning === "function" && window.isStudioExecutionRunning()
      && typeof window.stopStudioExecution === "function") {
      stops.push(window.stopStudioExecution());
    }
    if (stops.length) await Promise.allSettled(stops);
  }

  async function sendPauseAction(action, reason = "", operatorPin = "") {
    await window.getExperimentRunContext();
    if (!logId) throw new Error("The experiment task log is not ready yet.");
    const response = await fetch("/api/experiment/pause", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gear-Operator-Pin": operatorPin
      },
      body: JSON.stringify({ log_id: logId, action, reason })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to update the task pause.");
    setRemainingFromActiveElapsed(result.active_elapsed_seconds);
    return result;
  }

  btnPause.addEventListener("click", async () => {
    if (pauseBusy || paused || finishing) return;
    const operatorPin = await requestOperatorPin("pause the task");
    if (!operatorPin) return;
    if (!window.confirm("Pause the task timer for a technical interruption?")) return;
    const reason = window.prompt("Brief technical reason (optional):", "") || "";
    pauseBusy = true;
    updateOperatorButtons();
    try {
      const result = await sendPauseAction("pause", reason, operatorPin);
      setPausedUi(Boolean(result.paused));
      await stopActiveExecution();
      showToast("Technical pause recorded. The timer is stopped.", "warning");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Unable to pause the task.", "error");
      if (!paused) startTimer(remainingMs);
    } finally {
      pauseBusy = false;
      updateOperatorButtons();
    }
  });

  btnResume.addEventListener("click", async () => {
    if (pauseBusy || !paused || finishing) return;
    const operatorPin = await requestOperatorPin("resume the task");
    if (!operatorPin) return;
    pauseBusy = true;
    updateOperatorButtons();
    try {
      const result = await sendPauseAction("resume", "", operatorPin);
      setPausedUi(Boolean(result.paused));
      if (!result.paused) startTimer(remainingMs);
      showToast("Task resumed with the remaining active time.", "success");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Unable to resume the task.", "error");
    } finally {
      pauseBusy = false;
      updateOperatorButtons();
    }
  });

  async function endTechnicalFailure() {
    if (finishing) return;
    const operatorPin = await requestOperatorPin("end the task as a technical failure");
    if (!operatorPin) return;
    if (!window.confirm(
      "End this task as a technical failure? The current solution will be saved without validation."
    )) return;
    const note = window.prompt("Brief description of the technical incident:", "") || "";
    try {
      await stopActiveExecution();
      await finishTask(getUserCode(), "technical_failure", note, operatorPin);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Unable to end the task.", "error");
    }
  }

  btnTechnicalFailure.addEventListener("click", endTechnicalFailure);
  btnPausedTechnicalFailure.addEventListener("click", endTechnicalFailure);

  btnValidate.addEventListener("click", async () => {
    if (finishing || paused) return;

    if (mode === "MANUAL" && typeof window.isManualExecutionRunning === "function"
      && window.isManualExecutionRunning()) {
      showToast("Wait for the execution to finish or stop it before confirming the task.", "warning");
      return;
    }
    if (mode === "GEAR" && typeof window.isStudioExecutionRunning === "function"
      && window.isStudioExecutionRunning()) {
      showToast("Wait for the execution to finish or stop it before confirming the task.", "warning");
      return;
    }

    if (mode === "MANUAL" && typeof window.getManualExperimentCompletionState === "function") {
      const completion = window.getManualExperimentCompletionState();
      if (!completion?.ready) {
        showToast(
          completion?.message || "Run the current framework code successfully before confirming.",
          "warning"
        );
        return;
      }
    }

    if (mode === "GEAR" && typeof window.getExperimentCompletionState === "function") {
      const completion = window.getExperimentCompletionState();
      if (!completion?.ready) {
        showToast(
          completion?.message || "Complete every Gear Studio step before confirming the task.",
          "warning"
        );
        return;
      }
    }

    try {
      await window.getExperimentRunContext();
    } catch (error) {
      showToast(error?.message || "The experiment task log is unavailable.", "error");
      return;
    }

    const userCode = getUserCode();
    btnValidate.disabled = true;
    const originalText = btnValidate.textContent;
    btnValidate.textContent = "Verification...";

    try {
      const response = await fetch("/api/experiment/validate_task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, code: userCode, mode, framework }),
      });
      const result = await response.json();

      if (result.valid) {
        await finishTask(userCode, "confirmed");
      } else {
        showToast(result.message || "Invalid configuration.", "error");
        btnValidate.disabled = false;
        btnValidate.textContent = originalText;
      }
    } catch (error) {
      console.error(error);
      showToast("Error connecting to the server.", "error");
      btnValidate.disabled = false;
      btnValidate.textContent = originalText;
    }
  });

  async function finishTask(
    code = "",
    completionReason = "confirmed",
    completionNote = "",
    operatorPin = ""
  ) {
    if (finishing) return;
    finishing = true;
    captureRemainingTime();
    btnValidate.disabled = true;
    updateOperatorButtons();

    const messages = {
      timeout: ["Time is up. Your current work is being saved.", "warning"],
      technical_failure: ["The current work is being saved as a technical failure.", "warning"],
      confirmed: ["Task successfully completed!", "success"]
    };
    try {
      await window.getExperimentRunContext();
    } catch (error) {
      finishing = false;
      btnValidate.disabled = paused;
      updateOperatorButtons();
      if (!paused && durationSeconds > 0 && remainingMs > 0) startTimer(remainingMs);
      throw error;
    }

    if (logId) {
      try {
        const response = await fetch("/api/experiment/log_end", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(completionReason === "technical_failure"
              ? { "X-Gear-Operator-Pin": operatorPin }
              : {})
          },
          body: JSON.stringify({
            log_id: logId,
            code,
            completion_reason: completionReason,
            completion_note: completionNote
          }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Unable to end the experiment log");
        }
      } catch (error) {
        console.error("Error ending experiment log", error);
        finishing = false;
        btnValidate.disabled = paused;
        btnValidate.textContent = "Confirm & Finish";
        updateOperatorButtons();
        if (!paused && durationSeconds > 0 && remainingMs > 0) startTimer(remainingMs);
        throw error;
      }
    }

    const [message, type] = messages[completionReason] || messages.confirmed;
    showToast(message, type);

    const storage = window.sessionStorage;
    const index = Number.parseInt(storage.getItem("gear_index") || "0", 10);
    if (studyPhase !== "training") {
      storage.setItem(
        `gear_pending_task_questionnaire_${userId}`,
        JSON.stringify({
          task_log_id: logId,
          task_id: taskId,
          mode,
          framework,
          sequence_index: Number.isFinite(sequenceIndex) ? sequenceIndex : index,
          study_phase: studyPhase,
          completion_reason: completionReason
        })
      );
    }
    storage.setItem("gear_index", String(index + 1));

    window.setTimeout(() => {
      window.location.href = "/experiment";
    }, 700);
  }

  async function forceEndTask() {
    if (finishing || paused) return;
    await stopActiveExecution();
    const manualInput = document.getElementById("manualInput");
    if (manualInput) manualInput.disabled = true;
    btnValidate.disabled = true;
    btnValidate.textContent = "Time is up";
    await finishTask(getUserCode(), "timeout");
  }

  function showToast(message, type = "info") {
    document.querySelector(".validation-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = `validation-toast validation-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4000);
  }
})();
