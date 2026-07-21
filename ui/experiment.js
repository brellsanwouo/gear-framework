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
    const progressText = document.getElementById('progressText');
    const endMessage = document.getElementById('endMessage');

    consentCheckbox.addEventListener('change', () => {
        startBtn.disabled = !consentCheckbox.checked;
    });


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
        startBtn.textContent = "Loading...";

        try {
            const res = await fetch('/api/experiment/start', { method: 'POST' });
            if (!res.ok) throw new Error("Error when starting");
            const data = await res.json();

            localStorage.setItem('gear_user_id', data.user_id);
            localStorage.setItem('gear_sequence', JSON.stringify(data.sequence));
            localStorage.setItem('gear_index', '0');

            state.userId = data.user_id;
            state.sequence = data.sequence;
            state.currentIndex = 0;
            localStorage.setItem('gear_tracking', data.tracking ? 'true' : 'false');

            launchTask();

        } catch (error) {
            console.error(error);
            alert("Can't start the experiments. Check your connexion.");
            startBtn.disabled = false;
            startBtn.textContent = "Start the experiment";
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
