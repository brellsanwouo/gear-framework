document.addEventListener("DOMContentLoaded", () => {
    const storage = window.sessionStorage;
    const state = {
        userId: storage.getItem("gear_user_id"),
        sequence: JSON.parse(storage.getItem("gear_sequence") || "[]"),
        currentIndex: Number.parseInt(storage.getItem("gear_index") || "0", 10),
        assignedMode: storage.getItem("gear_assigned_mode") || "",
        studyCode: storage.getItem("gear_study_code") || ""
    };

    const introScreen = document.getElementById("introScreen");
    const pauseScreen = document.getElementById("pauseScreen");
    const questionnaireScreen = document.getElementById("questionnaireScreen");
    const endScreen = document.getElementById("endScreen");
    const startBtn = document.getElementById("startBtn");
    const nextBtn = document.getElementById("nextBtn");
    const consentCheckbox = document.getElementById("consentCheckbox");
    const progressText = document.getElementById("progressText");
    const endMessage = document.getElementById("endMessage");
    const showConsentBtn = document.getElementById("showConsentBtn");
    const consentInformation = document.getElementById("consentInformation");
    const questionnaireForm = document.getElementById("questionnaireForm");
    const questionnaireStatus = document.getElementById("questionnaireStatus");
    const submitQuestionnaireBtn = document.getElementById("submitQuestionnaireBtn");
    const studyCodeText = document.getElementById("studyCodeText");
    const endStudyCodeText = document.getElementById("endStudyCodeText");

    document.querySelectorAll("select[data-likert], select[data-likert-na]").forEach((select) => {
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.textContent = "Select an answer";
        select.appendChild(placeholder);

        if (select.hasAttribute("data-likert-na")) {
            const option = document.createElement("option");
            option.value = "0";
            option.textContent = "Not applicable / I did not encounter feedback or errors";
            select.appendChild(option);
        }

        for (let value = 1; value <= 7; value += 1) {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = value === 1
                ? "1 — Strongly disagree"
                : value === 7
                    ? "7 — Strongly agree"
                    : String(value);
            select.appendChild(option);
        }
    });

    const trackingEnabled = () => storage.getItem("gear_tracking") === "true";
    const questionnaireKey = () => `gear_questionnaire_submitted_${state.userId}`;
    const frameworkLabel = (framework) => framework === "adk" ? "Google ADK" : "CrewAI";
    const modeLabel = (mode) => mode === "GEAR" ? "Gear Studio" : "manual Python";

    showConsentBtn.addEventListener("click", () => {
        const isHidden = consentInformation.classList.toggle("hidden");
        showConsentBtn.setAttribute("aria-expanded", String(!isHidden));
        showConsentBtn.textContent = isHidden
            ? "Read the study information"
            : "Hide the study information";

        if (!isHidden) {
            consentCheckbox.disabled = false;
            consentInformation.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    consentCheckbox.addEventListener("change", () => {
        startBtn.disabled = !consentCheckbox.checked;
    });

    if (state.userId && state.sequence.length > 0) {
        introScreen.classList.add("hidden");
        if (state.currentIndex >= state.sequence.length) {
            showCompletionStep();
        } else {
            showPauseScreen();
        }
    }

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
            launchTask();
        } catch (error) {
            console.error(error);
            alert(error.message || "Can't start the experiment. Check your connection.");
            startBtn.disabled = false;
            startBtn.textContent = "Start the experiment";
        }
    });

    nextBtn.addEventListener("click", launchTask);

    questionnaireForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!state.userId) {
            setQuestionnaireError("The participant identifier is missing.");
            return;
        }

        submitQuestionnaireBtn.disabled = true;
        submitQuestionnaireBtn.textContent = "Saving...";
        questionnaireStatus.textContent = "";
        questionnaireStatus.classList.remove("is-error");

        const formData = new FormData(questionnaireForm);
        const payload = {
            user_id: state.userId,
            python_experience: formData.get("python_experience"),
            multi_agent_experience: formData.get("multi_agent_experience"),
            crewai_experience: formData.get("crewai_experience"),
            adk_experience: formData.get("adk_experience"),
            ai_tool_frequency: formData.get("ai_tool_frequency"),
            prior_gear_use: formData.get("prior_gear_use"),
            method_ease: Number(formData.get("method_ease")),
            mental_effort: Number(formData.get("mental_effort")),
            confidence: Number(formData.get("confidence")),
            framework_switch_ease: Number(formData.get("framework_switch_ease")),
            reuse_helpfulness: Number(formData.get("reuse_helpfulness")),
            error_clarity: Number(formData.get("error_clarity")),
            future_use: Number(formData.get("future_use")),
            framework_transition_feedback: String(formData.get("framework_transition_feedback") || "").trim(),
            feedback: String(formData.get("feedback") || "").trim()
        };

        try {
            const response = await fetch("/api/experiment/questionnaire", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Unable to save the questionnaire.");

            storage.setItem(questionnaireKey(), "true");
            questionnaireScreen.classList.add("hidden");
            showEndScreen(result.saved === true);
        } catch (error) {
            console.error(error);
            setQuestionnaireError(error.message || "Unable to save the questionnaire.");
            submitQuestionnaireBtn.disabled = false;
            submitQuestionnaireBtn.textContent = "Submit answers";
        }
    });

    function setQuestionnaireError(message) {
        questionnaireStatus.textContent = message;
        questionnaireStatus.classList.add("is-error");
    }

    function hideAllScreens() {
        introScreen.classList.add("hidden");
        pauseScreen.classList.add("hidden");
        questionnaireScreen.classList.add("hidden");
        endScreen.classList.add("hidden");
    }

    function showPauseScreen() {
        hideAllScreens();
        pauseScreen.classList.remove("hidden");
        if (studyCodeText) studyCodeText.textContent = state.studyCode || "—";
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
    }

    function showCompletionStep() {
        hideAllScreens();
        const alreadySubmitted = storage.getItem(questionnaireKey()) === "true";
        if (alreadySubmitted) {
            showEndScreen(trackingEnabled());
            return;
        }

        questionnaireScreen.classList.remove("hidden");
        questionnaireScreen.scrollIntoView({ block: "start" });
    }

    function showEndScreen(questionnaireSaved) {
        hideAllScreens();
        endScreen.classList.remove("hidden");
        if (endStudyCodeText) endStudyCodeText.textContent = state.studyCode || "—";

        if (!trackingEnabled()) {
            endMessage.textContent =
                "The experiment is finished. Tracking was disabled, so the measurements and questionnaire answers were not stored.";
        } else if (questionnaireSaved) {
            endMessage.textContent =
                "The experiment is finished. Your measurements and questionnaire answers have been saved.";
        } else {
            endMessage.textContent =
                "The experiment is finished. Your task measurements were saved, but the questionnaire could not be confirmed.";
        }
    }

    function launchTask() {
        const task = state.sequence[state.currentIndex];
        if (!task) {
            showCompletionStep();
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

        const destination = task.mode === "GEAR" ? "/studio" : "/manual";
        window.location.assign(`${destination}?${params.toString()}`);
    }
});