const yamlInput = document.getElementById('yamlInput');
const yamlOutput = document.getElementById('yamlOutput');
const statusEl = document.getElementById('status');
const convertBtn = document.getElementById('convert');
const loadExampleBtn = document.getElementById('loadExample');
const clearAllBtn = document.getElementById('clearAll');
const copyInputBtn = document.getElementById('copyInput');
const copyOutputBtn = document.getElementById('copyOutput');

const exampleYaml = `agent:
  identity:
    name: "Senior Data Scientist"
    purpose: "Analyze and interpret complex datasets to provide actionable insights"
    context_description: "With over 10 years of experience in data science and machine learning, you excel at finding patterns in complex datasets."
  agent_type:
    type: "SingleAgent"
  llm_configuration:
    model: "gpt-4"
    api_configuration:
      max_retries: 2
    safety_configuration:
      enabled: true
      mode: "safe"
  instruction_definition:
    task_specification:
      task_name: "Data Analysis Task"
      task_description: "Analyze and interpret complex datasets to provide actionable insights"
  tools:
    - name: "SerperDevTool"
      type: "search_tool"
  execution_control:
    delegation_control: "DisableDelegation"
    code_execution_control: "DisableCodeExecution"
    verbosity_control: "DisableVerbose"
    caching_control: "EnableCache"
  memory_system:
    enabled: false
  planning_capability:
    enabled: false
`;

function setStatus(message, kind = '') {
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2400);
}

async function convertYaml() {
    const yamlText = yamlInput.value.trim();
    if (!yamlText) {
        setStatus('YAML manquant', 'error');
        showToast('Ajoute un YAML generique');
        return;
    }

    setStatus('Conversion en cours...', 'pending');
    convertBtn.disabled = true;

    try {
        const response = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ yaml: yamlText })
        });

        const data = await response.json();
        if (!data.success) {
            setStatus('Erreur YAML', 'error');
            showToast(data.error || 'Erreur de conversion');
            return;
        }

        yamlOutput.value = data.crewai_yaml;
        window.lastAgentGraph = data.graph;
        if (window.updateAgentFlow) {
            window.updateAgentFlow(data.graph);
        }
        setStatus('Conversion terminee', 'success');
        showToast('CrewAI YAML pret');
    } catch (error) {
        setStatus('Erreur reseau', 'error');
        showToast('Erreur: ' + error.message);
    } finally {
        convertBtn.disabled = false;
    }
}

async function copyText(text) {
    if (!text.trim()) {
        showToast('Rien a copier');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copie');
    } catch (error) {
        showToast('Copie impossible');
    }
}

loadExampleBtn.addEventListener('click', () => {
    yamlInput.value = exampleYaml;
    setStatus('Exemple charge', 'info');
});

clearAllBtn.addEventListener('click', () => {
    yamlInput.value = '';
    yamlOutput.value = '';
    setStatus('Pret', 'info');
    if (window.updateAgentFlow) {
        window.lastAgentGraph = { nodes: [], edges: [] };
        window.updateAgentFlow(window.lastAgentGraph);
    }
});

convertBtn.addEventListener('click', convertYaml);
copyInputBtn.addEventListener('click', () => copyText(yamlInput.value));
copyOutputBtn.addEventListener('click', () => copyText(yamlOutput.value));

window.addEventListener('load', () => {
    yamlInput.value = exampleYaml;
    setStatus('Exemple charge', 'info');
});
