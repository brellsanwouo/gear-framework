(async function() {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('uid');
    const taskId = params.get('tid');
    const mode = params.get('mode');

    if (!userId || !taskId) return;

    document.body.classList.add('experiment-active');

    let taskConfig = null;
    try {
        const res = await fetch(`/api/experiment/task_info/${taskId}`);
        if (!res.ok) throw new Error("Can't find the task");
        taskConfig = await res.json();
    } catch (e) {
        console.error("Error when loading config task", e);
        alert("Can't find instructions");
        return;
    }

    const overlayHTML = `
        <div id="expBar">
            <div class="exp-info">
                <span class="exp-task-id">${taskId}</span>
                <span style="font-size:0.9rem; opacity:0.8; margin-left: 8px;">
                    ${mode === 'GEAR' ? 'Gear' : 'Manual'}
                </span>
            </div>
            <div class="exp-timer" id="expTimer">Loading...</div>
            <div class="exp-actions">
                <button class="exp-btn exp-btn-info" id="btnInstructions">Instructions</button>
                <button class="exp-btn exp-btn-validate" id="btnValidate">Confirm & Finish</button>
            </div>
        </div>

        <div id="expDrawer" class="open">
            <div class="drawer-header">
                <h2>${taskConfig.title || 'Instruction'}</h2>
                <button class="close-drawer" id="btnCloseDrawer">×</button>
            </div>
            <div class="drawer-content">
                ${taskConfig.description || '<p>No available instructions.</p>'}
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', overlayHTML);

    const timerEl = document.getElementById('expTimer');

    // 0 => illimité, null/undefined => 600 par défaut
    const durationSeconds = Number(taskConfig.time_limit_seconds ?? 600);

    let timerInterval = null;
    let endTime = null;

    function getUserCode() {
        let userCode = "";
        if (mode === 'MANUAL') {
            const textarea = document.getElementById('manualInput');
            userCode = textarea ? textarea.value : "";
        } else {
            const yamlPreview = document.querySelector('.yaml-output');
            userCode = yamlPreview ? yamlPreview.value : "";
        }
        return userCode;
    }

    function startTimerIfNeeded() {
        if (durationSeconds === 0) {
            timerEl.textContent = "No time limit";
            timerEl.style.color = "#ef4444";
            return;
        }

        endTime = Date.now() + (durationSeconds * 1000);

        function updateTimerDisplay() {
            const now = Date.now();
            const timeLeftMs = endTime - now;

            if (timeLeftMs <= 0) {
                timerEl.textContent = "00:00";
                timerEl.style.color = '#ef4444';
                clearInterval(timerInterval);
                timerInterval = null;
                forceEndTask();
                return;
            }

            const totalSecondsLeft = Math.ceil(timeLeftMs / 1000);
            const m = Math.floor(totalSecondsLeft / 60).toString().padStart(2, '0');
            const s = (totalSecondsLeft % 60).toString().padStart(2, '0');

            timerEl.textContent = `${m}:${s}`;

            if (totalSecondsLeft < 60) {
                timerEl.style.color = '#ef4444';
            } else {
                timerEl.style.color = '#fbbf24';
            }
        }

        updateTimerDisplay();
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }

    startTimerIfNeeded();

    let logId = null;
    fetch('/api/experiment/log_start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ user_id: userId, task_id: taskId, mode: mode })
    })
    .then(r => r.json())
    .then(d => {
      logId = d.log_id;
      window.currentLogId = logId;
    })
    .catch(e => console.error("Error log start", e));

    const drawer = document.getElementById('expDrawer');
    document.getElementById('btnInstructions').onclick = () => drawer.classList.add('open');
    document.getElementById('btnCloseDrawer').onclick = () => drawer.classList.remove('open');

    const btnValidate = document.getElementById('btnValidate');

    btnValidate.onclick = async () => {
        const userCode = getUserCode();

        btnValidate.disabled = true;
        const originalText = btnValidate.textContent;
        btnValidate.textContent = "Verification...";

        try {
            const res = await fetch('/api/experiment/validate_task', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ task_id: taskId, code: userCode })
            });
            const result = await res.json();

            if (result.valid) {
                finishTask(userCode);
            } else {
                showToast(result.message || "Invalid configuration.", 'error');
                btnValidate.disabled = false;
                btnValidate.textContent = originalText;
            }
        } catch (e) {
            console.error(e);
            showToast("Error connecting to the server.", 'error');
            btnValidate.disabled = false;
            btnValidate.textContent = originalText;
        }
    };

    async function finishTask(code = "") {
        const message = "Task successfully completed!";

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        if (message) showToast(message, 'success');

        if (logId) {
            await fetch('/api/experiment/log_end', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    log_id: logId,
                    // metrics: window.currentTaskMetrics || {},
                    code: code
                })
            });
        }

        let idx = parseInt(localStorage.getItem('gear_index') || '0', 10);
        localStorage.setItem('gear_index', String(idx + 1));

        setTimeout(() => {
            window.location.href = '/experiment';
        }, 1000);
    }

    async function forceEndTask() {
        showToast("Time's up! Recording and switching to pause...", 'warning');

        const manualInput = document.getElementById('manualInput');
        if (manualInput) manualInput.disabled = true;

        btnValidate.disabled = true;
        btnValidate.textContent = "Time's up!";

        const currentCode = getUserCode();

        await new Promise(resolve => setTimeout(resolve, 2000));
        finishTask(currentCode);
    }

    function showToast(msg, type = 'info') {
        const existing = document.querySelector('.validation-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'validation-toast';
        toast.textContent = msg;

        if (!document.querySelector('style#toast-style')) {
            toast.style.cssText = `
                position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
                background: #1e293b; color: white; padding: 1rem 1.5rem; 
                border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); 
                z-index: 10002; font-family: sans-serif; border: 1px solid #475569;
                text-align: center; min-width: 300px;
            `;

            if (type === 'error') toast.style.border = "1px solid #ef4444";
            if (type === 'success') toast.style.border = "1px solid #10b981";
            if (type === 'warning') toast.style.border = "1px solid #f59e0b";
        }

        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 4000);
    }

})();
