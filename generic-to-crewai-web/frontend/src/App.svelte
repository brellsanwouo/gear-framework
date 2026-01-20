<svelte:head>
  <title>FM Agent Studio</title>
</svelte:head>

<script>
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';

  const steps = [
    { id: 'agents', label: 'Agents' },
    { id: 'crewai', label: 'CrewAI' },
    { id: 'adk', label: 'Google ADK' },
    { id: 'visual', label: 'Visuel' }
  ];

  const baseTemplate = `# Base sur generic_FM_agent.yml
namespace: GenericAgent
AgentIdentity:
  Name: "{{name}}"
  Purpose: ""
  ContextDescription: ""
AgentType:
  SingleAgent: true
  MultiAgent:
    SequentialAgent: false
    ParallelAgent: false
    LoopAgent: false
    CustomAgent: false
LLMConfiguration:
  Model: ""
  ModelParameters:
    Temperature: 0.7
    MaxTokens: 2048
    TopP: 1
    StopSequences: []
    AdditionalParams:
      TopK: 0
      FrequencyPenalty: 0
      PresencePenalty: 0
      Seed: 0
  APIConfiguration:
    APIKey: ""
    Timeout: 60
    MaxRetries: 2
  SafetyConfiguration: {}
InstructionDefinition:
  TaskSpecification:
    TaskName: ""
    TaskDescription: ""
    ExpectedOutput: ""
    AssignedAgent: "{{name}}"
Tools:
  ToolScope:
    AgentLevelTools: false
    TaskLevelTools: false
  ToolTypes:
    FunctionBasedTools: false
    ThirdPartyIntegrations: false
    MCPTools: false
    BuiltInTools: false
    AgentAsToolReference: false
ExecutionControl:
  DelegationControl: false
  CodeExecutionControl: false
  AsyncExecutionControl: false
  HumanInteractionControl: false
  VerbosityControl: false
  CachingControl: false
MemorySystem: false
PlanningCapability:
  PlanningStrategy:
    BuiltInPlanner: false
    ReActPlanner: false
    CustomPlanner: false
  ThinkingConfiguration:
    IncludeThoughts: false
    ThinkingBudget: 0
DataFlow:
  InputDefinition:
    InputSchema: {}
    ContextSources: []
  OutputDefinition:
    OutputSchema: {}
    OutputFormat:
      FileOutput:
        CreateDirectory: false
      JSONOutput: false
      StructuredOutput: false
      MarkdownOutput: false
    OutputCallbacks: []
GuardrailsAndValidation:
  ValidationRules:
    GuardrailMaxRetries: 0
    ValidationStrategy:
      FunctionBasedValidation: false
      LLMBasedValidation: false
  LifecycleHooks:
    BeforeAgentExecution: false
    AfterAgentExecution: false
    BeforeModelCall: false
    AfterModelCall: false
    BeforeToolCall: false
    AfterToolCall: false
AgentComposition:
  SubAgents: []
  ExecutionConstraints: {}
  KnowledgeIntegration:
    IntegrationLevel:
      AgentLevel: false
      SystemLevel: false
    SupportedFormats:
      TextBased: false
      StructuredData: false
    StorageConfiguration: {}
`;

  const buildTemplate = (index) =>
    baseTemplate.replaceAll('{{name}}', `Agent ${index}`);

  let nextId = 1;
  let agents = [{ id: nextId, yaml: buildTemplate(nextId) }];
  let currentView = 0;

  const addAgent = () => {
    nextId += 1;
    agents = [...agents, { id: nextId, yaml: buildTemplate(nextId) }];
  };

  const removeAgent = (id) => {
    if (agents.length <= 1) return;
    agents = agents.filter((agent) => agent.id !== id);
  };

  const updateAgentYaml = (id, value) => {
    agents = agents.map((agent) =>
      agent.id === id ? { ...agent, yaml: value } : agent
    );
  };

  const extractField = (yaml, key) => {
    const pattern = new RegExp(`^\\s*${key}:\\s*["']?([^\\n"']+)`, 'm');
    const match = yaml.match(pattern);
    return match ? match[1].trim() : '';
  };

  const buildCrewAI = (yaml, index) => {
    const name = extractField(yaml, 'Name') || `Agent ${index}`;
    const purpose = extractField(yaml, 'Purpose') || '';
    return `# CrewAI (preview)
role: "${name}"
goal: "${purpose}"
backstory: ""
llm: "gpt-4"
tools: []
verbose: false
# TODO: connecter la conversion CrewAI
`;
  };

  const buildAdk = (yaml, index) => {
    const name = extractField(yaml, 'Name') || `Agent ${index}`;
    const purpose = extractField(yaml, 'Purpose') || '';
    return `# Google ADK (preview)
agent:
  name: "${name}"
  type: "LlmAgent"
  description: "${purpose}"
  tools: []
  model: ""
  system_instruction: ""
# TODO: connecter la conversion Google ADK
`;
  };

  const buildGraph = (items) => {
    const nodes = [
      {
        id: 'hub',
        data: { label: 'Agent Studio' },
        position: { x: 0, y: 0 },
        type: 'input'
      }
    ];
    const edges = [];
    const cols = 3;
    const spacingX = 240;
    const spacingY = 160;
    const baseY = 160;

    items.forEach((agent, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = (col - (cols - 1) / 2) * spacingX;
      const y = baseY + row * spacingY;
      const nodeId = `agent-${agent.id}`;
      nodes.push({
        id: nodeId,
        data: { label: `Agent ${index + 1}` },
        position: { x, y },
        type: 'default'
      });
      edges.push({
        id: `edge-hub-${agent.id}`,
        source: 'hub',
        target: nodeId
      });
    });

    return { nodes, edges };
  };

  $: crewaiOutputs = agents.map((agent, index) =>
    buildCrewAI(agent.yaml, index + 1)
  );
  $: adkOutputs = agents.map((agent, index) => buildAdk(agent.yaml, index + 1));
  $: graph = buildGraph(agents);
