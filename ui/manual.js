document.addEventListener("DOMContentLoaded", () => {
  const runBtn = document.getElementById("runWorkflowBtn");
  const stopBtn = document.getElementById("stopWorkflowBtn");
  const outputPre = document.getElementById("runOutput");
  const inputArea = document.getElementById("manualInput");
  const frameworkSelect = document.getElementById("frameworkTarget");

  const params = new URLSearchParams(window.location.search);
  const experimentUserId = params.get("uid");
  const experimentTaskId = params.get("tid");
  const assignedFramework = String(params.get("framework") || "").toLowerCase();
  const experimentSequenceIndex = Number.parseInt(params.get("idx") || "0", 10);
  const experimentFramework = ["crewai", "adk"].includes(assignedFramework)
    ? assignedFramework
    : null;

  const API_MANUAL_RUN_ENDPOINT = "/api/run/manual";
  const POLL_INTERVAL_MS = 500;
  let activeJobId = null;
  let stopping = false;

  if (experimentFramework && frameworkSelect) {
    frameworkSelect.value = experimentFramework;
    frameworkSelect.disabled = true;
    frameworkSelect.title = "The target framework is assigned by the experiment.";
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function frameworkLabel(value) {
    return value === "adk" ? "Google ADK" : "CrewAI";
  }

  function setRunningState(isRunning) {
    if (runBtn) runBtn.disabled = isRunning;
    if (stopBtn) stopBtn.disabled = !isRunning || stopping;
    if (frameworkSelect) frameworkSelect.disabled = Boolean(experimentFramework) || isRunning;
  }

  async function loadPreviousTaskSubmission() {
    if (!experimentUserId || !experimentTaskId || !experimentFramework || !inputArea) return;

    const query = new URLSearchParams({
      user_id: experimentUserId,
      task_id: experimentTaskId,
      framework: experimentFramework,
      sequence_index: Number.isFinite(experimentSequenceIndex) ? String(experimentSequenceIndex) : ""
    });

    try {
      const response = await fetch(`/api/experiment/task_seed?${query.toString()}`, {
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to load the previous solution.");
      if (!payload.submission || inputArea.value.trim()) return;

      inputArea.value = payload.submission;
      outputPre.textContent = payload.source_framework
        ? `Previous ${frameworkLabel(payload.source_framework)} solution loaded. Adapt it to ${frameworkLabel(experimentFramework)}.`
        : "# Waiting for execution...";
    } catch (error) {
      console.warn("Unable to preload the previous task submission", error);
      outputPre.textContent = "# The previous task solution could not be loaded. Start from the empty editor.";
      outputPre.classList.add("error");
    }
  }

  function renderResult(payload) {
    const stdout = payload?.stdout || "";
    const stderr = payload?.stderr || "";
    const combined = [stdout, stderr].filter(Boolean).join("\n");
    const duration = Number.isFinite(payload?.duration_ms)
      ? `\n\n# Duration: ${payload.duration_ms} ms`
      : "";
    const returnCode = payload?.returncode !== null && payload?.returncode !== undefined
      ? `\n# Return code: ${payload.returncode}`
      : "";

    outputPre.textContent = combined || "Execution finished without output.";
    outputPre.textContent += `${duration}${returnCode}`;
    outputPre.classList.toggle("error", Number(payload?.returncode) !== 0);
  }

  async function pollJob(jobId) {
    while (activeJobId === jobId) {
      const response = await fetch(`/api/run/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));

      if (response.status === 202) {
        outputPre.textContent = payload.status === "cancelling"
          ? "Stopping the workflow..."
          : "Workflow execution in progress...";
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (payload.cancelled) {
        const partialOutput = [payload.stdout, payload.stderr].filter(Boolean).join("\n");
        outputPre.textContent = partialOutput
          ? `${partialOutput}\n\nExecution stopped.`
          : "Execution stopped.";
        outputPre.classList.remove("error");
        return;
      }

      if (!response.ok) {
        throw new Error(payload?.error || "Server execution error");
      }

      renderResult(payload);
      return;
    }
  }

  async function cancelActiveRun({ silent = false } = {}) {
    if (!activeJobId || stopping) return;
    stopping = true;
    setRunningState(true);
    if (!silent) outputPre.textContent = "Stopping the workflow...";

    try {
      const response = await fetch(`/api/run/jobs/${encodeURIComponent(activeJobId)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
        keepalive: silent,
      });
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Unable to stop the execution");
      }
    } catch (error) {
      if (!silent) {
        outputPre.textContent = `# Error: ${error.message || error}`;
        outputPre.classList.add("error");
      }
    } finally {
      stopping = false;
    }
  }

  window.isManualExecutionRunning = () => Boolean(activeJobId);
  window.stopManualExecution = () => cancelActiveRun();

  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      const code = inputArea?.value || "";
      if (!code.trim()) {
        outputPre.textContent = "Write the code before executing.";
        outputPre.classList.add("error");
        return;
      }

      const targetFramework = experimentFramework || frameworkSelect?.value || "crewai";
      setRunningState(true);
      outputPre.textContent = "Starting the workflow...";
      outputPre.classList.remove("error");

      try {
        const experimentContext = typeof window.getExperimentRunContext === "function"
          ? await window.getExperimentRunContext()
          : null;
        const response = await fetch(API_MANUAL_RUN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            target: targetFramework,
            async: true,
            experiment_context: experimentContext,
          }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || "Server execution error");
        }
        if (!payload.job_id) {
          throw new Error("The server did not return an execution job identifier.");
        }

        activeJobId = payload.job_id;
        await pollJob(activeJobId);
      } catch (error) {
        console.error(error);
        outputPre.textContent = `# Error: ${error.message || error}`;
        outputPre.classList.add("error");
      } finally {
        activeJobId = null;
        stopping = false;
        setRunningState(false);
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      cancelActiveRun();
    });
  }

  window.addEventListener("beforeunload", () => {
    if (activeJobId) cancelActiveRun({ silent: true });
  });

  loadPreviousTaskSubmission();
});