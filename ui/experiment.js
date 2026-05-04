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
            window.location.href = `/?${params.toString()}`;
        } else {
            window.location.href = `/manual?${params.toString()}`;
        }
    }
});
