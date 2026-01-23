# Interface de génération Gear-Agent vers CrewAI

## Usage rapide

- Ouvrir [gear-ui/index.html](gear-ui/index.html) dans un navigateur.
- Renseigner les champs Gear-Agent.
- Copier ou télécharger le YAML CrewAI généré.

## Exécuter l'orchestration depuis l'UI

L'exécution Python nécessite un petit serveur local (pour accéder à CrewAI et aux variables d'environnement).

1. Installer les dépendances :

```bash
pip install -r gear-ui/requirements.txt
```

2. Démarrer le serveur :

```bash
python gear-ui/server.py
```

3. Ouvrir l'interface via http://localhost:8000

L'onglet "Orchestration" propose un bouton "Exécuter orchestration" ainsi qu'un champ Inputs (JSON).
Le serveur exécute le script dans l'environnement courant et utilise les variables d'environnement (.env, clés API, etc.).

### Configuration .env (providers LLM)

Crée un fichier [gear-ui/.env](gear-ui/.env) (ou .env à la racine) pour stocker les clés et endpoints, par exemple :

```env
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434
```

Le serveur charge automatiquement le .env au démarrage.

## Source des mappings

L’interface charge automatiquement la table de conversion depuis [conversion_table.yml](../conversion_table.yml). Si le fichier n’est pas accessible, un mapping par défaut est utilisé.