</script>

<div class="page">
  <header class="top-bar">
    <div class="brand">
      <span class="brand-mark">FM</span>
      <div>
        <div class="brand-title">Agent Studio</div>
        <div class="brand-subtitle">Espace de conception YAML</div>
      </div>
    </div>
    <nav class="steps">
      {#each steps as step, index}
        <button
          class="step {index === currentView ? 'is-active' : ''}"
          on:click={() => (currentView = index)}
        >
          <span class="step-index">0{index + 1}</span>
          {step.label}
        </button>
      {/each}
    </nav>
  </header>

  <main>
    {#if currentView === 0}
      <section class="hero">
        <div>
          <h1>Definir des agents en YAML propre</h1>
          <p>
            Chaque bloc ci-dessous est une definition YAML editable basee sur
            <span class="file-pill">generic_FM_agent.yml</span>.
          </p>
        </div>
        <div class="hero-actions">
          <button class="primary" on:click={addAgent}>
            + Nouvel agent
          </button>
          <div class="count">{agents.length} actif(s)</div>
        </div>
      </section>

      <section class="agent-grid">
        {#each agents as agent, index (agent.id)}
          <article class="agent-card" style={`--delay: ${index * 0.08}s`}>
            <header>
              <div>
                <div class="agent-label">Agent {index + 1}</div>
                <div class="agent-hint">Colle ou edite le YAML ci-dessous</div>
              </div>
              <button
                class="ghost"
                on:click={() => removeAgent(agent.id)}
                disabled={agents.length <= 1}
              >
                Retirer
              </button>
            </header>
            <textarea
              value={agent.yaml}
              spellcheck="false"
              on:input={(event) => updateAgentYaml(agent.id, event.target.value)}
            />
          </article>
        {/each}
      </section>
    {:else if currentView === 1}
      <section class="hero hero-alt">
        <div>
          <h1>Rendu CrewAI</h1>
          <p>
            Chaque agent genere un apercu CrewAI. La conversion reste a
            connecter, mais tu peux deja valider la structure.
          </p>
        </div>
        <div class="hero-actions">
          <div class="count">{agents.length} rendu(s)</div>
        </div>
      </section>

      <section class="output-grid">
        {#each crewaiOutputs as output, index}
          <article class="agent-card" style={`--delay: ${index * 0.08}s`}>
            <header>
              <div>
                <div class="agent-label">Agent {index + 1}</div>
                <div class="agent-hint">CrewAI YAML (lecture seule)</div>
              </div>
            </header>
            <textarea value={output} spellcheck="false" readonly />
          </article>
        {/each}
      </section>
    {:else if currentView === 2}
      <section class="hero hero-alt">
        <div>
          <h1>Rendu Google ADK</h1>
          <p>
            A chaque agent correspond un apercu Google ADK. La conversion sera
            branchee ensuite.
          </p>
        </div>
        <div class="hero-actions">
          <div class="count">{agents.length} rendu(s)</div>
        </div>
      </section>

      <section class="output-grid">
        {#each adkOutputs as output, index}
          <article class="agent-card" style={`--delay: ${index * 0.08}s`}>
            <header>
              <div>
                <div class="agent-label">Agent {index + 1}</div>
                <div class="agent-hint">Google ADK YAML (lecture seule)</div>
              </div>
            </header>
            <textarea value={output} spellcheck="false" readonly />
          </article>
        {/each}
      </section>
    {:else}
      <section class="hero hero-alt">
        <div>
          <h1>Visuel des agents</h1>
          <p>
            Graphe base sur les concepts React Flow (via Svelte Flow) pour
            verifier l orchestration globale.
          </p>
        </div>
        <div class="hero-actions">
          <div class="count">{agents.length} noeud(s)</div>
        </div>
      </section>

      <section class="flow-card">
        <SvelteFlow nodes={graph.nodes} edges={graph.edges} fitView={true} panOnScroll={true}>
          <Background color="#cbb8a5" gap={24} />
          <Controls position="bottom-right" />
          <MiniMap position="top-right" />
        </SvelteFlow>
      </section>
    {/if}
  </main>
</div>
