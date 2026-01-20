<script>
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';

  const nodesStore = writable([]);
  const edgesStore = writable([]);

  const updateGraph = (graph) => {
    const safeGraph = graph || {};
    nodesStore.set(safeGraph.nodes || []);
    edgesStore.set(safeGraph.edges || []);
  };

  onMount(() => {
    window.updateAgentFlow = updateGraph;
    if (window.lastAgentGraph) {
      updateGraph(window.lastAgentGraph);
    }
    return () => {
      if (window.updateAgentFlow === updateGraph) {
        window.updateAgentFlow = null;
      }
    };
  });
</script>

<SvelteFlow nodes={$nodesStore} edges={$edgesStore} fitView={true} panOnScroll={true}>
  <Background color="#243048" gap={24} />
  <Controls position="bottom-right" />
  <MiniMap position="top-right" />
</SvelteFlow>
