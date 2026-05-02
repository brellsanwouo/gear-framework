# Gear Framework UI

UI minimale basée sur les UVL Gear.

## Lancer

Depuis la racine du projet :

```bash
python3 server.py
```

Puis ouvre :

- http://127.0.0.1:8200/ui/

Le serveur sert la racine de `gear-framework`, ce qui permet à l'UI de lire `/gear/gear-agent.uvl`.

## Charger d'autres UVL

Dans l'UI :

- "Charger un UVL local" permet d'ouvrir n'importe quel fichier `.uvl`.
- "Coller un UVL" permet de parser du texte directement.

## YAML ↔ UI

- Le bloc "Résumé YAML" est généré automatiquement depuis ce qui est coché/rempli.
- "Charger le YAML" applique un YAML dans l'UI (cases cochées + valeurs).
- Le YAML collé est aussi synchronisé automatiquement après une courte pause.
- Une valeur `false` dans le YAML n'active pas la feature correspondante.

## Orchestration

- Une section dédiée permet de charger `gear/gear-multiagent.uvl` et définir l'orchestration.
- Elle fonctionne comme les agents (tree + YAML + synchro).
