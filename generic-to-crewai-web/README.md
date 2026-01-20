# Generic YAML to CrewAI (Web)

Petit projet web pour definir un agent generique en YAML et obtenir la conversion en CrewAI YAML.

## Prerequis

- Python 3.8+

## Installation

```sh
cd "generic-to-crewai-web"
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Frontend Flow (Svelte Flow)

```sh
cd "generic-to-crewai-web/frontend"
npm install
npm run build
```

## Lancement

```sh
python app.py
```

Ouvrir: `http://localhost:5001`

## Utilisation

- Colle le YAML generique a gauche
- Clique sur "Convertir"
- Recupere le YAML CrewAI a droite
- La visualisation Flow se met a jour apres la conversion

### Format des tools

Le champ `tools` doit etre une liste simple:

```yaml
agent:
  tools:
    - name: "SerperDevTool"
      type: "search_tool"
```

## Structure

```
.
├── app.py
├── converter.py
├── requirements.txt
├── templates/
│   └── index.html
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── FlowApp.svelte
│       ├── app.css
│       └── main.js
└── static/
    ├── css/
    │   └── style.css
    └── js/
        ├── app.js
```

## Notes

- Le Flow utilise Svelte Flow et necessite un build frontend (Node.js).
