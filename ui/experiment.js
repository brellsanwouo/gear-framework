document.addEventListener('DOMContentLoaded', () => {
    const state = {
        userId: localStorage.getItem('gear_user_id'),
        sequence: JSON.parse(localStorage.getItem('gear_sequence') || '[]'),
        currentIndex: Number.parseInt(localStorage.getItem('gear_index') || '0', 10)
    };

    const introScreen = document.getElementById('introScreen');
    const pauseScreen = document.getElementById('pauseScreen');
    const questionnaireScreen = document.getElementById('questionnaireScreen');
    const endScreen = document.getElementById('endScreen');
    const startBtn = document.getElementById('startBtn');
    const nextBtn = document.getElementById('nextBtn');
    const consentCheckbox = document.getElementById('consentCheckbox');
    const progressText = document.getElementById('progressText');
    const endMessage = document.getElementById('endMessage');
    const showConsentBtn = document.getElementById('showConsentBtn');
    const consentInformation = document.getElementById('consentInformation');
    const questionnaireForm = document.getElementById('questionnaireForm');
    const questionnaireStatus = document.getElementById('questionnaireStatus');
    const submitQuestionnaireBtn = document.getElementById('submitQuestionnaireBtn');

    const trackingEnabled = () => localStorage.getItem('gear_tracking') === 'true';
    const questionnaireKey = () => `gear_questionnaire_submitted_${state.userId}`;

    showConsentBtn.addEventListener('click', () => {
        const isHidden = consentInformation.classList.toggle('hidden');
        showConsentBtn.setAttribute('aria-expanded', String(!isHidden));
        showConsentBtn.textContent = isHidden
            ? 'Read the study information'
            : 'Hide the study information';

        if (!isHidden) {
            consentCheckbox.disabled = false;
            consentInformation.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    consentCheckbox.addEventListener('change', () => {
        startBtn.disabled = !consentCheckbox.checked;
    });

    if (state.userId && state.sequence.length > 0) {
        introScreen.classList.add('hidden');
        if (state.currentIndex >= state.sequence.length) {
            showCompletionStep();
        } else {
            showPauseScreen();
        }
    }

    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        startBtn.textContent = 'Loading...';

        try {
            const response = await fetch('/api/experiment/start', { method: 'POST' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Error when starting the experiment');

            localStorage.setItem('gear_user_id', data.user_id);
            localStorage.setItem('gear_sequence', JSON.stringify(data.sequence));
            localStorage.setItem('gear_index', '0');
            localStorage.setItem('gear_tracking', data.tracking ? 'true' : 'false');
            if (data.participant_id) {
                localStorage.setItem('gear_participant_id', data.participant_id);
            }

            state.userId = data.user_id;
            state.sequence = data.sequence;
            state.currentIndex = 0;
            launchTask();
        } catch (error) {
            console.error(error);
            alert(error.message || "Can't start the experiment. Check your connection.");
            startBtn.disabled = false;
            startBtn.textContent = 'Start the experiment';
        }
    });

    nextBtn.addEventListener('click', launchTask);

    questionnaireForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!state.userId) {
            setQuestionnaireError('The participant identifier is missing.');
            return;
        }

        submitQuestionnaireBtn.disabled = true;
        submitQuestionnaireBtn.textContent = 'Saving...';
        questionnaireStatus.textContent = '';
        questionnaireStatus.classList.remove('is-error');

        const formData = new FormData(questionnaireForm);
        const payload = {
            user_id: state.userId,
            python_experience: formData.get('python_experience'),
            multi_agent_experience: formData.get('multi_agent_experience'),
            ai_tool_frequency: formData.get('ai_tool_frequency'),
            prior_gear_use: formData.get('prior_gear_use'),
            feedback: String(formData.get('feedback') || '').trim()
        };

        try {
            const response = await fetch('/api/experiment/questionnaire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Unable to save the questionnaire.');
            }

            localStorage.setItem(questionnaireKey(), 'true');
            questionnaireScreen.classList.add('hidden');
            showEndScreen(result.saved === true);
        } catch (error) {
            console.error(error);
            setQuestionnaireError(error.message || 'Unable to save the questionnaire.');
            submitQuestionnaireBtn.disabled = false;
            submitQuestionnaireBtn.textContent = 'Submit answers';
        }
    });

    function setQuestionnaireError(message) {
        questionnaireStatus.textContent = message;
        questionnaireStatus.classList.add('is-error');
    }

    function hideAllScreens() {
        introScreen.classList.add('hidden');
        pauseScreen.classList.add('hidden');
        questionnaireScreen.classList.add('hidden');
        endScreen.classList.add('hidden');
    }

    function showPauseScreen() {
        hideAllScreens();
        pauseScreen.classList.remove('hidden');
        progressText.textContent = state.currentIndex === 0
            ? `Ready to begin task 1 of ${state.sequence.length}.`
            : `Task ${state.currentIndex} of ${state.sequence.length} completed.`;
    }

    function showCompletionStep() {
        hideAllScreens();
        const alreadySubmitted = localStorage.getItem(questionnaireKey()) === 'true';
        if (alreadySubmitted) {
            showEndScreen(trackingEnabled());
            return;
        }

        questionnaireScreen.classList.remove('hidden');
        questionnaireScreen.scrollIntoView({ block: 'start' });
    }

    function showEndScreen(questionnaireSaved) {
        hideAllScreens();
        endScreen.classList.remove('hidden');

        if (!trackingEnabled()) {
            endMessage.textContent =
                'The experiment is finished. Tracking was disabled, so the measurements and questionnaire answers were not stored.';
        } else if (questionnaireSaved) {
            endMessage.textContent =
                'The experiment is finished. Your measurements and questionnaire answers have been saved.';
        } else {
            endMessage.textContent =
                'The experiment is finished. Your task measurements were saved, but the questionnaire could not be confirmed.';
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
            idx: String(state.currentIndex)
        });

        const destination = task.mode === 'GEAR' ? '/studio' : '/manual';
        window.location.assign(`${destination}?${params.toString()}`);
    }
});