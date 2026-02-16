document.addEventListener('DOMContentLoaded', () => {

    const runBtn = document.getElementById('runWorkflowBtn');
    const stopBtn = document.getElementById('stopWorkflowBtn');
    const outputPre = document.getElementById('runOutput');
    const inputArea = document.getElementById('manualInput');
    const frameworkSelect = document.getElementById('frameworkTarget');


    const API_RUN_ENDPOINT = "/api/run";
    let runAborter = null;


    if (runBtn) {
        runBtn.addEventListener('click', async () => {
            const code = inputArea.value;
            if (!code || !code.trim()) {
                outputPre.textContent = "Write the code before executing.";
                return;
            }

            const targetFramework = frameworkSelect.value;

            if (runAborter) runAborter.abort();
            runAborter = new AbortController();
            outputPre.textContent = `Execution of the workflow...`;
            outputPre.classList.remove('error');

            try {
                const logId = window.currentLogId;
                if (!logId) {
                  outputPre.textContent = "log_id manquant";
                  return;
                }
                const response = await fetch(API_RUN_ENDPOINT, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    log_id: logId,
                    code: code,
                    inputs: {},
                    target: targetFramework
                  }),
                  signal: runAborter.signal,
                });

                const payload = await response.json();

                // if (!window.currentTaskMetrics) {
                //     window.currentTaskMetrics = {
                //         total_tokens: 0,
                //         total_errors: 0,
                //         llm_calls: 0,
                //     };
                // }
                //
                // const m = payload.metrics || {};
                //
                // window.currentTaskMetrics.total_tokens += m.total_tokens || 0;
                // window.currentTaskMetrics.total_errors += m.total_errors || 0;
                // window.currentTaskMetrics.llm_calls += m.llm_calls || 0;

                //window.currentReturnCode = payload.returncode ?? 0;



                if (!response.ok) {
                    throw new Error(payload?.error || "Erreur d'exécution serveur");
                }

                const stdout = payload?.stdout || "";
                const stderr = payload?.stderr || "";
                const combined = [stdout, stderr].filter(Boolean).join("\n");

                outputPre.textContent = combined || "\nExecution finished (no results).";

            } catch (error) {
                if (error.name === 'AbortError') {
                    outputPre.textContent += "\nExecution stopped.";
                } else {
                    console.error(error);
                    outputPre.textContent = `# Error : ${error.message || error}`;
                    outputPre.classList.add('error');
                }
            } finally {
                runAborter = null;
            }
        });
    }


    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (runAborter) {
                runAborter.abort();
                runAborter = null;
            }
        });
    }
});