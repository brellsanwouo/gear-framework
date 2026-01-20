import './app.css';
import '@xyflow/svelte/dist/style.css';
import App from './App.svelte';

const root = document.getElementById('flow-root');
if (root) {
  new App({ target: root });
}
