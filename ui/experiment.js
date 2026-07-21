document.addEventListener('DOMContentLoaded', () => {

    const state = {
        userId: localStorage.getItem('gear_user_id'),
        sequence: JSON.parse(localStorage.getItem('gear_sequence') || '[]'),
        currentIndex: parseInt(localStorage.getItem('gear_index') || '0')
    };

    const introScreen = document.getElementById('introScreen');
    const pauseScreen = document.getElementById('pauseScreen');
    const endScreen = document.getElementById('endScreen');
    const nextTaskName = document.getElementById('nextTaskName');
    const startBtn = document.getElementById('startBtn');
    const nextBtn = document.getElementById('nextBtn');
    const consentCheckbox = document.getElementById('consentCheckbox');
    const participantName = document.getElementById('participantName');
    const registrationError = document.getElementById('registrationError');
    const progressText = document.getElementById('progressText');
    const endMessage = document.getElementById('endMessage');

    const updateRegistrationState = () => {
        startBtn.disabled = !consentCheckbox.checked || participantName.value.trim().length < 2;
    };
    consentCheckbox.addEventListener('change', updateRegistrationState);
    participantName.addEventListener('input', updateRegistrationState);


    if (state.userId && state.sequence.length > 0) {
        introScreen.classList.add('hidden');

        if (state.currentIndex >= state.sequence.length) {
            endScreen.classList.remove('hidden');
        } else {
            showPauseScreen();
        }
    }


    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        startBtn.textContent = "Inscription...";
        registrationError.hidden = true;

        try {
            const res = await fetch('/api/experiment/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participant_name: participantName.value.trim(),
                    rules_accepted: consentCheckbox.checked
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Impossible de démarrer la compétition.");

            localStorage.setItem('gear_user_id', data.user_id);
            localStorage.setItem('gear_participant_name', data.participant_name);
            localStorage.setItem('gear_sequence', JSON.stringify(data.sequence));
            localStorage.setItem('gear_index', '0');

            state.userId = data.user_id;
            state.sequence = data.sequence;
            state.currentIndex = 0;
            localStorage.setItem('gear_tracking', data.tracking ? 'true' : 'false');

            launchTask();

        } catch (error) {
            console.error(error);
            registrationError.textContent = error.message;
            registrationError.hidden = false;
            updateRegistrationState();
            startBtn.textContent = "Valider mon inscription";
        }
    });

    nextBtn.addEventListener('click', () => {
        launchTask();
    });


    function showPauseScreen() {
        pauseScreen.classList.remove('hidden');
        const nextTask = state.sequence[state.currentIndex];

        const modeLabel = nextTask.mode === 'GEAR' ? 'Gear' : 'Manual';
        nextTaskName.textContent = `${nextTask.id} (${modeLabel})`;
        progressText.textContent = `Task ${state.currentIndex + 1} of ${state.sequence.length}`;
    }

    function launchTask() {
        const task = state.sequence[state.currentIndex];

        const params = new URLSearchParams({
            uid: state.userId,
            tid: task.id,
            mode: task.mode,
            idx: state.currentIndex
        });

        if (task.mode === 'GEAR') {
            window.location.href = `/classic?${params.toString()}`;
        } else {
            window.location.href = `/manual?${params.toString()}`;
        }
    }

    const trackingEnabled = localStorage.getItem('gear_tracking') === 'true';
    endMessage.textContent = trackingEnabled
        ? 'The experiment is finished. Your results have been saved.'
        : 'The experiment is finished. Tracking was disabled, so no study results were stored.';
});
