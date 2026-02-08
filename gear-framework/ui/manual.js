document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('uid');
    const taskId = params.get('tid');

    const timerDisplay = document.getElementById('timer');
    const taskIdDisplay = document.getElementById('taskId');
    const instructionsDisplay = document.getElementById('instructions');
    const finishBtn = document.getElementById('finishBtn');

    let logId = null;
    let startTime = Date.now();
    let timerInterval = null;

    const INSTRUCTIONS = {
        "T1": "Écrivez le YAML pour un agent nommé 'Scraper' utilisant Python et Selenium.",
        "T2": "Définissez un module de base de données PostgreSQL.",
        "T3": "Créez un agent Writer connecté à OpenAI (GPT-4).",
        "T4": "Orchestrez le lien entre l'agent Scraper et l'agent Writer."
    };

    taskIdDisplay.textContent = taskId || "?";
    instructionsDisplay.textContent = INSTRUCTIONS[taskId] || "Instructions indisponibles pour cette tâche.";

    async function initTask() {
        if (!userId || !taskId) {
            alert("Erreur : Paramètres utilisateur manquants (uid ou tid).");
            return;
        }

        try {
            const res = await fetch('/api/experiment/log_start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    user_id: userId,
                    task_id: taskId,
                    mode: 'MANUAL'
                })
            });

            if (!res.ok) throw new Error("Erreur serveur");

            const data = await res.json();
            logId = data.log_id;

            startTimer();

        } catch (error) {
            console.error("Impossible de démarrer le log:", error);
            instructionsDisplay.textContent += " (Erreur de connexion serveur)";
        }
    }

    function startTimer() {
        timerInterval = setInterval(() => {
            const diff = Math.floor((Date.now() - startTime) / 1000);
            const m = Math.floor(diff / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            timerDisplay.textContent = `${m}:${s}`;
        }, 1000);
    }

    finishBtn.addEventListener('click', async () => {
        if (!logId) {
            alert("La tâche n'a pas été correctement initialisée.");
            return;
        }

        if(!confirm("Avez-vous terminé votre code YAML/JSON ?")) return;

        finishBtn.disabled = true;
        finishBtn.textContent = "Enregistrement...";
        clearInterval(timerInterval);

        try {
            await fetch('/api/experiment/log_end', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ log_id: logId })
            });

            let idx = parseInt(localStorage.getItem('gear_index') || '0');
            localStorage.setItem('gear_index', idx + 1);

            // Retour au Hub
            window.location.href = '/experiment';

        } catch (error) {
            console.error("Erreur lors de la fin de tâche:", error);
            alert("Une erreur est survenue lors de la sauvegarde. Veuillez réessayer.");
            finishBtn.disabled = false;
            finishBtn.textContent = "Valider & Terminer";
        }
    });

    initTask();
});