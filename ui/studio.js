(function () {
  "use strict";

  const experimentParams = new URLSearchParams(window.location.search);
  const experimentUserId = experimentParams.get("uid");
  const experimentTaskId = experimentParams.get("tid");
  const requestedExperimentFramework = String(experimentParams.get("framework") || "").toLowerCase();
  const experimentSequenceIndex = Number.parseInt(experimentParams.get("idx") || "0", 10);
  const experimentFramework = ["crewai", "adk"].includes(requestedExperimentFramework)
    ? requestedExperimentFramework
    : null;
  const experimentActive = Boolean(experimentUserId && experimentTaskId && experimentFramework);
  let experimentFrameworks = experimentFramework ? [experimentFramework] : [];
  const steps = ["agents", "modules", "workflow", "validation", "build"];
  let currentStep = "agents";
  let selectedAgent = 0;
  let selectedModule = 0;
  let saveTimer = null;
  const entityViews = { agent: "form", module: "form" };
  let validationSeverity = "all";
  let validationTarget = "all";
  let buildTarget = "crewai";
  let lastBuild = null;
  const frameworkLabels = { crewai: "CrewAI", adk: "Google ADK", langgraph: "LangGraph", "openai-agents": "OpenAI Agents SDK", "microsoft-agent-framework": "Microsoft Agent Framework", strands: "Strands Agents", "pydantic-ai": "PydanticAI", autogen: "Microsoft AutoGen", "semantic-kernel": "Semantic Kernel", haystack: "Haystack" };
  const frameworkLabel = (target) => frameworkLabels[target] || target;
  const buildsByTarget = { crewai: null, adk: null, langgraph: null, "openai-agents": null, "microsoft-agent-framework": null, strands: null, "pydantic-ai": null, autogen: null, "semantic-kernel": null, haystack: null };
  const successfulRunsByTarget = {};
  let runnerEnabled = false;
  let runnerTimeoutSeconds = 180;
  let buildBusy = false;
  let runBusy = false;
  let activeRunJobId = null;
  const DEFAULT_MODEL_POLICY = Object.freeze({ locked: false, provider: "openai", model: "gpt-5.1-codex-mini" });
  let modelPolicy = { ...DEFAULT_MODEL_POLICY };
  let modelDefaults = { provider: DEFAULT_MODEL_POLICY.provider, model: DEFAULT_MODEL_POLICY.model };
  let starterTemplates = [];
  let selectedStarterTemplate = "minimal";
  const PROVIDER_MODELS = { openai: "gpt-5.1-codex-mini", google: "gemini-2.5-flash", anthropic: "claude-sonnet-4-5" };

  const defaultAgent = (index) => `GearAgent:\n  AgentIdentity:\n    Name: Agent${index}\n    Purpose: Describe this agent's objective.\n    ContextDescription: Describe the agent's working context.\n  LLMConfiguration:\n    Provider: ${modelPolicy.locked?modelPolicy.provider:modelDefaults.provider}\n    Model: ${modelPolicy.locked?modelPolicy.model:modelDefaults.model}\n  TaskSpecification:\n    TaskName: Task${index}\n    TaskDescription: Describe the task.\n    ExpectedOutput: Describe the expected output.\n`;
  const defaultModule = (index) => `GearModule:\n  ModuleName: Module ${index}\n  Strategy:\n    Parallel:\n      ParallelAgents: []\n`;
  const defaultWorkflow = `GearMultiAgent:\n  WorkflowName: MainWorkflow\n  Items:\n    Agents: []\n    Modules: []\n  Edges: []\n`;

  const loadProject = () => ({
    schema_version: "1.0",
    agents: [],
    modules: [],
    workflows: [defaultWorkflow]
  });
  let project = loadProject();

  const parse = (text) => {
    try { return { value: window.jsyaml.load(text) || {}, error: null }; }
    catch (error) { return { value: {}, error: error.message }; }
  };
  const root = (value, names) => {
    for (const name of names) if (value?.[name] && typeof value[name] === "object") return value[name];
    return value || {};
  };
  const agentData = (text) => root(parse(text).value, ["GearAgent"]);
  const moduleData = (text) => root(parse(text).value, ["GearModule"]);
  const workflowData = () => root(parse(project.workflows[0] || defaultWorkflow).value, ["GearMultiAgent", "GearWorkflow"]);
  const orderedWorkflowItems = (workflow = workflowData()) => window.GearWorkflowOrder?.read(workflow) || [];
  const agentName = (text, index) => agentData(text)?.AgentIdentity?.Name || `Agent ${index + 1}`;
  const moduleName = (text, index) => moduleData(text)?.ModuleName || `Module ${index + 1}`;

  const updateLineNumbers = (kind, text) => {
    const element = document.getElementById(`${kind}LineNumbers`);
    if (!element) return;
    const count = Math.max(1, String(text || "").split("\n").length);
    element.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
  };

  const hasExtraKeys = (value, allowed) => value && typeof value === "object" && Object.keys(value).some((key) => !allowed.includes(key));
  const setFieldValue = (id, value) => { const field=document.getElementById(id);if(field)field.value=value??""; };
  const setEntityView = (kind, view) => {
    entityViews[kind] = view;
    document.getElementById(`${kind}Form`).hidden = view !== "form";
    document.getElementById(`${kind}YamlView`).hidden = view !== "yaml";
    document.querySelectorAll(`[data-entity-view][data-kind="${kind}"]`).forEach((button) => button.classList.toggle("is-active", button.dataset.entityView === view));
  };

  const agentHasAdvancedProperties = (data) => hasExtraKeys(data,["AgentIdentity","LLMConfiguration","TaskSpecification"]) || hasExtraKeys(data?.AgentIdentity,["Name","Purpose","ContextDescription"]) || hasExtraKeys(data?.LLMConfiguration,["Provider","Model"]) || hasExtraKeys(data?.TaskSpecification,["TaskName","TaskDescription","ExpectedOutput"]);
  const moduleHasAdvancedProperties = (data) => {
    const strategy=data?.Strategy || {};const active=strategy.Parallel || strategy.Loop || {};
    const allowedActive=strategy.Parallel?["ParallelAgents"]:["LoopAgents","TurnCount","StopCondition"];
    return hasExtraKeys(data,["ModuleName","Strategy"]) || hasExtraKeys(strategy,["Parallel","Loop"]) || hasExtraKeys(active,allowedActive);
  };

  const populateAgentForm = (text, enabled) => {
    const parsed=parse(text);const data=parsed.error?{}:agentData(text);const form=document.getElementById("agentForm");
    setFieldValue("agentFieldName",data?.AgentIdentity?.Name);setFieldValue("agentFieldPurpose",data?.AgentIdentity?.Purpose);setFieldValue("agentFieldContext",data?.AgentIdentity?.ContextDescription);setFieldValue("agentFieldProvider",data?.LLMConfiguration?.Provider ?? (modelPolicy.locked?modelPolicy.provider:modelDefaults.provider));setFieldValue("agentFieldModel",data?.LLMConfiguration?.Model ?? (modelPolicy.locked?modelPolicy.model:modelDefaults.model));setFieldValue("agentFieldTaskName",data?.TaskSpecification?.TaskName);setFieldValue("agentFieldTaskDescription",data?.TaskSpecification?.TaskDescription);setFieldValue("agentFieldExpectedOutput",data?.TaskSpecification?.ExpectedOutput);
    const unavailable=!enabled||Boolean(parsed.error);form.classList.toggle("is-disabled",unavailable);form.querySelectorAll("input,textarea").forEach((field)=>{field.disabled=unavailable;});document.getElementById("agentFieldProvider").disabled=unavailable||modelPolicy.locked;document.getElementById("agentFieldModel").disabled=unavailable||modelPolicy.locked;const policy=document.getElementById("agentModelPolicy");policy.classList.toggle("is-locked",modelPolicy.locked);policy.textContent=modelPolicy.locked?`Locked by .env · ${modelPolicy.provider}/${modelPolicy.model}`:"Editable for this agent";document.getElementById("agentAdvancedNote").hidden=!agentHasAdvancedProperties(data);
  };

  const populateModuleForm = (text, enabled) => {
    const parsed=parse(text);const data=parsed.error?{}:moduleData(text);const parallel=Boolean(data?.Strategy?.Parallel);const loop=Boolean(data?.Strategy?.Loop);const form=document.getElementById("moduleForm");
    setFieldValue("moduleFieldName",data?.ModuleName);document.getElementById("moduleStrategyParallel").checked=parallel||!loop;document.getElementById("moduleStrategyLoop").checked=loop;setFieldValue("moduleFieldTurnCount",data?.Strategy?.Loop?.TurnCount ?? 1);setFieldValue("moduleFieldStopCondition",data?.Strategy?.Loop?.StopCondition);document.getElementById("moduleLoopOptions").hidden=!loop;
    const rawSelectedAgents=parallel?data?.Strategy?.Parallel?.ParallelAgents:loop?data?.Strategy?.Loop?.LoopAgents:[];const selectedAgents=Array.isArray(rawSelectedAgents)?rawSelectedAgents:[];const picker=document.getElementById("moduleAgentPicker");picker.replaceChildren();
    if(!project.agents.length){const empty=document.createElement("p");empty.className="agent-picker-empty";empty.textContent="Create an agent first.";picker.appendChild(empty);}project.agents.forEach((agent,index)=>{const name=agentName(agent,index);const label=document.createElement("label");label.className="agent-option";const input=document.createElement("input");input.type="checkbox";input.value=name;input.checked=selectedAgents.includes(name);input.disabled=!enabled||Boolean(parsed.error);const span=document.createElement("span");span.textContent=name;label.append(input,span);picker.appendChild(label);});
    form.classList.toggle("is-disabled",!enabled||Boolean(parsed.error));form.querySelectorAll("input,textarea").forEach((field)=>{field.disabled=!enabled||Boolean(parsed.error);});document.getElementById("moduleAdvancedNote").hidden=!moduleHasAdvancedProperties(data);
  };

  const dumpDocument = (source) => window.jsyaml.dump(source,{noRefs:true,lineWidth:-1,sortKeys:false});
  const applyAgentModelPolicy = (text) => {
    if(!modelPolicy.locked)return text;const parsed=parse(text);if(parsed.error)return text;const source=parsed.value&&typeof parsed.value==="object"?parsed.value:{};const data=source.GearAgent&&typeof source.GearAgent==="object"?source.GearAgent:source;const current=data.LLMConfiguration||{};if(current.Provider===modelPolicy.provider&&current.Model===modelPolicy.model)return text;data.LLMConfiguration={...current,Provider:modelPolicy.provider,Model:modelPolicy.model};return dumpDocument(source);
  };
  const refreshEditedEntity = (kind, text, index) => {
    const editor=document.getElementById(`${kind}Editor`);editor.value=text;updateLineNumbers(kind,text);const name=kind==="agent"?agentName(text,index):moduleName(text,index);document.getElementById(`${kind}EditorTitle`).textContent=name;const selected=document.querySelector(`#${kind}List .entity-card.is-selected`);if(selected){selected.querySelector("strong").textContent=name;const data=kind==="agent"?agentData(text):moduleData(text);selected.querySelector("small").textContent=kind==="agent"?(data?.TaskSpecification?.TaskName||"Task required"):(data?.Strategy?.Parallel?"Parallel":data?.Strategy?.Loop?"Loop":"Strategy required");}document.getElementById(`${kind}EditorError`).textContent=parse(text).error||"";scheduleSave();renderHealth(validation());
  };

  const updateAgentFromForm = () => {
    if(!project.agents.length)return;const parsed=parse(project.agents[selectedAgent]);if(parsed.error)return;const source=parsed.value&&typeof parsed.value==="object"?parsed.value:{};const data=source.GearAgent&&typeof source.GearAgent==="object"?source.GearAgent:source;
    data.AgentIdentity={...(data.AgentIdentity||{}),Name:document.getElementById("agentFieldName").value,Purpose:document.getElementById("agentFieldPurpose").value,ContextDescription:document.getElementById("agentFieldContext").value};data.LLMConfiguration={...(data.LLMConfiguration||{}),Provider:modelPolicy.locked?modelPolicy.provider:document.getElementById("agentFieldProvider").value.trim(),Model:modelPolicy.locked?modelPolicy.model:document.getElementById("agentFieldModel").value.trim()};data.TaskSpecification={...(data.TaskSpecification||{}),TaskName:document.getElementById("agentFieldTaskName").value,TaskDescription:document.getElementById("agentFieldTaskDescription").value,ExpectedOutput:document.getElementById("agentFieldExpectedOutput").value};
    const text=dumpDocument(source);project.agents[selectedAgent]=text;refreshEditedEntity("agent",text,selectedAgent);document.getElementById("agentAdvancedNote").hidden=!agentHasAdvancedProperties(data);
  };

  const updateModuleFromForm = () => {
    if(!project.modules.length)return;const parsed=parse(project.modules[selectedModule]);if(parsed.error)return;const source=parsed.value&&typeof parsed.value==="object"?parsed.value:{};const data=source.GearModule&&typeof source.GearModule==="object"?source.GearModule:source;const strategy=document.getElementById("moduleStrategyLoop").checked?"Loop":"Parallel";const selected=[...document.querySelectorAll("#moduleAgentPicker input:checked")].map((input)=>input.value);data.ModuleName=document.getElementById("moduleFieldName").value;data.Strategy=data.Strategy&&typeof data.Strategy==="object"?data.Strategy:{};
    if(strategy==="Parallel"){data.Strategy.Parallel={...(data.Strategy.Parallel||{}),ParallelAgents:selected};delete data.Strategy.Loop;}else{const turnCount=Number.parseInt(document.getElementById("moduleFieldTurnCount").value,10);const stopCondition=document.getElementById("moduleFieldStopCondition").value.trim();data.Strategy.Loop={...(data.Strategy.Loop||{}),LoopAgents:selected,StopCondition:stopCondition};if(Number.isFinite(turnCount))data.Strategy.Loop.TurnCount=turnCount;else delete data.Strategy.Loop.TurnCount;delete data.Strategy.Parallel;}
    const text=dumpDocument(source);project.modules[selectedModule]=text;refreshEditedEntity("module",text,selectedModule);document.getElementById("moduleLoopOptions").hidden=strategy!=="Loop";document.getElementById("moduleAdvancedNote").hidden=!moduleHasAdvancedProperties(data);
  };

  const save = () => {
    // Experiment projects remain in memory only. They are persisted in task_logs
    // when the participant confirms the task, never in browser localStorage.
    invalidateBuild();
  };
  const invalidateBuild = () => {Object.keys(successfulRunsByTarget).forEach((target)=>{successfulRunsByTarget[target]=false;});if(!Object.values(buildsByTarget).some(Boolean)||buildBusy){refreshFrameworkControls();refreshStepLinks();return;}Object.keys(buildsByTarget).forEach((target)=>{buildsByTarget[target]=null;setFrameworkStatus(target,"","Project changed · regenerate code");});lastBuild=null;document.getElementById("buildOutputCard").hidden=true;refreshFrameworkControls();refreshStepLinks();};
  const scheduleSave = () => { invalidateBuild();clearTimeout(saveTimer); saveTimer = setTimeout(save, 180); };
  const toast = (message) => {
    const element = document.getElementById("studioToast");
    element.textContent = message; element.classList.add("is-visible");
    setTimeout(() => element.classList.remove("is-visible"), 2600);
  };
  const readApiResponse = async (response) => {
    const body=await response.text();
    try{return body?JSON.parse(body):{};}catch(error){
      const gateway=[502,503,504].includes(response.status);const detail=gateway?"The execution gateway interrupted the request.":"The server returned a non-JSON response.";
      throw new Error(`${detail} (HTTP ${response.status || "unknown"})`);
    }
  };
  const waitForRun = async (jobId) => {
    activeRunJobId=jobId;
    const deadline=Date.now()+(runnerTimeoutSeconds+30)*1000;
    try {
      while(Date.now()<deadline){
        const response=await fetch(`/api/run/jobs/${encodeURIComponent(jobId)}`);const result=await readApiResponse(response);
        if(response.status===202){await new Promise((resolve)=>setTimeout(resolve,1000));continue;}
        if(!response.ok)throw new Error(result.error||"Execution failed.");
        return result;
      }
      throw new Error("Execution status timed out. Check the saved execution history.");
    } finally {
      if(activeRunJobId===jobId)activeRunJobId=null;
    }
  };
  const cancelStudioRun = async () => {
    if(!activeRunJobId)return;
    const jobId=activeRunJobId;
    const response=await fetch(`/api/run/jobs/${encodeURIComponent(jobId)}`,{method:"DELETE",headers:{Accept:"application/json"}});
    if(!response.ok&&response.status!==404){const result=await readApiResponse(response);throw new Error(result.error||"Unable to stop the execution.");}
  };
  window.isStudioExecutionRunning=()=>Boolean(activeRunJobId||runBusy);
  window.stopStudioExecution=()=>cancelStudioRun();

  const artifactText = (value) => typeof value === "string" ? value : window.jsyaml.dump(value,{noRefs:true,lineWidth:-1,sortKeys:false});
  const setBuildOutput = (view) => {const code=view==="code";document.getElementById("codeOutputPanel").hidden=!code;document.getElementById("consoleOutputPanel").hidden=code;document.getElementById("pythonActions").hidden=!code;document.getElementById("executionActions").hidden=code;document.querySelectorAll("[data-build-output]").forEach((button)=>{const active=button.dataset.buildOutput===view;button.classList.toggle("is-active",active);button.setAttribute("aria-selected",String(active));});};
  const renderBuildArtifacts = () => {
    const value=lastBuild?.outputs?.orchestration;const available=typeof value==="string"&&Boolean(value.trim());document.getElementById("copyArtifact").disabled=!available;document.querySelector("#artifactPreview code").textContent=available?value:"Generate framework code to preview it.";document.getElementById("pythonArtifactMeta").textContent=available?`${frameworkLabel(lastBuild.target)} · gear-${lastBuild.target}.py · build ${lastBuild.build_id.slice(0,8)}`:"The generated script will appear here.";
  };
  const setFrameworkStatus = (target,state,text) => {const status=document.querySelector(`[data-framework-status="${target}"]`);status.className=`framework-status${state?` is-${state}`:""}`;status.lastChild.textContent=text;};
  const refreshFrameworkControls = () => {const blocked=validation().some((issue)=>issue.severity==="error");document.querySelectorAll("[data-framework-action]").forEach((button)=>{const card=button.closest("[data-framework]");const target=card?.dataset.framework;const outsideExperiment=Boolean(experimentActive&&!experimentFrameworks.includes(target));const wrongRunTarget=Boolean(experimentActive&&button.dataset.frameworkAction==="run"&&target!==experimentFramework);button.disabled=outsideExperiment||wrongRunTarget||buildBusy||runBusy||blocked||(button.dataset.frameworkAction==="run"&&!runnerEnabled);button.title=wrongRunTarget?`This task must be executed with ${frameworkLabel(experimentFramework)}.`:"";});const runExecution=document.getElementById("runExecution");if(runExecution){const wrongRunTarget=Boolean(experimentActive&&buildTarget!==experimentFramework);runExecution.disabled=wrongRunTarget||buildBusy||runBusy||blocked||!runnerEnabled;runExecution.title=wrongRunTarget?`This task must be executed with ${frameworkLabel(experimentFramework)}.`:"";}};
  const selectFramework = (target) => {if(experimentActive&&!experimentFrameworks.includes(target))return;buildTarget=target;document.querySelectorAll("[data-framework]").forEach((card)=>{const selected=card.dataset.framework===target;card.classList.toggle("is-selected",selected);card.setAttribute("aria-selected",String(selected));const choice=card.querySelector(".framework-choice");choice.querySelector("span").textContent=selected?"✓":"";choice.querySelector("b").textContent=selected?"Selected":"Select";});refreshFrameworkControls();};
  const openBuildOutput = (target,view="code") => {selectFramework(target);lastBuild=buildsByTarget[target];document.getElementById("buildOutputCard").hidden=false;document.getElementById("buildOutputTitle").textContent=frameworkLabel(target);document.getElementById("buildOutputSubtitle").textContent=lastBuild?`Build ${lastBuild.build_id.slice(0,8)}`:"Output";renderBuildArtifacts();setBuildOutput(view);document.getElementById("buildOutputCard").scrollIntoView({behavior:"smooth",block:"nearest"});};
  const loadRunnerStatus = async () => {
    const notice=document.getElementById("runnerNotice");try{const response=await fetch("/api/run/status");const status=await readApiResponse(response);runnerEnabled=Boolean(status.enabled);runnerTimeoutSeconds=Number(status.timeout_seconds)||180;notice.classList.toggle("is-enabled",runnerEnabled);notice.classList.toggle("is-disabled",!runnerEnabled);notice.querySelector("p").textContent=runnerEnabled?`Local execution available · ${status.timeout_seconds}s timeout`:"Local execution disabled. Set GEAR_ENABLE_LOCAL_RUNNER=true and restart the server.";}catch(error){runnerEnabled=false;notice.classList.add("is-disabled");notice.querySelector("p").textContent="Local execution status unavailable.";}refreshFrameworkControls();
  };

  const loadGearVersion = async () => {
    const gear=document.getElementById("gearVersion");const studio=document.getElementById("studioVersion");
    try{const response=await fetch("/api/version");if(!response.ok)throw new Error("Version unavailable");const payload=await response.json();gear.textContent=`v${payload.version}`;studio.textContent=`v${payload.studio_version||payload.version}`;}
    catch(error){gear.textContent="unavailable";studio.textContent="unavailable";}
  };
  const loadStudioConfig = async () => {
    try {
      const response=await fetch("/api/studio/config");if(!response.ok)throw new Error("Studio configuration unavailable");const config=(await response.json())?.model||{};
      modelPolicy={locked:Boolean(config.locked),provider:String(config.provider||DEFAULT_MODEL_POLICY.provider).trim()||DEFAULT_MODEL_POLICY.provider,model:String(config.model||DEFAULT_MODEL_POLICY.model).trim()||DEFAULT_MODEL_POLICY.model};
      modelDefaults={provider:modelPolicy.provider,model:modelPolicy.model};
    } catch(error) {
      modelPolicy={...DEFAULT_MODEL_POLICY};modelDefaults={provider:modelPolicy.provider,model:modelPolicy.model};console.warn("Studio model policy unavailable; model fields remain editable.",error);
    }
  };
  const hasProjectContent = () => Boolean(project.agents.length || project.modules.length || orderedWorkflowItems().length);
  const projectSlug = (value) => String(value||"project").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"project";
  const stableProjectToStudio = (source) => {
    if(!source||!Array.isArray(source.agents)||!source.workflow||!Array.isArray(source.workflow.nodes))throw new Error("Invalid GEAR project format");
    const nodes=source.workflow.nodes;const nodesById=new Map(nodes.map((node)=>[String(node.id),node]));const sequence=nodes.map((node)=>({kind:node.type==="module"?"module":"agent",name:String(node.ref)}));const workflow={WorkflowName:source.workflow.name||"MainWorkflow",Memory:Boolean(source.workflow.memory),Items:{Agents:sequence.filter((item)=>item.kind==="agent").map((item)=>item.name),Modules:sequence.filter((item)=>item.kind==="module").map((item)=>item.name)},Edges:(source.workflow.edges||[]).map((edge)=>({From:String(nodesById.get(String(edge.from))?.ref||edge.from),To:String(nodesById.get(String(edge.to))?.ref||edge.to)}))};
    return {schema_version:"1.0",agents:source.agents.map((agent)=>dumpDocument({GearAgent:agent})),modules:(source.modules||[]).map((module)=>dumpDocument({GearModule:module})),workflows:[dumpDocument({GearMultiAgent:workflow})]};
  };
  const updateModelDefaultsFromProject = () => {
    if(modelPolicy.locked){modelDefaults={provider:modelPolicy.provider,model:modelPolicy.model};return;}const first=project.agents.length?agentData(project.agents[0]):null;modelDefaults={provider:String(first?.LLMConfiguration?.Provider||modelDefaults.provider),model:String(first?.LLMConfiguration?.Model||modelDefaults.model)};
  };
  const selectStarterTemplate = (templateId) => {
    selectedStarterTemplate=templateId;document.querySelectorAll(".starter-card").forEach((card)=>{const selected=card.dataset.template===templateId;card.classList.toggle("is-selected",selected);card.setAttribute("aria-pressed",String(selected));});
  };
  const renderStarterTemplates = () => {
    const grid=document.getElementById("starterTemplateGrid");grid.replaceChildren();const values=[{id:"blank",name:"Blank project",description:"Start with an empty workflow.",agents:0,modules:0},...starterTemplates];values.forEach((template)=>{const card=document.createElement("button");card.type="button";card.className="starter-card";card.dataset.template=template.id;card.setAttribute("aria-pressed","false");card.innerHTML='<span class="starter-card-icon"></span><span><strong></strong><small></small><em></em></span>';card.querySelector(".starter-card-icon").textContent=template.id==="blank"?"＋":String(template.agents);card.querySelector("strong").textContent=template.name;card.querySelector("small").textContent=template.description;card.querySelector("em").textContent=`${template.agents} agent${template.agents===1?"":"s"} · ${template.modules} module${template.modules===1?"":"s"}`;card.addEventListener("click",()=>selectStarterTemplate(template.id));grid.appendChild(card);});selectStarterTemplate(selectedStarterTemplate);
  };
  const loadStarterTemplates = async () => {
    try{const response=await fetch("/api/studio/templates");if(!response.ok)throw new Error("Starter projects unavailable");starterTemplates=(await response.json()).templates||[];}catch(error){starterTemplates=[{id:"minimal",name:"Minimal",description:"One general-purpose agent.",agents:1,modules:0}];console.warn(error);}renderStarterTemplates();
  };
  const openProjectLauncher = () => {
    const launcher=document.getElementById("projectLauncher");const resumable=hasProjectContent();const resume=document.getElementById("continueCurrentProject");resume.hidden=!resumable;document.getElementById("currentProjectSummary").textContent=`${document.getElementById("projectName").value} · ${project.agents.length} agent${project.agents.length===1?"":"s"}`;const provider=document.getElementById("starterProvider");const model=document.getElementById("starterModel");provider.value=modelPolicy.locked?modelPolicy.provider:modelDefaults.provider;model.value=modelPolicy.locked?modelPolicy.model:modelDefaults.model;provider.disabled=modelPolicy.locked;model.disabled=modelPolicy.locked;const policy=document.getElementById("starterModelPolicy");policy.classList.toggle("is-locked",modelPolicy.locked);policy.textContent=modelPolicy.locked?`Locked by .env · ${modelPolicy.provider}/${modelPolicy.model}`:"Editable for this project";document.getElementById("starterProjectName").value=resumable?"New project":"Test project";if(!launcher.open)launcher.showModal();
  };
  const createStarterProject = async () => {
    const name=document.getElementById("starterProjectName").value.trim();if(!name){toast("Enter a project name.");document.getElementById("starterProjectName").focus();return;}if(hasProjectContent()&&!confirm("Replace the current in-memory project? Export it first if you want to keep a copy."))return;const provider=modelPolicy.locked?modelPolicy.provider:document.getElementById("starterProvider").value;const model=modelPolicy.locked?modelPolicy.model:document.getElementById("starterModel").value.trim();if(!provider||!model){toast("Select a provider and model.");return;}try{if(selectedStarterTemplate==="blank")project={schema_version:"1.0",agents:[],modules:[],workflows:[defaultWorkflow]};else{const query=new URLSearchParams({project_id:projectSlug(name),provider,model});const response=await fetch(`/api/studio/templates/${encodeURIComponent(selectedStarterTemplate)}?${query}`);const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to create the project");project=stableProjectToStudio(payload);}modelDefaults={provider,model};selectedAgent=0;selectedModule=0;currentStep="agents";document.getElementById("projectName").value=name;save();render();document.getElementById("projectLauncher").close();toast(`${name} created.`);}catch(error){toast(error.message);}
  };
  const loadExperimentContext = async () => {
    if(!experimentActive)return;
    try{
      const statusResponse=await fetch("/api/experiment/status",{headers:{Accept:"application/json"}});
      const status=await statusResponse.json();
      const configured=Array.isArray(status.frameworks)?status.frameworks.map((value)=>String(value).toLowerCase()).filter((value)=>Object.hasOwn(frameworkLabels,value)):[];
      if(statusResponse.ok&&configured.length===2&&configured.includes(experimentFramework))experimentFrameworks=[...new Set(configured)];
    }catch(error){console.warn("Unable to load the experiment framework pair",error);}
    if(experimentFrameworks.length<2){
      const fallback=experimentFramework==="crewai"?"adk":"crewai";
      experimentFrameworks=[experimentFramework,fallback];
    }
    buildTarget=experimentFramework;
    validationTarget=experimentFramework;
    selectFramework(experimentFramework);
    const validationSelect=document.getElementById("validationTarget");
    if(validationSelect){validationSelect.value=experimentFramework;validationSelect.disabled=true;validationSelect.title="The target framework is assigned by the experiment.";}
    document.querySelectorAll("[data-framework]").forEach((card)=>{
      const target=card.dataset.framework;
      card.hidden=!experimentFrameworks.includes(target);
      card.classList.toggle("is-experiment-target",target===experimentFramework);
      card.title=target===experimentFramework?"Framework assigned to the current experiment task":"Second framework selected for this experiment";
    });
    document.getElementById("projectName").value=`${experimentTaskId}-${experimentFramework}`;
    const query=new URLSearchParams({user_id:experimentUserId,task_id:experimentTaskId,framework:experimentFramework,sequence_index:Number.isFinite(experimentSequenceIndex)?String(experimentSequenceIndex):""});
    try{
      const response=await fetch(`/api/experiment/task_seed?${query.toString()}`,{headers:{Accept:"application/json"}});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Unable to load the previous solution.");
      if(payload.submission){
        const imported=JSON.parse(payload.submission);
        if(!imported||!Array.isArray(imported.agents))throw new Error("The saved Gear project is invalid.");
        project={schema_version:imported.schema_version||"1.0",agents:imported.agents,modules:imported.modules||[],workflows:imported.workflows||[defaultWorkflow]};
        selectedAgent=0;selectedModule=0;currentStep="agents";
        toast(`Previous ${frameworkLabel(payload.source_framework)} solution loaded for translation.`);
      }
    }catch(error){console.warn("Unable to preload the previous Gear task submission",error);toast("The previous solution could not be loaded; starting from an empty project.");}
  };
  const studioBuildPayload = (target) => ({project_id:(document.getElementById("projectName").value||"studio-project").trim(),project_name:document.getElementById("projectName").value,target,agents:project.agents,modules:project.modules,workflows:project.workflows,workflow_sequence:orderedWorkflowItems().map(({kind,name})=>({kind,name}))});
  window.getExperimentSubmission = () => JSON.stringify({ schema_version: project.schema_version || "1.0", agents: project.agents, modules: project.modules, workflows: project.workflows });
  const createStudioBuild = async (target=buildTarget,show=true) => {
    if(experimentActive&&!experimentFrameworks.includes(target)){toast("Select one of the two experiment frameworks.");return null;}
    if(buildBusy)return null;const errors=validation().filter((issue)=>issue.severity==="error");if(errors.length){currentStep="validation";render();toast("Fix blocking errors before generating code.");return null;}
    buildBusy=true;setFrameworkStatus(target,"building","Generating…");refreshFrameworkControls();
    try{const response=await fetch("/api/studio/builds",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(studioBuildPayload(target))});const result=await response.json();if(!response.ok)throw new Error([result.error,...(result.details||[])].filter(Boolean).join("\n"));buildsByTarget[target]=result;lastBuild=result;setFrameworkStatus(target,"ready",`Code ready · ${result.duration_ms} ms`);if(show)openBuildOutput(target,"code");toast(`${frameworkLabel(target)} code generated.`);await renderHistory();return result;}catch(error){setFrameworkStatus(target,"failed","Generation failed");toast(error.message);return null;}finally{buildBusy=false;refreshFrameworkControls();}
  };
  const runStudioBuild = async (target=buildTarget) => {
    if(experimentActive&&target!==experimentFramework){toast(`This task must be executed with ${frameworkLabel(experimentFramework)}.`);return;}
    if(runBusy)return;if(!runnerEnabled){toast("Local execution is disabled.");return;}const build=buildsByTarget[target]||await createStudioBuild(target,false);if(!build)return;const code=build.outputs?.orchestration;if(typeof code!=="string"||!code.trim()){toast("This build contains no executable workflow.");return;}
    lastBuild=build;openBuildOutput(target,"console");runBusy=true;refreshFrameworkControls();setFrameworkStatus(target,"building","Running…");const consoleElement=document.getElementById("executionConsole");consoleElement.classList.remove("has-error");consoleElement.querySelector("code").textContent="Workflow execution in progress…";document.getElementById("executionMeta").textContent=`Build ${build.build_id.slice(0,8)} · ${target}`;
    try{const experimentContext=typeof window.getExperimentRunContext==="function"?await window.getExperimentRunContext():null;const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({target,build_id:build.build_id,async:true,experiment_context:experimentContext})});let result=await readApiResponse(response);if(response.status===202)result=await waitForRun(result.job_id);else if(!response.ok)throw new Error(result.error||"Execution failed.");const succeeded=result.returncode===0;successfulRunsByTarget[target]=succeeded;const sections=[];if(result.stdout)sections.push(`OUTPUT\n${result.stdout.trimEnd()}`);if(result.stderr)sections.push(`ERRORS\n${result.stderr.trimEnd()}`);if(!sections.length)sections.push("Execution completed without output.");consoleElement.querySelector("code").textContent=sections.join("\n\n");consoleElement.classList.toggle("has-error",!succeeded);document.getElementById("executionMeta").textContent=`${succeeded?"Completed":"Failed"} · code ${result.returncode}${result.trace_id?` · trace ${result.trace_id}`:""}`;setFrameworkStatus(target,succeeded?"ready":"failed",succeeded?"Last execution succeeded":"Last execution failed");toast(succeeded?"Execution completed.":"The workflow returned an error.");await renderHistory();}catch(error){successfulRunsByTarget[target]=false;const message=error?.message||"Execution failed.";consoleElement.querySelector("code").textContent=message;consoleElement.classList.add("has-error");document.getElementById("executionMeta").textContent="Execution not started";setFrameworkStatus(target,"failed","Execution not started");toast(message);}finally{runBusy=false;refreshFrameworkControls();render();}
  };
  const downloadStudioScript = (build) => {const value=build?.outputs?.orchestration;if(typeof value!=="string")return;const blob=new Blob([value.endsWith("\n")?value:`${value}\n`],{type:"text/x-python"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`gear-${build.target}.py`;link.click();URL.revokeObjectURL(url);toast(`gear-${build.target}.py downloaded.`);};

  const validation = () => {
    const issues=[];const seen=new Set();
    const add=(issue)=>{const normalized={severity:"error",area:"Project",code:"GEAR-VALIDATION",path:"",step:"validation",...issue};const key=`${normalized.code}|${normalized.path}|${normalized.message}`;if(!seen.has(key)){seen.add(key);issues.push(normalized);}};
    const agents=project.agents.map(agentName);const modules=project.modules.map(moduleName);const parsedAgents=[];const parsedModules=[];let syntaxValid=true;
    if(!project.agents.length)add({severity:"error",area:"Agents",code:"GEAR-AGENTS-EMPTY",message:"Create at least one agent.",step:"agents"});
    project.agents.forEach((text,index)=>{
      const parsed=parse(text);const data=agentData(text);parsedAgents.push(data);const area=agentName(text,index);const base={area,step:"agents",entityKind:"agent",entityIndex:index};
      if(parsed.error){syntaxValid=false;add({...base,severity:"error",code:"GEAR-AGENT-YAML",path:`agents[${index}]`,message:parsed.error,view:"yaml"});return;}
      if(!String(data?.AgentIdentity?.Name||"").trim())add({...base,code:"GEAR-AGENT-NAME",path:`agents[${index}].AgentIdentity.Name`,message:"Agent name is required.",fieldId:"agentFieldName"});
      if(!String(data?.AgentIdentity?.Purpose||"").trim())add({...base,code:"GEAR-AGENT-PURPOSE",path:`agents[${index}].AgentIdentity.Purpose`,message:"Agent purpose is required.",fieldId:"agentFieldPurpose"});
      if(!String(data?.AgentIdentity?.ContextDescription||"").trim())add({...base,code:"GEAR-AGENT-CONTEXT",path:`agents[${index}].AgentIdentity.ContextDescription`,message:"Agent context is required.",fieldId:"agentFieldContext"});
      const provider=String(data?.LLMConfiguration?.Provider||"").trim();const model=String(data?.LLMConfiguration?.Model||"").trim();
      if(!provider)add({...base,code:"GEAR-AGENT-PROVIDER",path:`agents[${index}].LLMConfiguration.Provider`,message:"Model provider is required.",fieldId:"agentFieldProvider"});
      if(!model)add({...base,code:"GEAR-AGENT-MODEL",path:`agents[${index}].LLMConfiguration.Model`,message:"Model name is required.",fieldId:"agentFieldModel"});
      if(modelPolicy.locked&&(provider!==modelPolicy.provider||model!==modelPolicy.model))add({...base,code:"GEAR-AGENT-MODEL-POLICY",path:`agents[${index}].LLMConfiguration.Model`,message:`The server locks agents to ${modelPolicy.provider}/${modelPolicy.model}.`,fieldId:"agentFieldModel"});
      if(!String(data?.TaskSpecification?.TaskName||"").trim())add({...base,code:"GEAR-AGENT-TASK-NAME",path:`agents[${index}].TaskSpecification.TaskName`,message:"Task name is required.",fieldId:"agentFieldTaskName"});
      if(!String(data?.TaskSpecification?.TaskDescription||"").trim())add({...base,code:"GEAR-AGENT-TASK-DESCRIPTION",path:`agents[${index}].TaskSpecification.TaskDescription`,message:"Task instruction is required.",fieldId:"agentFieldTaskDescription"});
      if(!String(data?.TaskSpecification?.ExpectedOutput||"").trim())add({...base,code:"GEAR-AGENT-EXPECTED-OUTPUT",path:`agents[${index}].TaskSpecification.ExpectedOutput`,message:"Expected output is required.",fieldId:"agentFieldExpectedOutput"});
    });
    const workflowParsed=parse(project.workflows[0]||"");const workflow=workflowData();if(workflowParsed.error){syntaxValid=false;add({severity:"error",area:"Workflow",code:"GEAR-WORKFLOW-YAML",path:"workflow",message:workflowParsed.error,step:"workflow",view:"yaml"});}
    const refsAgents=Array.isArray(workflow?.Items?.Agents)?workflow.Items.Agents:[];const refsModules=Array.isArray(workflow?.Items?.Modules)?workflow.Items.Modules:[];const usedModules=new Set(refsModules);
    project.modules.forEach((text,index)=>{
      const parsed=parse(text);const data=moduleData(text);parsedModules.push(data);const area=moduleName(text,index);const base={area,step:"modules",entityKind:"module",entityIndex:index};
      if(parsed.error){syntaxValid=false;add({...base,code:"GEAR-MODULE-YAML",path:`modules[${index}]`,message:parsed.error,view:"yaml"});return;}
      if(!String(data?.ModuleName||"").trim())add({...base,code:"GEAR-MODULE-NAME",path:`modules[${index}].ModuleName`,message:"Module name is required.",fieldId:"moduleFieldName"});
      const hasParallel=Boolean(data?.Strategy?.Parallel);const hasLoop=Boolean(data?.Strategy?.Loop);
      if(hasParallel===hasLoop)add({...base,code:"GEAR-MODULE-STRATEGY",path:`modules[${index}].Strategy`,message:hasParallel?"A module cannot use Parallel and Loop at the same time.":"Select a Parallel or Loop strategy.",fieldId:"moduleStrategyParallel"});
      const participants=hasParallel?data.Strategy.Parallel.ParallelAgents:hasLoop?data.Strategy.Loop.LoopAgents:[];const participantList=Array.isArray(participants)?participants:[];
      if((hasParallel||hasLoop)&&!participantList.length)add({...base,code:"GEAR-MODULE-EMPTY",path:`modules[${index}].Strategy`,message:"Select at least one participating agent.",fieldId:"moduleAgentPicker"});
      participantList.filter((name)=>!agents.includes(name)).forEach((name)=>add({...base,code:"GEAR-MODULE-UNKNOWN-AGENT",path:`modules[${index}].Strategy`,message:`Agent “${name}” does not exist in the project.`,fieldId:"moduleAgentPicker"}));
      if(hasLoop){const count=Number(data.Strategy.Loop.TurnCount);if(!Number.isInteger(count)||count<1)add({...base,code:"GEAR-MODULE-TURN-COUNT",path:`modules[${index}].Strategy.Loop.TurnCount`,message:"Iteration count must be an integer greater than or equal to 1.",fieldId:"moduleFieldTurnCount"});if(!String(data.Strategy.Loop.StopCondition||"").trim())add({...base,code:"GEAR-MODULE-STOP-CONDITION",path:`modules[${index}].Strategy.Loop.StopCondition`,message:"Loop stop condition is required.",fieldId:"moduleFieldStopCondition"});}
    });
    const duplicates=(values,kind,step)=>values.forEach((value,index)=>{if(value&&values.indexOf(value)!==index)add({severity:"error",area:value,code:`GEAR-${kind.toUpperCase()}-DUPLICATE`,path:`${kind}s[${index}]`,message:`Identifier “${value}” is used more than once.`,step,entityKind:kind,entityIndex:index});});duplicates(agents,"agent","agents");duplicates(modules,"module","modules");
    if(!workflowParsed.error){if(!String(workflow?.WorkflowName||"").trim())add({severity:"warning",area:"Workflow",code:"GEAR-WORKFLOW-NAME",path:"workflow.WorkflowName",message:"Add a workflow name.",step:"workflow",view:"yaml"});refsAgents.filter((name)=>!agents.includes(name)).forEach((name)=>add({area:"Workflow",code:"GEAR-WORKFLOW-UNKNOWN-AGENT",path:"workflow.Items.Agents",message:`Agent “${name}” does not exist in the project.`,step:"workflow"}));refsModules.filter((name)=>!modules.includes(name)).forEach((name)=>add({area:"Workflow",code:"GEAR-WORKFLOW-UNKNOWN-MODULE",path:"workflow.Items.Modules",message:`Module “${name}” does not exist in the project.`,step:"workflow"}));if(!refsAgents.length&&!refsModules.length)add({severity:"error",area:"Workflow",code:"GEAR-WORKFLOW-EMPTY",path:"workflow.Items",message:"Add at least one agent or module to the workflow.",step:"workflow"});}
    if(syntaxValid&&window.GearConversionCore?.buildGearIR){const ir=window.GearConversionCore.buildGearIR({gearAgents:parsedAgents,gearModules:parsedModules,workflowYaml:workflow});const supported=new Set(["GEAR-WORKFLOW-CYCLE","GEAR-WORKFLOW-UNKNOWN-EDGE","GEAR-WORKFLOW-AMBIGUOUS-EDGE","GEAR-WORKFLOW-DEFAULT-ORDER","GEAR-MODULE-UNKNOWN-AGGREGATOR"]);ir.diagnostics.filter((item)=>supported.has(item.code)).forEach((item)=>{const messages={"GEAR-WORKFLOW-CYCLE":"The workflow contains a cycle outside a Loop module.","GEAR-WORKFLOW-UNKNOWN-EDGE":"A workflow edge references an unknown step.","GEAR-WORKFLOW-AMBIGUOUS-EDGE":"A workflow edge is ambiguous; use a unique step identifier.","GEAR-WORKFLOW-DEFAULT-ORDER":"No explicit edges: the displayed order will run sequentially.","GEAR-MODULE-UNKNOWN-AGGREGATOR":"A module references an unknown aggregator agent."};add({severity:item.severity,area:item.code.startsWith("GEAR-MODULE")?"Modules":"Workflow",code:item.code,path:item.path,message:messages[item.code]||item.message,step:item.code.startsWith("GEAR-MODULE")?"modules":"workflow",view:"yaml"});});}
    refsModules.filter((name)=>modules.includes(name)).forEach((name)=>add({severity:"warning",area:name,code:"GEAR-CREWAI-MODULE-ADAPTATION",path:"workflow.Items.Modules",message:"CrewAI will adapt this module; parallel or loop semantics may be partially lost.",step:"build",target:"crewai"}));
    return issues;
  };

  const blockingIssuesForStep = (step) => {
    const errors=validation().filter((issue)=>issue.severity==="error");
    return step==="validation"||step==="build"?errors:errors.filter((issue)=>issue.step===step);
  };
  const stepRequirement = (step) => {
    const blockers=blockingIssuesForStep(step);
    if(blockers.length)return {ready:false,message:step==="validation"?"Resolve all blocking errors before continuing.":blockers[0].message};
    if(step==="build"&&experimentActive){
      if(!buildsByTarget[experimentFramework])return {ready:false,message:`Generate the ${frameworkLabel(experimentFramework)} code before finishing.`};
      if(!successfulRunsByTarget[experimentFramework])return {ready:false,message:`Run the ${frameworkLabel(experimentFramework)} workflow successfully before finishing.`};
    }
    return {ready:true,message:""};
  };
  const canOpenStep = (targetStep) => {
    if(!experimentActive)return {ready:true,message:""};
    const targetIndex=steps.indexOf(targetStep);
    for(let index=0;index<targetIndex;index+=1){
      const requirement=stepRequirement(steps[index]);
      if(!requirement.ready)return requirement;
    }
    return {ready:true,message:""};
  };
  const refreshStepLinks = () => {
    document.querySelectorAll("[data-step-link]").forEach((link)=>{
      const access=canOpenStep(link.dataset.stepLink);
      link.classList.toggle("is-locked",!access.ready);
      link.setAttribute("aria-disabled",String(!access.ready));
      link.title=access.ready?"":access.message;
    });
  };
  window.getExperimentCompletionState = () => {
    if(!experimentActive)return {ready:true,message:""};
    const requirement=stepRequirement("build");
    return {...requirement,framework:experimentFramework,frameworks:[...experimentFrameworks]};
  };

  const entityCard = (kind, text, index, selected) => {
    const name = kind === "agent" ? agentName(text,index) : moduleName(text,index);
    const data = kind === "agent" ? agentData(text) : moduleData(text);
    const subtitle = kind === "agent" ? data?.TaskSpecification?.TaskName || "Task required" : data?.Strategy?.Parallel ? "Parallel" : data?.Strategy?.Loop ? "Loop" : "Strategy required";
    const card = document.createElement("article");
    card.className = `entity-card${selected === index ? " is-selected" : ""}`; card.tabIndex = 0;
    card.innerHTML = `<span class="entity-avatar ${kind === "module" ? "entity-avatar--module" : ""}">${kind === "agent" ? "A" : "M"}</span><div><strong></strong><small></small></div><div class="entity-menu"><button class="icon-button" type="button" aria-label="Duplicate">⧉</button><button class="icon-button" type="button" aria-label="Delete">×</button></div>`;
    card.querySelector("strong").textContent = name; card.querySelector("small").textContent = subtitle;
    const select = () => { if (kind === "agent") selectedAgent=index; else selectedModule=index; render(); };
    card.addEventListener("click", select); card.addEventListener("keydown", (event) => { if(event.key === "Enter") select(); });
    const [duplicate, remove] = card.querySelectorAll("button");
    duplicate.addEventListener("click", (event) => { event.stopPropagation(); project[`${kind}s`].splice(index+1,0,text); kind === "agent" ? selectedAgent=index+1 : selectedModule=index+1; save(); render(); });
    remove.addEventListener("click", (event) => { event.stopPropagation(); if (!confirm(`Delete ${name}?`)) return; project[`${kind}s`].splice(index,1); kind === "agent" ? selectedAgent=Math.max(0,index-1) : selectedModule=Math.max(0,index-1); save(); render(); });
    return card;
  };

  const renderEntities = (kind) => {
    const plural = `${kind}s`; const values = project[plural]; const list = document.getElementById(`${kind}List`); const selected = kind === "agent" ? selectedAgent : selectedModule;
    if(kind==="agent"){let changed=false;values.forEach((text,index)=>{const normalized=applyAgentModelPolicy(text);if(normalized!==text){values[index]=normalized;changed=true;}});if(changed)save();}
    list.replaceChildren();
    if (!values.length) { const empty=document.createElement("div");empty.className="empty-card";empty.textContent=kind === "agent" ? "No agents yet. Create one to get started." : "No modules. This step is optional.";list.appendChild(empty); }
    values.forEach((text,index) => list.appendChild(entityCard(kind,text,index,selected)));
    const editor=document.getElementById(`${kind}Editor`); const title=document.getElementById(`${kind}EditorTitle`); const error=document.getElementById(`${kind}EditorError`);
    editor.disabled=!values.length; editor.value=values[selected] || ""; title.textContent=values.length ? (kind === "agent" ? agentName(values[selected],selected) : moduleName(values[selected],selected)) : `No ${kind === "agent" ? "agent" : "module"}`;
    error.textContent=parse(editor.value).error || "";updateLineNumbers(kind,editor.value);if(kind==="agent")populateAgentForm(editor.value,Boolean(values.length));else populateModuleForm(editor.value,Boolean(values.length));setEntityView(kind,entityViews[kind]);
  };

  const changeWorkflowComponent = (kind, name, remove = false) => {
    const parsed = parse(project.workflows[0] || defaultWorkflow);
    if (parsed.error) { toast("Fix the workflow YAML before composing it."); return; }
    const source = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
    const rootKey = source.GearMultiAgent ? "GearMultiAgent" : source.GearWorkflow ? "GearWorkflow" : "GearMultiAgent";
    if (!source[rootKey] || typeof source[rootKey] !== "object") source[rootKey] = { WorkflowName: "MainWorkflow" };
    const workflow = source[rootKey];
    const values = orderedWorkflowItems(workflow);
    let sequence;
    if (remove) sequence = values.filter((item) => !(item.kind === kind && item.name === name));
    else {
      if (values.some((item) => item.kind === kind && item.name === name)) { toast(`${name} is already in the workflow.`); return; }
      sequence = [...values, {kind,name,type:kind === "agent" ? "A" : "M"}];
    }
    window.GearWorkflowOrder.write(workflow, sequence);
    project.workflows[0] = window.jsyaml.dump(source, { noRefs: true, lineWidth: -1, sortKeys: false });
    save(); render();
    toast(remove ? `${name} removed from the workflow.` : `${name} added to the workflow.`);
  };

  const renderWorkflowComponents = (usedAgents, usedModules) => {
    const library = document.getElementById("workflowComponents");library.replaceChildren();
    const groups = [
      { label: "Agents", kind: "agent", values: project.agents.map(agentName), used: usedAgents },
      { label: "Modules", kind: "module", values: project.modules.map(moduleName), used: usedModules },
    ];
    groups.forEach((group) => {
      const section=document.createElement("section");section.className="component-group";
      const heading=document.createElement("h3");heading.textContent=group.label;section.appendChild(heading);
      if (!group.values.length) { const empty=document.createElement("p");empty.className="component-empty";empty.textContent="No components created";section.appendChild(empty); }
      group.values.forEach((name) => {
        const item=document.createElement("button");item.type="button";item.className=`component-item${group.used.includes(name)?" is-used":""}`;item.draggable=true;
        item.title=name;item.innerHTML=`<span class="component-icon ${group.kind}">${group.kind==="agent"?"A":"M"}</span><strong></strong><small>${group.used.includes(name)?"✓ In workflow":"Drag or click"}</small>`;
        item.querySelector("strong").textContent=name;
        item.addEventListener("click",()=>changeWorkflowComponent(group.kind,name));
        item.addEventListener("dragstart",(event)=>{event.dataTransfer.effectAllowed="copy";event.dataTransfer.setData("application/x-gear-component",JSON.stringify({kind:group.kind,name}));});
        section.appendChild(item);
      });
      library.appendChild(section);
    });
  };

  const renderWorkflow = () => {
    const editor=document.getElementById("workflowEditor"); editor.value=project.workflows[0] || defaultWorkflow;updateLineNumbers("workflow",editor.value);
    const parsed=parse(editor.value);document.getElementById("workflowEditorError").textContent=parsed.error || "";
    const data=workflowData();const agentItems=Array.isArray(data?.Items?.Agents)?data.Items.Agents:[];const moduleItems=Array.isArray(data?.Items?.Modules)?data.Items.Modules:[];const items=orderedWorkflowItems(data);renderWorkflowComponents(agentItems,moduleItems);
    const canvas=document.getElementById("workflowCanvas");canvas.replaceChildren();
    const terminal=(label,kind)=>{const element=document.createElement("div");element.className=`flow-terminal ${kind}`;element.innerHTML=`<span></span><strong>${label}</strong>`;return element;};
    const connector=()=>{const line=document.createElement("div");line.className="workflow-line";return line;};
    canvas.appendChild(terminal("Start","start"));
    items.forEach((item)=>{canvas.appendChild(connector());const node=document.createElement("div");node.className="workflow-node";node.innerHTML=`<span>${item.type}</span><strong></strong><button type="button" aria-label="Remove from workflow">×</button>`;node.querySelector("strong").textContent=item.name;node.querySelector("button").addEventListener("click",()=>changeWorkflowComponent(item.kind,item.name,true));canvas.appendChild(node);});
    canvas.appendChild(connector());const dropzone=document.createElement("div");dropzone.className="workflow-dropzone";dropzone.innerHTML=`<span>+</span><div><strong>Add a step</strong><small>Drop an agent or module here</small></div>`;canvas.appendChild(dropzone);canvas.appendChild(connector());canvas.appendChild(terminal("End","end"));
    canvas.ondragover=(event)=>{event.preventDefault();event.dataTransfer.dropEffect="copy";canvas.classList.add("is-dragover");};
    canvas.ondragleave=()=>canvas.classList.remove("is-dragover");
    canvas.ondrop=(event)=>{event.preventDefault();canvas.classList.remove("is-dragover");try{const component=JSON.parse(event.dataTransfer.getData("application/x-gear-component"));if(component?.kind&&component?.name)changeWorkflowComponent(component.kind,component.name);}catch(error){console.warn(error);}};
    document.getElementById("workflowMode").textContent=data?.Process || "Sequential";
  };

  const openValidationIssue = (issue) => {
    currentStep=issue.step||"validation";if(issue.entityKind==="agent"&&Number.isInteger(issue.entityIndex))selectedAgent=issue.entityIndex;if(issue.entityKind==="module"&&Number.isInteger(issue.entityIndex))selectedModule=issue.entityIndex;if(issue.entityKind&&issue.view)setEntityView(issue.entityKind,issue.view);render();if(issue.step==="workflow"&&issue.view==="yaml"){document.querySelector(".workflow-grid")?.classList.remove("source-hidden");const toggle=document.getElementById("toggleWorkflowSource");if(toggle){toggle.textContent="Hide YAML";toggle.setAttribute("aria-expanded","true");}}setTimeout(()=>{const target=issue.fieldId?document.getElementById(issue.fieldId):null;if(target?.focus)target.focus();else target?.querySelector("input,button")?.focus();},0);
  };

  const renderValidation = () => {
    const issues=validation();const errors=issues.filter((item)=>item.severity==="error").length;const warnings=issues.filter((item)=>item.severity==="warning").length;const infos=issues.filter((item)=>item.severity==="info").length;
    document.getElementById("validationSummary").innerHTML=`<div class="summary-tile ${errors?"has-errors":"is-clear"}"><b>${errors}</b><span>blocking error${errors===1?"":"s"}</span></div><div class="summary-tile"><b>${warnings}</b><span>warning${warnings===1?"":"s"}</span></div><div class="summary-tile"><b>${infos}</b><span>information</span></div>`;
    document.querySelectorAll("[data-validation-severity]").forEach((button)=>button.classList.toggle("is-active",button.dataset.validationSeverity===validationSeverity));document.getElementById("validationTarget").value=validationTarget;
    const filtered=issues.filter((issue)=>(validationSeverity==="all"||issue.severity===validationSeverity)&&(validationTarget==="all"||!issue.target||issue.target===validationTarget));const list=document.getElementById("validationIssues");list.replaceChildren();
    if(!filtered.length){const empty=document.createElement("div");empty.className="validation-empty";empty.innerHTML=`<span>✓</span><div><strong>${issues.length?"No diagnostics for this filter":"Project ready to convert"}</strong><p>${issues.length?"Change the filters to display other results.":"Project structure, references, and workflow are consistent."}</p></div>`;list.appendChild(empty);}
    filtered.forEach((issue)=>{const row=document.createElement("article");row.className=`validation-issue severity-${issue.severity}`;row.innerHTML=`<span class="validation-severity">${issue.severity==="error"?"×":issue.severity==="warning"?"!":"i"}</span><div class="validation-issue-content"><div><strong></strong><code></code></div><p></p></div><span class="validation-target"></span><button type="button">Open</button>`;row.querySelector("strong").textContent=issue.area;row.querySelector("code").textContent=issue.code;row.querySelector("p").textContent=issue.message;const target=row.querySelector(".validation-target");target.textContent=issue.target?frameworkLabel(issue.target):"";if(!issue.target)target.hidden=true;row.querySelector("button").addEventListener("click",()=>openValidationIssue(issue));list.appendChild(row);});
    return issues;
  };

  const renderHealth = (issues) => {
    const errors=issues.filter((item)=>item.severity==="error");const warnings=issues.filter((item)=>item.severity==="warning");const health=document.getElementById("projectHealth");health.classList.toggle("has-errors",Boolean(errors.length));health.classList.toggle("has-warnings",!errors.length&&Boolean(warnings.length));health.querySelector(".health-icon").textContent=errors.length?"!":warnings.length?"△":"✓";health.querySelector("strong").textContent=errors.length?`${errors.length} error${errors.length>1?"s":""}`:warnings.length?"Project needs attention":"Project ready";health.querySelector("small").textContent=errors.length?"Fix errors before building":warnings.length?`${warnings.length} recommendation${warnings.length>1?"s":""}`:"No blocking errors";
    document.getElementById("agentCount").textContent=project.agents.length;document.getElementById("moduleCount").textContent=project.modules.length;document.getElementById("workflowCount").textContent=(workflowData()?.Items?.Agents?.length || 0)+(workflowData()?.Items?.Modules?.length || 0);document.getElementById("issueCount").textContent=errors.length;
    document.getElementById("statAgents").textContent=project.agents.length;document.getElementById("statModules").textContent=project.modules.length;document.getElementById("statWorkflow").textContent=document.getElementById("workflowCount").textContent === "0"?"Empty":"Configured";
    const quick=document.getElementById("quickIssues");quick.replaceChildren();const shown=issues.filter((issue)=>issue.severity!=="info").slice(0,3);if(!shown.length){const empty=document.createElement("p");empty.className="quick-empty";empty.textContent="Nothing to report.";quick.appendChild(empty);}shown.forEach((issue)=>{const item=document.createElement("div");item.className=`quick-issue ${issue.severity === "warning" ? "is-warning" : "is-error"}`;const content=document.createElement("div");const area=document.createElement("strong");const message=document.createElement("span");area.textContent=issue.area;message.textContent=issue.message;content.append(area,message);item.appendChild(content);quick.appendChild(item);});
  };

  const renderHistory = async () => {
    const renderRows=(element,values,kind)=>{element.replaceChildren();if(!values.length){element.innerHTML='<p class="quick-empty">No records.</p>';return;}values.slice(0,6).forEach((value)=>{const row=document.createElement("button");row.type="button";row.className="history-row";row.innerHTML="<strong></strong><small></small>";row.querySelector("strong").textContent=kind==="build"?`${value.project_id} → ${value.target}`:`${value.status} · ${value.build_id.slice(0,8)}`;row.querySelector("small").textContent=new Date(value.created_at).toLocaleString("en-US");row.addEventListener("click",async()=>{try{const response=await fetch(kind==="build"?`/api/builds/${value.id}`:`/api/logs/${value.id}`);const detail=await response.json();if(!response.ok)throw new Error(detail.error);if(kind==="build"){const build={...detail,build_id:detail.id};buildsByTarget[detail.target]=build;lastBuild=build;setFrameworkStatus(detail.target,"ready","Code loaded from history");openBuildOutput(detail.target,"code");refreshFrameworkControls();}else{const consoleElement=document.getElementById("executionConsole");const sections=[];if(detail.stdout)sections.push(`OUTPUT\n${detail.stdout.trimEnd()}`);if(detail.stderr)sections.push(`ERRORS\n${detail.stderr.trimEnd()}`);consoleElement.querySelector("code").textContent=sections.join("\n\n")||"Execution completed without output.";consoleElement.classList.toggle("has-error",detail.status!=="succeeded");document.getElementById("executionMeta").textContent=`${detail.status} · ${detail.id.slice(0,8)}${detail.trace_id?` · trace ${detail.trace_id}`:""}`;document.getElementById("buildOutputCard").hidden=false;document.getElementById("buildOutputTitle").textContent="Saved execution";document.getElementById("buildOutputSubtitle").textContent=`Build ${detail.build_id.slice(0,8)}`;setBuildOutput("console");}}catch(error){toast("Unable to load this record.");}});element.appendChild(row);});};
    try{const [builds,runs]=await Promise.all([fetch("/api/builds").then((r)=>r.json()),fetch("/api/logs").then((r)=>r.json())]);renderRows(document.getElementById("studioBuilds"),builds,"build");renderRows(document.getElementById("studioRuns"),runs,"run");}catch(error){toast("History unavailable.");}
  };

  const render = () => {
    document.querySelectorAll("[data-step-panel]").forEach((panel)=>panel.classList.toggle("is-active",panel.dataset.stepPanel===currentStep));document.querySelectorAll("[data-step-link]").forEach((link)=>link.classList.toggle("is-active",link.dataset.stepLink===currentStep));
    renderEntities("agent");renderEntities("module");renderWorkflow();const issues=renderValidation();renderHealth(issues);if(currentStep==="build")renderHistory();
    const index=steps.indexOf(currentStep);const blocked=issues.some((issue)=>issue.severity==="error");const currentBlockers=blockingIssuesForStep(currentStep);const next=document.getElementById("nextStep");
    if(index===steps.length-1){
      if(experimentActive&&!buildsByTarget[experimentFramework])next.textContent=`Generate ${frameworkLabel(experimentFramework)} code`;
      else if(experimentActive&&!successfulRunsByTarget[experimentFramework])next.textContent=`Run ${frameworkLabel(experimentFramework)} workflow`;
      else next.textContent=experimentActive?"Ready to finish":`View ${frameworkLabel(buildTarget)} code`;
    }else next.textContent="Next step →";
    next.disabled=experimentActive&&index===steps.length-1&&Boolean(successfulRunsByTarget[experimentFramework]);
    next.title=currentBlockers.length?currentBlockers[0].message:experimentActive&&index===steps.length-1&&successfulRunsByTarget[experimentFramework]?"Use Confirm & Finish to complete the task.":"";
    refreshStepLinks();
    const conversion=document.getElementById("buildConversion");conversion.classList.toggle("is-disabled",blocked);conversion.setAttribute("aria-disabled",String(blocked));conversion.title=blocked?"Fix blocking errors before conversion.":"";refreshFrameworkControls();
  };

  document.querySelectorAll("[data-step-link]").forEach((button)=>button.addEventListener("click",()=>{const access=canOpenStep(button.dataset.stepLink);if(!access.ready){toast(access.message);return;}currentStep=button.dataset.stepLink;render();window.scrollTo({top:0,behavior:"smooth"});}));
  document.querySelectorAll("[data-add]").forEach((button)=>button.addEventListener("click",()=>{const kind=button.dataset.add;const values=project[`${kind}s`];values.push(kind==="agent"?defaultAgent(values.length+1):defaultModule(values.length+1));kind==="agent"?selectedAgent=values.length-1:selectedModule=values.length-1;save();render();}));
  document.querySelectorAll("[data-entity-view]").forEach((button)=>button.addEventListener("click",()=>setEntityView(button.dataset.kind,button.dataset.entityView)));
  document.getElementById("agentForm").addEventListener("input",updateAgentFromForm);document.getElementById("moduleForm").addEventListener("input",updateModuleFromForm);
  ["agent","module"].forEach((kind)=>document.getElementById(`${kind}Editor`).addEventListener("input",(event)=>{const index=kind==="agent"?selectedAgent:selectedModule;project[`${kind}s`][index]=event.target.value;const parsed=parse(event.target.value);document.getElementById(`${kind}EditorError`).textContent=parsed.error || "";updateLineNumbers(kind,event.target.value);const name=kind==="agent"?agentName(event.target.value,index):moduleName(event.target.value,index);document.getElementById(`${kind}EditorTitle`).textContent=name;const selected=document.querySelector(`#${kind}List .entity-card.is-selected`);if(selected)selected.querySelector("strong").textContent=name;if(kind==="agent")populateAgentForm(event.target.value,true);else populateModuleForm(event.target.value,true);scheduleSave();renderHealth(validation());}));
  document.getElementById("workflowEditor").addEventListener("input",(event)=>{project.workflows[0]=event.target.value;document.getElementById("workflowEditorError").textContent=parse(event.target.value).error || "";updateLineNumbers("workflow",event.target.value);scheduleSave();renderWorkflow();renderHealth(validation());});
  ["agent","module","workflow"].forEach((kind)=>{const editor=document.getElementById(`${kind}Editor`);const lines=document.getElementById(`${kind}LineNumbers`);editor.addEventListener("scroll",()=>{lines.scrollTop=editor.scrollTop;});editor.addEventListener("keydown",(event)=>{if(event.key!=="Tab")return;event.preventDefault();const start=editor.selectionStart;editor.setRangeText("  ",start,editor.selectionEnd,"end");editor.dispatchEvent(new Event("input",{bubbles:true}));});});
  document.querySelectorAll("[data-validation-severity]").forEach((button)=>button.addEventListener("click",()=>{validationSeverity=button.dataset.validationSeverity;renderValidation();}));document.getElementById("validationTarget").addEventListener("change",(event)=>{validationTarget=event.target.value;renderValidation();});document.getElementById("refreshStudioHistory").addEventListener("click",renderHistory);
  document.querySelectorAll("[data-framework]").forEach((card)=>{const select=()=>selectFramework(card.dataset.framework);card.addEventListener("click",(event)=>{if(!event.target.closest("button"))select();});card.addEventListener("keydown",(event)=>{if(event.target!==card||!(event.key==="Enter"||event.key===" "))return;event.preventDefault();select();});});
  document.querySelectorAll("[data-framework-action]").forEach((button)=>button.addEventListener("click",async()=>{const target=button.closest("[data-framework]").dataset.framework;selectFramework(target);const action=button.dataset.frameworkAction;if(action==="code"){if(buildsByTarget[target])openBuildOutput(target,"code");else await createStudioBuild(target,true);}else if(action==="run")await runStudioBuild(target);else{const build=buildsByTarget[target]||await createStudioBuild(target,false);if(build)downloadStudioScript(build);}}));
  document.querySelectorAll("[data-build-output]").forEach((button)=>button.addEventListener("click",()=>setBuildOutput(button.dataset.buildOutput)));document.getElementById("copyArtifact").addEventListener("click",async()=>{const value=lastBuild?.outputs?.orchestration;if(typeof value!=="string")return;await navigator.clipboard.writeText(value);toast("Python code copied.");});document.getElementById("runExecution").addEventListener("click",()=>runStudioBuild(buildTarget));document.getElementById("clearExecutionConsole").addEventListener("click",()=>{document.querySelector("#executionConsole code").textContent="Console cleared.";document.getElementById("executionConsole").classList.remove("has-error");document.getElementById("executionMeta").textContent="No output displayed.";});document.getElementById("closeBuildOutput").addEventListener("click",()=>{document.getElementById("buildOutputCard").hidden=true;});document.getElementById("toggleStudioHistory").addEventListener("click",(event)=>{const content=document.getElementById("studioHistoryContent");const expanded=content.hidden;content.hidden=!expanded;event.currentTarget.setAttribute("aria-expanded",String(expanded));event.currentTarget.lastElementChild.textContent=expanded?"Hide":"Show";if(expanded)renderHistory();});
  document.getElementById("openValidation").addEventListener("click",()=>{currentStep="validation";render();});
  document.getElementById("toggleWorkflowSource").addEventListener("click",(event)=>{const grid=document.querySelector(".workflow-grid");const hidden=grid.classList.toggle("source-hidden");event.currentTarget.textContent=hidden?"Show YAML":"Hide YAML";event.currentTarget.setAttribute("aria-expanded",String(!hidden));});
  document.getElementById("nextStep").addEventListener("click",async()=>{const index=steps.indexOf(currentStep);const requirement=stepRequirement(currentStep);if(index===steps.length-1){const errors=blockingIssuesForStep("build");if(errors.length){toast("Fix blocking errors before building.");return;}if(experimentActive){if(!buildsByTarget[experimentFramework]){selectFramework(experimentFramework);await createStudioBuild(experimentFramework);return;}if(!successfulRunsByTarget[experimentFramework]){selectFramework(experimentFramework);await runStudioBuild(experimentFramework);return;}toast("The workflow is ready. Use Confirm & Finish to complete the task.");return;}createStudioBuild();return;}if(!requirement.ready){toast(requirement.message);return;}currentStep=steps[index+1];render();window.scrollTo({top:0,behavior:"smooth"});});
  document.getElementById("buildConversion").addEventListener("click",(event)=>{if(validation().some((issue)=>issue.severity==="error")){event.preventDefault();toast("Fix blocking errors before conversion.");}});
  document.getElementById("projectName").addEventListener("input",scheduleSave);
  document.getElementById("exportButton").addEventListener("click",()=>{save();const payload={...project,project:{name:document.getElementById("projectName").value}};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="gear-studio-project.gear.json";link.click();URL.revokeObjectURL(url);toast("Project exported.");});
  document.getElementById("importButton").addEventListener("click",()=>document.getElementById("importProject").click());document.getElementById("importProject").addEventListener("change",async(event)=>{const file=event.target.files?.[0];if(!file)return;if(hasProjectContent()&&!confirm("Replace the current in-memory project with this import?")){event.target.value="";return;}try{const text=await file.text();let imported;try{imported=JSON.parse(text);}catch(error){imported=window.jsyaml.load(text);}if(!imported||!Array.isArray(imported.agents))throw new Error("Invalid project format");project=imported.agents.every((agent)=>typeof agent==="string")?{schema_version:"1.0",agents:imported.agents,modules:imported.modules||[],workflows:imported.workflows||[defaultWorkflow]}:stableProjectToStudio(imported);document.getElementById("projectName").value=imported.project?.name||file.name.replace(/\.gear\.(yml|yaml|json)$/i,"");selectedAgent=0;selectedModule=0;currentStep="agents";updateModelDefaultsFromProject();save();render();if(document.getElementById("projectLauncher").open)document.getElementById("projectLauncher").close();toast("Project imported.");}catch(error){toast(error.message);}finally{event.target.value="";}});
  document.getElementById("newProjectButton").addEventListener("click",openProjectLauncher);document.getElementById("closeProjectLauncher").addEventListener("click",()=>document.getElementById("projectLauncher").close());document.getElementById("continueCurrentProject").addEventListener("click",()=>document.getElementById("projectLauncher").close());document.getElementById("launcherImportButton").addEventListener("click",()=>document.getElementById("importProject").click());document.getElementById("createStarterProject").addEventListener("click",createStarterProject);document.getElementById("starterProvider").addEventListener("change",(event)=>{if(PROVIDER_MODELS[event.target.value])document.getElementById("starterModel").value=PROVIDER_MODELS[event.target.value];});

  const initialize=async()=>{await Promise.all([loadStudioConfig(),loadStarterTemplates()]);await loadExperimentContext();updateModelDefaultsFromProject();render();renderBuildArtifacts();loadRunnerStatus();loadGearVersion();if(!experimentActive)openProjectLauncher();};
  initialize();
})();
