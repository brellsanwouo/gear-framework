(async function () {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("uid");
  const taskId = params.get("tid");
  const mode = params.get("mode");

  if (!userId || !taskId) return;

  document.body.classList.add("experiment-active", mode === "MANUAL" ? "experiment-manual" : "experiment-gear");

  let taskConfig = {};
  try {
    const response = await fetch(`/api/experiment/task_info/${encodeURIComponent(taskId)}`);
    if (response.ok) taskConfig = await response.json();
    else console.warn("Unable to load task timing; using the default duration.");
  } catch (error) {
    console.warn("Unable to load task timing; using the default duration.", error);
  }

  const modeLabel = mode === "GEAR" ? "Gear" : "Manual";
  const overlayHTML = `
    <div id="expBar" role="region" aria-label="Experiment controls">
      <div class="exp-info">
        <span class="exp-label">Experiment</span>
        <span class="exp-mode">${modeLabel}</span>
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

  // 0 means unlimited. Missing values use the ten-minute default.
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
    timerInterval = setInterval(updateTimerDisplay, 1000);
  }

  startTimerIfNeeded();

  const logStartPromise = fetch("/api/experiment/log_start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, task_id: taskId, mode }),
  })
    .then((response) => {
      if (!response.ok) throw new Error("Unable to start the experiment log");
      return response.json();
    })
    .then((data) => {
      logId = data.log_id;
      window.currentLogId = logId;
    })
    .catch((error) => console.error("Error starting experiment log", error));

  btnValidate.addEventListener("click", async () => {
    if (finishing) return;

    const userCode = getUserCode();
    btnValidate.disabled = true;
    const originalText = btnValidate.textContent;
    btnValidate.textContent = "Verification...";

    try {
      const response = await fetch("/api/experiment/validate_task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, code: userCode, mode }),
      });
      const result = await response.json();

      if (result.valid) {
        await finishTask(userCode);
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

  async function finishTask(code = "") {
    if (finishing) return;
    finishing = true;

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    showToast("Task successfully completed!", "success");

    try {
      await logStartPromise;
    } catch (error) {
    }

    if (logId) {
      try {
        const response = await fetch("/api/experiment/log_end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ log_id: logId, code }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Unable to end the experiment log");
        }
      } catch (error) {
        console.error("Error ending experiment log", error);
      }
    }

    const index = Number.parseInt(localStorage.getItem("gear_index") || "0", 10);
    localStorage.setItem("gear_index", String(index + 1));

    window.setTimeout(() => {
      window.location.href = "/experiment";
    }, 700);
  }

  async function forceEndTask() {
    if (finishing) return;

    showToast("Time is up. Saving this task...", "warning");
    const manualInput = document.getElementById("manualInput");
    if (manualInput) manualInput.disabled = true;

    btnValidate.disabled = true;
    btnValidate.textContent = "Time is up";
    await finishTask(getUserCode());
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