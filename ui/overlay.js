(async function () {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("uid");
  const taskId = params.get("tid");
  const mode = String(params.get("mode") || "").toUpperCase();
  const framework = String(params.get("framework") || "crewai").toLowerCase();
  const sequenceIndex = Number.parseInt(params.get("idx") || "0", 10);
  const studyPhase = String(params.get("phase") || "measured").toLowerCase();

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
  const phaseLabels = {
    training: "Training",
    familiarization: "Familiarization",
    first_implementation: "Measured task",
    translation: "Framework translation"
  };
  const phaseLabel = phaseLabels[studyPhase] || "Experiment";
  const overlayHTML = `
    <div id="expBar" role="region" aria-label="Experiment controls">
      <div class="exp-info">
        <span class="exp-label">${phaseLabel}</span>
        <span class="exp-mode">${modeLabel} · ${frameworkLabel}</span>
      </div>
      <div class="exp-timer" id="expTimer" aria-live="polite">Loading...</div>
      <div class="exp-actions">
        <button class="exp-btn exp-btn-validate" id="btnValidate" type="button">
          Confirm &amp; Finish
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", overlayHTML);

  const timerEl = document.getElementById("expTimer");
  const btnValidate = document.getElementById("btnValidate");

  const durationSeconds = Number(taskConfig.time_limit_seconds ?? 600);
  let timerInterval = null;
  let endTime = null;
  let logId = null;
  let finishing = false;

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

  function startTimerIfNeeded() {
    if (durationSeconds === 0) {
      timerEl.textContent = "No time limit";
      timerEl.classList.add("is-unlimited");
      return;
    }

    endTime = Date.now() + durationSeconds * 1000;

    function updateTimerDisplay() {
      const timeLeftMs = endTime - Date.now();

      if (timeLeftMs <= 0) {
        timerEl.textContent = "00:00";
        timerEl.classList.add("is-critical");
        clearInterval(timerInterval);
        timerInterval = null;
        forceEndTask();
        return;
      }

      const totalSecondsLeft = Math.ceil(timeLeftMs / 1000);
      const minutes = Math.floor(totalSecondsLeft / 60).toString().padStart(2, "0");
      const seconds = (totalSecondsLeft % 60).toString().padStart(2, "0");

      timerEl.textContent = `${minutes}:${seconds}`;
      timerEl.classList.toggle("is-critical", totalSecondsLeft < 60);
    }

    updateTimerDisplay();
    timerInterval = window.setInterval(updateTimerDisplay, 1000);
  }

  startTimerIfNeeded();

  const logStartPromise = fetch("/api/experiment/log_start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      task_id: taskId,
      mode,
      framework,
      sequence_index: Number.isFinite(sequenceIndex) ? sequenceIndex : null
    }),
  })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to start the experiment log");
      return result;
    })
    .then((data) => {
      logId = data.log_id;
      window.currentLogId = logId;
    })
    .catch((error) => console.error("Error starting experiment log", error));


  btnValidate.addEventListener("click", async () => {
    if (finishing) return;

    if (mode === "MANUAL" && typeof window.isManualExecutionRunning === "function"
      && window.isManualExecutionRunning()) {
      showToast("Wait for the execution to finish or stop it before confirming the task.", "warning");
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

  async function finishTask(code = "", completionReason = "confirmed") {
    if (finishing) return;
    finishing = true;

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    showToast(
      completionReason === "timeout"
        ? "Time is up. Your current work is being saved."
        : "Task successfully completed!",
      completionReason === "timeout" ? "warning" : "success"
    );

    try {
      await logStartPromise;
    } catch (error) {
    }

    if (logId) {
      try {
        const response = await fetch("/api/experiment/log_end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            log_id: logId,
            code,
            completion_reason: completionReason
          }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Unable to end the experiment log");
        }
      } catch (error) {
        console.error("Error ending experiment log", error);
      }
    }

    const storage = window.sessionStorage;
    const index = Number.parseInt(storage.getItem("gear_index") || "0", 10);
    storage.setItem("gear_index", String(index + 1));

    window.setTimeout(() => {
      window.location.href = "/experiment";
    }, 700);
  }

  async function forceEndTask() {
    if (finishing) return;

    if (mode === "MANUAL" && typeof window.stopManualExecution === "function"
      && typeof window.isManualExecutionRunning === "function"
      && window.isManualExecutionRunning()) {
      try {
        await window.stopManualExecution();
      } catch (error) {
        console.warn("Unable to stop the manual execution at timeout", error);
      }
    }

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