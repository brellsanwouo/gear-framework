document.addEventListener("DOMContentLoaded", () => {
    const storage = window.sessionStorage;
    const state = {
        userId: storage.getItem("gear_user_id") || "",
        sequence: JSON.parse(storage.getItem("gear_sequence") || "[]"),
        currentIndex: Number.parseInt(storage.getItem("gear_index") || "0", 10),
        assignedMode: storage.getItem("gear_assigned_mode") || "",
        studyCode: storage.getItem("gear_study_code") || "",
        progress: {
            background_submitted: false,
            task_log_ids: [],
            frameworks: [],
            final_submitted: false,
            operator_report_submitted: false
        }
    };

    let operatorPin = "";
    let activeTaskQuestionnaire = null;
    let activeFrameworkQuestionnaire = "";

    const screens = [...document.querySelectorAll("body > .card")];
    const introScreen = document.getElementById("introScreen");
    const backgroundScreen = document.getElementById("backgroundScreen");
    const pauseScreen = document.getElementById("pauseScreen");
    const taskQuestionnaireScreen = document.getElementById("taskQuestionnaireScreen");
    const frameworkQuestionnaireScreen = document.getElementById("frameworkQuestionnaireScreen");
    const finalQuestionnaireScreen = document.getElementById("finalQuestionnaireScreen");
    const operatorReportScreen = document.getElementById("operatorReportScreen");
    const endScreen = document.getElementById("endScreen");

    const startBtn = document.getElementById("startBtn");
    const nextBtn = document.getElementById("nextBtn");
    const consentCheckbox = document.getElementById("consentCheckbox");
    const showConsentBtn = document.getElementById("showConsentBtn");
    const consentInformation = document.getElementById("consentInformation");
    const progressText = document.getElementById("progressText");
    const studyCodeText = document.getElementById("studyCodeText");
    const backgroundStudyCode = document.getElementById("backgroundStudyCode");
    const operatorStudyCode = document.getElementById("operatorStudyCode");
    const endStudyCodeText = document.getElementById("endStudyCodeText");
    const endMessage = document.getElementById("endMessage");

    const backgroundForm = document.getElementById("backgroundForm");
    const taskQuestionnaireForm = document.getElementById("taskQuestionnaireForm");
    const frameworkQuestionnaireForm = document.getElementById("frameworkQuestionnaireForm");
    const finalQuestionnaireForm = document.getElementById("finalQuestionnaireForm");
    const operatorReportForm = document.getElementById("operatorReportForm");

    const operatorPinDialog = document.getElementById("operatorPinDialog");
    const operatorPinForm = document.getElementById("operatorPinForm");
    const operatorPinInput = document.getElementById("operatorPinInput");
    const operatorPinStatus = document.getElementById("operatorPinStatus");
    const unlockOperatorReportBtn = document.getElementById("unlockOperatorReportBtn");
    const cancelOperatorPinBtn = document.getElementById("cancelOperatorPinBtn");
    const operatorLockedPanel = document.getElementById("operatorLockedPanel");

    const trackingEnabled = () => storage.getItem("gear_tracking") === "true";
    const backgroundKey = () => `gear_background_submitted_${state.userId}`;
    const pendingTaskKey = () => `gear_pending_task_questionnaire_${state.userId}`;
    const taskResponseKey = (sequenceIndex) => `gear_task_questionnaire_${state.userId}_${sequenceIndex}`;
    const frameworkResponseKey = (framework) => `gear_framework_questionnaire_${state.userId}_${framework}`;
    const finalResponseKey = () => `gear_final_questionnaire_${state.userId}`;
    const operatorReportKey = () => `gear_operator_report_${state.userId}`;

    const frameworkLabel = (framework) => framework === "adk" ? "Google ADK" : "CrewAI";
    const modeLabel = (mode) => mode === "GEAR" ? "Gear Studio" : "manual Python";

    function appendOptions(select, options) {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = "Select an answer";
        select.appendChild(placeholder);
        options.forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = label;
            select.appendChild(option);
        });
    }

    document.querySelectorAll("select[data-frequency]").forEach((select) => appendOptions(select, [
        ["never", "Never"],
        ["less_than_monthly", "Less than monthly"],
        ["monthly", "Monthly"],
        ["weekly", "Weekly"],
        ["daily", "Daily"]
    ]));

    document.querySelectorAll("select[data-framework-experience]").forEach((select) => appendOptions(select, [
        ["none", "None"],
        ["read_about", "I had read about it"],
        ["completed_tutorial", "I had completed a tutorial"],
        ["one_project", "I had used it in one project"],
        ["several_projects", "I had used it in several projects"]
    ]));

    document.querySelectorAll("select[data-likert-comfort]").forEach((select) => appendOptions(select,
        Array.from({ length: 7 }, (_, index) => {
            const value = index + 1;
            const label = value === 1 ? "1 — Not at all comfortable"
                : value === 7 ? "7 — Completely comfortable" : String(value);
            return [value, label];
        })
    ));

    document.querySelectorAll("select[data-likert-agreement], select[data-likert-agreement-na]").forEach((select) => {
        const options = [];
        if (select.hasAttribute("data-likert-agreement-na")) {
            options.push([0, "Not applicable — I encountered no error or feedback"]);
        }
        for (let value = 1; value <= 7; value += 1) {
            options.push([value, value === 1 ? "1 — Strongly disagree"
                : value === 7 ? "7 — Strongly agree" : String(value)]);
        }
        appendOptions(select, options);
    });

    document.querySelectorAll("select[data-seq]").forEach((select) => appendOptions(select,
        Array.from({ length: 7 }, (_, index) => {
            const value = index + 1;
            const label = value === 1 ? "1 — Very difficult"
                : value === 4 ? "4 — Neither difficult nor easy"
                    : value === 7 ? "7 — Very easy" : String(value);
            return [value, label];
        })
    ));

    document.querySelectorAll("select[data-technical-impact]").forEach((select) => appendOptions(select, [
        [0, "No"],
        [1, "Yes, slightly"],
        [2, "Yes, moderately"],
        [3, "Yes, substantially"]
    ]));

    document.querySelectorAll("select[data-reuse-extent]").forEach((select) => appendOptions(select, [
        [0, "None"],
        [1, "A small part"],
        [2, "About half"],
        [3, "Most of it"],
        [4, "Almost all of it"]
    ]));

    const susStatements = [
        "I would like to use this development method frequently.",
        "I found this development method unnecessarily complex.",
        "I found this development method easy to use.",
        "I would need assistance from a technical person to use this development method.",
        "The different parts of this development method worked together coherently.",
        "I found too many inconsistencies in this development method.",
        "I think most developers would learn this development method quickly.",
        "I found this development method cumbersome to use.",
        "I felt confident while using this development method.",
        "I needed to learn many things before I could work effectively with this development method."
    ];
    const susItems = document.getElementById("susItems");
    susStatements.forEach((statement, index) => {
        const label = document.createElement("label");
        label.className = "form-field";
        const text = document.createElement("span");
        text.textContent = `${index + 1}. ${statement}`;
        const select = document.createElement("select");
        select.name = `sus_${index + 1}`;
        select.required = true;
        appendOptions(select, [
            [1, "1 — Strongly disagree"], [2, "2 — Disagree"],
            [3, "3 — Neither agree nor disagree"], [4, "4 — Agree"],
            [5, "5 — Strongly agree"]
        ]);
        label.append(text, select);
        susItems.appendChild(label);
    });

    document.querySelectorAll(".range-field input[type='range']").forEach((input) => {
        const output = input.closest(".range-field").querySelector("output");
        const update = () => { output.value = input.value; output.textContent = input.value; };
        input.addEventListener("input", update);
        update();
    });

    function hideAllScreens() {
        screens.forEach((screen) => screen.classList.add("hidden"));
    }

    function showScreen(screen) {
        hideAllScreens();
        screen.classList.remove("hidden");
        screen.scrollIntoView({ block: "start" });
    }

    function setFormStatus(elementId, message = "", error = false) {
        const element = document.getElementById(elementId);
        element.textContent = message;
        element.classList.toggle("is-error", error);
    }

    async function postJson(url, payload, headers = {}) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Unable to save the response.");
        return result;
    }

    function formPayload(form) {
        return Object.fromEntries(new FormData(form).entries());
    }

    async function refreshProgress() {
        if (!state.userId || !trackingEnabled()) return;
        try {
            const response = await fetch(`/api/experiment/questionnaire_progress?user_id=${encodeURIComponent(state.userId)}`);
            const result = await response.json();
            if (response.ok) state.progress = result;
        } catch (error) {
            console.warn("Unable to refresh questionnaire progress", error);
        }
    }

    function backgroundSubmitted() {
        return state.progress.background_submitted || storage.getItem(backgroundKey()) === "true";
    }

    function taskSubmitted(pending) {
        if (!pending) return true;
        if (Number.isInteger(Number(pending.task_log_id)) && Number(pending.task_log_id) > 0
            && state.progress.task_log_ids.includes(Number(pending.task_log_id))) return true;
        return storage.getItem(taskResponseKey(pending.sequence_index)) === "true";
    }

    function frameworkSubmitted(framework) {
        return state.progress.frameworks.includes(framework)
            || storage.getItem(frameworkResponseKey(framework)) === "true";
    }

    function finalSubmitted() {
        return state.progress.final_submitted || storage.getItem(finalResponseKey()) === "true";
    }

    function operatorReportSubmitted() {
        return state.progress.operator_report_submitted || storage.getItem(operatorReportKey()) === "true";
    }

    function pendingTask() {
        try {
            return JSON.parse(storage.getItem(pendingTaskKey()) || "null");
        } catch {
            return null;
        }
    }

    function boundaryFramework() {
        const completedIndex = state.currentIndex - 1;
        if (completedIndex < 0) return "";
        const completed = state.sequence[completedIndex];
        if (!completed || !["first_implementation", "translation"].includes(completed.study_phase)) return "";
        const next = state.sequence[state.currentIndex];
        if (next && next.framework === completed.framework) return "";
        return frameworkSubmitted(completed.framework) ? "" : completed.framework;
    }

    async function resumeFlow() {
        await refreshProgress();
        if (!backgroundSubmitted()) {
            showBackgroundScreen();
            return;
        }

        const pending = pendingTask();
        if (pending && !taskSubmitted(pending)) {
            showTaskQuestionnaire(pending);
            return;
        }
        if (pending) storage.removeItem(pendingTaskKey());

        const framework = boundaryFramework();
        if (framework) {
            showFrameworkQuestionnaire(framework);
            return;
        }

        if (state.currentIndex >= state.sequence.length) {
            if (!finalSubmitted()) {
                showFinalQuestionnaire();
            } else if (!operatorReportSubmitted()) {
                showOperatorReport();
            } else {
                showEndScreen(true);
            }
            return;
        }
        showPauseScreen();
    }

    showConsentBtn.addEventListener("click", () => {
        const hidden = consentInformation.classList.toggle("hidden");
        showConsentBtn.setAttribute("aria-expanded", String(!hidden));
        showConsentBtn.textContent = hidden ? "Read the study information" : "Hide the study information";
        if (!hidden) {
            consentCheckbox.disabled = false;
            consentInformation.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    consentCheckbox.addEventListener("change", () => {
        startBtn.disabled = !consentCheckbox.checked;
    });

    startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        startBtn.textContent = "Loading...";
        try {
            const response = await fetch("/api/experiment/start", { method: "POST" });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Error when starting the experiment");
            storage.setItem("gear_user_id", data.user_id);
            storage.setItem("gear_sequence", JSON.stringify(data.sequence));
            storage.setItem("gear_index", "0");
            storage.setItem("gear_tracking", data.tracking ? "true" : "false");
            storage.setItem("gear_assigned_mode", data.mode || "");
            if (data.participant_id) storage.setItem("gear_participant_id", data.participant_id);
            if (data.study_code) storage.setItem("gear_study_code", data.study_code);
            state.userId = data.user_id;
            state.sequence = data.sequence;
            state.currentIndex = 0;
            state.assignedMode = data.mode || "";
            state.studyCode = data.study_code || "";
            showBackgroundScreen();
        } catch (error) {
            alert(error.message || "Can't start the experiment. Check your connection.");
            startBtn.disabled = false;
            startBtn.textContent = "Start the experiment";
        }
    });

    function showBackgroundScreen() {
        backgroundStudyCode.textContent = state.studyCode || "—";
        showScreen(backgroundScreen);
    }

    backgroundForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("submitBackgroundBtn");
        button.disabled = true;
        setFormStatus("backgroundStatus");
        try {
            await postJson("/api/experiment/background_questionnaire", {
                user_id: state.userId,
                ...formPayload(backgroundForm)
            });
            storage.setItem(backgroundKey(), "true");
            state.progress.background_submitted = true;
            showPauseScreen();
        } catch (error) {
            setFormStatus("backgroundStatus", error.message, true);
            button.disabled = false;
        }
    });

    function showPauseScreen() {
        studyCodeText.textContent = state.studyCode || "—";
        const nextTask = state.sequence[state.currentIndex];
        const previousTask = state.sequence[state.currentIndex - 1];
        const assignment = nextTask ? modeLabel(nextTask.mode) : modeLabel(state.assignedMode);
        const nextPhase = nextTask?.study_phase || "";
        if (state.currentIndex === 0 && nextTask) {
            progressText.textContent = `You have been assigned to ${assignment}. You will begin with an unmeasured training task in ${frameworkLabel(nextTask.framework)}.`;
            nextBtn.textContent = "Start training";
        } else if (nextPhase === "familiarization") {
            progressText.textContent = `Training completed. The next task is a familiarization task in ${frameworkLabel(nextTask.framework)}.`;
            nextBtn.textContent = "Start familiarization";
        } else if (nextPhase === "first_implementation") {
            progressText.textContent = `The next task is part of the measured study in ${frameworkLabel(nextTask.framework)}.`;
            nextBtn.textContent = "Start measured task";
        } else if (nextPhase === "translation" && previousTask?.framework !== nextTask.framework) {
            progressText.textContent = `First framework completed. You will now adapt the same measured tasks to ${frameworkLabel(nextTask.framework)}.`;
            nextBtn.textContent = "Start translation";
        } else if (nextPhase === "translation") {
            progressText.textContent = `Continue adapting the measured tasks to ${frameworkLabel(nextTask.framework)}.`;
            nextBtn.textContent = "Start translation";
        } else {
            progressText.textContent = `Step ${state.currentIndex} of ${state.sequence.length} completed.`;
            nextBtn.textContent = "Start next task";
        }
        showScreen(pauseScreen);
    }

    nextBtn.addEventListener("click", launchTask);

    function launchTask() {
        const task = state.sequence[state.currentIndex];
        if (!task) {
            resumeFlow();
            return;
        }
        const params = new URLSearchParams({
            uid: state.userId,
            tid: task.id,
            mode: task.mode,
            framework: task.framework,
            idx: String(state.currentIndex),
            phase: task.study_phase || "measured",
            code: state.studyCode || ""
        });
        window.location.assign(`${task.mode === "GEAR" ? "/studio" : "/manual"}?${params.toString()}`);
    }

    function showTaskQuestionnaire(pending) {
        activeTaskQuestionnaire = pending;
        document.getElementById("taskQuestionnaireContext").textContent =
            `${pending.task_id} · ${frameworkLabel(pending.framework)} · ${modeLabel(pending.mode)}`;
        const translationFields = document.getElementById("translationTaskFields");
        const translation = pending.study_phase === "translation";
        translationFields.classList.toggle("hidden", !translation);
        translationFields.querySelectorAll("select").forEach((select) => { select.required = translation; });
        showScreen(taskQuestionnaireScreen);
    }

    taskQuestionnaireForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("submitTaskQuestionnaireBtn");
        button.disabled = true;
        setFormStatus("taskQuestionnaireStatus");
        try {
            await postJson("/api/experiment/task_questionnaire", {
                user_id: state.userId,
                task_log_id: activeTaskQuestionnaire?.task_log_id,
                ...formPayload(taskQuestionnaireForm)
            });
            storage.setItem(taskResponseKey(activeTaskQuestionnaire.sequence_index), "true");
            if (activeTaskQuestionnaire.task_log_id) {
                state.progress.task_log_ids.push(Number(activeTaskQuestionnaire.task_log_id));
            }
            storage.removeItem(pendingTaskKey());
            taskQuestionnaireForm.reset();
            button.disabled = false;
            activeTaskQuestionnaire = null;
            resumeFlow();
        } catch (error) {
            setFormStatus("taskQuestionnaireStatus", error.message, true);
            button.disabled = false;
        }
    });

    function showFrameworkQuestionnaire(framework) {
        activeFrameworkQuestionnaire = framework;
        document.getElementById("frameworkQuestionnaireContext").textContent =
            `${frameworkLabel(framework)} · measured tasks completed`;
        showScreen(frameworkQuestionnaireScreen);
    }

    frameworkQuestionnaireForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("submitFrameworkQuestionnaireBtn");
        button.disabled = true;
        setFormStatus("frameworkQuestionnaireStatus");
        try {
            await postJson("/api/experiment/framework_questionnaire", {
                user_id: state.userId,
                framework: activeFrameworkQuestionnaire,
                ...formPayload(frameworkQuestionnaireForm)
            });
            storage.setItem(frameworkResponseKey(activeFrameworkQuestionnaire), "true");
            state.progress.frameworks.push(activeFrameworkQuestionnaire);
            frameworkQuestionnaireForm.reset();
            document.querySelectorAll(".range-field input[type='range']").forEach((input) => {
                input.dispatchEvent(new Event("input"));
            });
            button.disabled = false;
            activeFrameworkQuestionnaire = "";
            resumeFlow();
        } catch (error) {
            setFormStatus("frameworkQuestionnaireStatus", error.message, true);
            button.disabled = false;
        }
    });

    function assignmentDetails() {
        const frameworkOrder = [];
        state.sequence.forEach((task) => {
            if (task.framework && !frameworkOrder.includes(task.framework)) frameworkOrder.push(task.framework);
        });
        const taskOrder = state.sequence
            .filter((task) => task.study_phase === "first_implementation")
            .map((task) => task.id);
        return { frameworkOrder, taskOrder };
    }

    function showFinalQuestionnaire() {
        const { frameworkOrder, taskOrder } = assignmentDetails();
        document.getElementById("assignmentSummary").innerHTML = `
            <strong>Study code:</strong> ${state.studyCode || "—"}<br>
            <strong>Assigned method:</strong> ${modeLabel(state.assignedMode)}<br>
            <strong>Framework order:</strong> ${frameworkOrder.map(frameworkLabel).join(" → ")}<br>
            <strong>Task order:</strong> ${taskOrder.join(" → ")}
        `;
        showScreen(finalQuestionnaireScreen);
    }

    const technicalImpactOverall = finalQuestionnaireForm.elements.technical_impact_overall;
    const experimenterHelp = finalQuestionnaireForm.elements.experimenter_help;
    function updateConditionalFields() {
        const technicalRequired = Number(technicalImpactOverall.value || 0) > 0;
        const technicalField = document.getElementById("technicalIssueDescriptionField");
        technicalField.classList.toggle("hidden", !technicalRequired);
        technicalField.querySelector("textarea").required = technicalRequired;
        const helpRequired = experimenterHelp.value && experimenterHelp.value !== "no";
        const helpField = document.getElementById("experimenterHelpDescriptionField");
        helpField.classList.toggle("hidden", !helpRequired);
        helpField.querySelector("textarea").required = Boolean(helpRequired);
    }
    technicalImpactOverall.addEventListener("change", updateConditionalFields);
    experimenterHelp.addEventListener("change", updateConditionalFields);

    finalQuestionnaireForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("submitFinalQuestionnaireBtn");
        button.disabled = true;
        setFormStatus("finalQuestionnaireStatus");
        try {
            await postJson("/api/experiment/final_questionnaire", {
                user_id: state.userId,
                ...formPayload(finalQuestionnaireForm)
            });
            storage.setItem(finalResponseKey(), "true");
            state.progress.final_submitted = true;
            showOperatorReport();
        } catch (error) {
            setFormStatus("finalQuestionnaireStatus", error.message, true);
            button.disabled = false;
        }
    });

    function showOperatorReport() {
        operatorStudyCode.textContent = state.studyCode || "—";
        operatorPin = "";
        operatorReportForm.classList.add("hidden");
        operatorLockedPanel.classList.remove("hidden");
        showScreen(operatorReportScreen);
    }

    unlockOperatorReportBtn.addEventListener("click", () => {
        operatorPinInput.value = "";
        operatorPinStatus.textContent = "";
        operatorPinDialog.showModal();
        operatorPinInput.focus();
    });

    cancelOperatorPinBtn.addEventListener("click", () => operatorPinDialog.close());

    operatorPinForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const candidate = operatorPinInput.value;
        operatorPinStatus.textContent = "";
        try {
            const response = await fetch("/api/experiment/operator/verify", {
                method: "POST",
                headers: { "X-Gear-Operator-Pin": candidate }
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Unable to verify the operator PIN.");
            operatorPin = candidate;
            operatorPinInput.value = "";
            operatorPinDialog.close();
            operatorLockedPanel.classList.add("hidden");
            operatorReportForm.classList.remove("hidden");
        } catch (error) {
            operatorPinStatus.textContent = error.message;
        }
    });

    operatorReportForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("submitOperatorReportBtn");
        button.disabled = true;
        setFormStatus("operatorReportStatus");
        try {
            await postJson("/api/experiment/operator_report", {
                user_id: state.userId,
                ...formPayload(operatorReportForm)
            }, { "X-Gear-Operator-Pin": operatorPin });
            operatorPin = "";
            storage.setItem(operatorReportKey(), "true");
            state.progress.operator_report_submitted = true;
            showEndScreen(true);
        } catch (error) {
            setFormStatus("operatorReportStatus", error.message, true);
            button.disabled = false;
        }
    });

    function showEndScreen(saved) {
        endStudyCodeText.textContent = state.studyCode || "—";
        if (!trackingEnabled()) {
            endMessage.textContent = "The experiment is finished. Tracking was disabled, so the responses were not stored.";
        } else if (saved) {
            endMessage.textContent = "The experiment is finished. Task data, questionnaires, written debriefing, and the operator report have been saved.";
        } else {
            endMessage.textContent = "The experiment is finished, but some data could not be confirmed.";
        }
        showScreen(endScreen);
    }

    if (state.userId && state.sequence.length > 0) {
        resumeFlow();
    }
});