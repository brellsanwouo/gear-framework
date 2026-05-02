
from crewai import Agent, Crew, Task, Process, LLM
import os
import sys
from dotenv import load_dotenv

load_dotenv()

try:
    import tempfile as _tempfile
    import mlflow as _mlflow

    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
    _mlflow.set_tracking_uri(tracking_uri)
    experiment_name = os.getenv("MLFLOW_EXPERIMENT_NAME", "gear-framework-crewai")
    _mlflow.set_experiment(experiment_name)
    run_name = os.getenv("MLFLOW_RUN_NAME", "test-crewai")
    with _mlflow.start_run(run_name=run_name):
        _mlflow.set_tag("framework", "crewai")
        result_text = str(result)
        _mlflow.log_metric("output_chars", len(result_text))
        if hasattr(_mlflow, "log_text"):
            _mlflow.log_text(result_text, "crewai_output.txt")
        else:
            with _tempfile.TemporaryDirectory() as _tmp:
                _path = os.path.join(_tmp, "crewai_output.txt")
                with open(_path, "w", encoding="utf-8") as _f:
                    _f.write(result_text)
                _mlflow.log_artifact(_path)
except Exception:
    pass


systemdescriberagent_llm = LLM(
  provider="openai",
  model="openai/gpt-4o-mini",
)

actionlistsolveragent_llm = LLM(
  provider="openai",
  model="openai/gpt-4o-mini",
)

systemdescriberagent = Agent(
  role="SystemDescriberAgent",
  goal="décrire de façon claire et compréhensible le problème à résoudre.",
  backstory="decrit le probleme AgentGridPlanning en fixant la grille de reference, les actions autorisees et les regles d'execution afin de fournir une specification exploitable. La description du probleme contient le JSON de description, la vue en grille et la definition des actions ci-dessous.\n  JSON de description du probleme:\n\n```json\n{\n  \"grid\": [\"S..#...\", \"##.#.#.\", \"..K..D.\", \".####.#\", \"......G\"],\n  \"elements\": [[\"S\", 0, 0], [\".\", 0, 1], [\".\", 0, 2], [\"#\", 0, 3], [\".\", 0, 4], [\".\", 0, 5], [\".\", 0, 6], [\"#\", 1, 0], [\"#\", 1, 1], [\".\", 1, 2], [\"#\", 1, 3], [\".\", 1, 4], [\"#\", 1, 5], [\".\", 1, 6], [\".\", 2, 0], [\".\", 2, 1], [\"K\", 2, 2], [\".\", 2, 3], [\".\", 2, 4], [\"D\", 2, 5], [\".\", 2, 6], [\".\", 3, 0], [\"#\", 3, 1], [\"#\", 3, 2], [\"#\", 3, 3], [\"#\", 3, 4], [\".\", 3, 5], [\"#\", 3, 6], [\".\", 4, 0], [\".\", 4, 1], [\".\", 4, 2], [\".\", 4, 3], [\".\", 4, 4], [\".\", 4, 5], [\"G\", 4, 6]],\n  \"actions_allowed\": [\"U\", \"D\", \"L\", \"R\", \"TAKE_K\", \"OPEN_D\"]\n}\n```\n  vue_grille_texte:\n\n```text\nS . . # . . .\n# # . # . # .\n. . K . . D .\n. # # # # . #\n. . . . . . G\n```\n  definition_des_actions: `U` deplacement d'une case vers le haut; `D` deplacement d'une case vers le bas; `L` deplacement d'une case vers la gauche; `R` deplacement d'une case vers la droite; `TAKE_K` valide uniquement si l'avatar est sur la case `K`; `OPEN_D` valide uniquement si la cle est prise et si l'avatar est adjacent a `D`.\n  contraintes_de_deplacement: un deplacement est invalide si la case cible est hors grille; un deplacement est invalide si la case cible est un mur `#`; un deplacement vers la porte `D` est invalide tant que l'action `OPEN_D` n'a pas ete executee.\n  condition_de_victoire: atteindre `G` sans entrer sur `D` (la cle est optionnelle).\n  symboles_de_grille: `S` depart; `G` objectif; `K` cle; `D` porte; `#` mur; `.` case libre.\n  taille_matrice: 5 x 7 (lignes x colonnes).\n  systeme_coordonnees: (ligne, colonne) indexe a partir de 0.\n  coordonnees_elements: definies dans le champ `elements` du JSON (liste de tuples [symbole, ligne, colonne]).",
  llm=systemdescriberagent_llm,
)

actionlistsolveragent = Agent(
  role="ActionListSolverAgent",
  goal="produire la les listes de séquences d'actions valides et gagnantes.",
  backstory="calcule toutes les sequences d'actions finale.",
  llm=actionlistsolveragent_llm,
)

systemdescribertask = Task(
  description="decrire la grille de reference et ses elements (`S`, `G`, `K`, `D`, `#`, `.`), decrire les preconditions de `TAKE_K` et `OPEN_D`, preciser les conditions d'invalidite des deplacements.",
  expected_output="La sortie attendue est une liste JSON de chemins valides suivant le template ci-dessous. Supprime les caractères pour échappé.",
  agent=systemdescriberagent,
  name="SystemDescriberTask",
)

actionlistsolvertask = Task(
  description="construire les sequences d'actions a partir de la grille, verifier la legalite de chaque action et l'etat final de victoire (chemins de `S` vers `G`), puis produire la sortie finale. Il est interdit d'entrer sur `D`. `TAKE_K` est optionnelle. Les chemins sont distincts et sans revisite de case par deplacement.",
  expected_output="La sortie attendue est un JSON contenant tous les chemins valides pour quitter de `S` à `G`. pour présenter la sortie, tu peux utiliser le template ci-dessous. Rassure toi de supprimer les caractères pour échapper.  ```json {   \"path 1\": \"[\"R\", \"R\", \"D\", \"D\", \"L\", \"L\", \"D\", \"D\", \"R\", \"R\", \"R\", \"R\", \"R\", \"R\"]\",   \"path 2\": \"[\"R\", \"R\", \"D\", \"D\", \"TAKE_K\", \"L\", \"L\", \"D\", \"D\", \"R\", \"R\", \"R\", \"R\", \"R\", \"R\"]\" }",
  agent=actionlistsolveragent,
  name="ActionListSolverTask",
)

crew = Crew(
  agents=[systemdescriberagent, actionlistsolveragent],
  tasks=[systemdescribertask, actionlistsolvertask],
  process=Process.sequential,
)


result = crew.kickoff()

print("result:", result)