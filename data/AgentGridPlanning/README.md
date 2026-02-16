# AgentGridPlanning (Inspiré de MiniGrid & BabyAI)

## Description du game

AgentGridPlanning est basé sur des abstractions classiques d’environnements en grille utilisés en intelligence artificielle et en apprentissage par renforcement.

Il s’inspire directement de [MiniGrid](https://arxiv.org/abs/2306.13831), un ensemble d’environnements de référence en RL reposant sur une navigation discrète en grille avec objets symboliques tels que clés, portes et objectifs (Chevalier-Boisvert et al., *MiniGrid & Miniworld*, NeurIPS 2023).

La structure clé-porte-objectif de AgentGridPlanning est également proche des tâches proposées dans [BabyAI](https://arxiv.org/abs/1810.08272), conçues pour étudier le raisonnement séquentiel et la planification symbolique dans des environnements simples mais contraints.


- `nom_du_game`: `AgentGridPlanning`
- `univers`: puzzle 2D sur grille
- `objectif_joueur`: atteindre `G` depuis `S` (les contraintes sur `K` et `D` varient selon `P1..P5`; `P0` sert a afficher le puzzle)

## Entrée runtime

- `principe`: aucune entree externe n'est fournie pendant l'execution
- `regle`: l'agent 1 (`SystemDescriber`) produit la description du systeme

## Symboles de grille

| Symbole | Signification |
| --- | --- |
| `S` | Point de départ |
| `G` | objectif |
| `K` | cle |
| `D` | porte |
| `#` | mur bloquant |
| `.` | case libre |


## Vue grille

```text
S . . # . . .
# # . # . # .
. . K . . D .
. # # # # . #
. . . . . . G
```

## Definition des actions

- `U`: deplacement d'une case vers le haut
- `D`: deplacement d'une case vers le bas
- `L`: deplacement d'une case vers la gauche
- `R`: deplacement d'une case vers la droite
- `TAKE_K`: valide uniquement si l'avatar est sur la case `K`
- `OPEN_D`: valide uniquement si la cle est deja prise et si l'avatar est adjacent (distance Manhattan 1) a `D`

## Regles de validite

- un deplacement hors grille est invalide
- un deplacement vers `#` est invalide
- un deplacement vers `D` est invalide tant que `OPEN_D` n'a pas ete execute
- la sequence est valide si toutes les actions sont valides dans l'ordre
- victoire si la position finale est `G`

## Sortie globale attendue

- `format`: liste JSON de strings
- `sortie_attendue_reference` (exemple de chemin le plus court):

```json
["R", "R", "D", "D", "TAKE_K", "R", "R", "OPEN_D", "R", "D", "D", "R"]
```

## Regles communes P0..P5

- le premier agent est toujours `SystemDescriber`
- `SystemDescriber` decrit la grille et les actions autorisees
- chaque `P` contient explicitement le JSON de `SystemDescriber` dans sa description, puis une section `Sortie attendue`

## Declinaisons par orchestration

| P | Agents | Mode | Ordre | Note |
| --- | --- | --- | --- | --- |
| `P0` | 1 | sequentiel | `A1` | affichage du puzzle uniquement |
| `P1` | 2 | sequentiel | `A1 -> A2` | |
| `P2` | 4 | sequentiel | `A1 -> A2 -> A3 -> A4` | |
| `P3` | 8 | hybride | <code>A1 -> A2 -> (A3 &#124;&#124; A4 &#124;&#124; A5) -> A6 -> A7 -> A8</code> | 3 agents executes en parallele |
| `P4` | 8 | hybride avec boucle | `A1 -> A2 -> [A3 <-> A4, 2 tours] -> A5 -> A6 -> A7 -> A8` | boucle de 2 tours sur 2 agents |
<!-- | `P5` | 8 | hybride avec boucle | `A1 -> A2 -> [A3 <-> A4 <-> A5, 2 tours] -> A6 -> A7 -> A8` | boucle de 2 tours sur 3 agents | -->
