# AgentGridPlanning (Inspired by MiniGrid & BabyAI)

## Game Description

AgentGridPlanning is based on classic grid-environment abstractions used in artificial intelligence and reinforcement learning.

It is directly inspired by [MiniGrid](https://arxiv.org/abs/2306.13831), a benchmark suite of RL environments based on discrete grid navigation with symbolic objects such as keys, doors, and goals (Chevalier-Boisvert et al., *MiniGrid & Miniworld*, NeurIPS 2023).

The key-door-goal structure of AgentGridPlanning is also close to the tasks proposed in [BabyAI](https://arxiv.org/abs/1810.08272), designed to study sequential reasoning and symbolic planning in simple but constrained environments.


- `game_name`: `AgentGridPlanning`
- `universe`: 2D grid puzzle
- `player_goal`: reach `G` from `S` (constraints on `K` and `D` vary across `P1..P5`; `P0` only displays the puzzle)

## Runtime Input

- `principle`: no external input is provided during execution
- `rule`: agent 1 (`SystemDescriber`) produces the system description

## Grid Symbols

| Symbol | Meaning |
| --- | --- |
| `S` | Start point |
| `G` | Goal |
| `K` | Key |
| `D` | Door |
| `#` | Blocking wall |
| `.` | Free cell |


## Grid View

```text
S . . # . . .
# # . # . # .
. . K . . D .
. # # # # . #
. . . . . . G
```

## Action Definitions

- `U`: move one cell up
- `D`: move one cell down
- `L`: move one cell left
- `R`: move one cell right
- `TAKE_K`: valid only if the avatar is on cell `K`
- `OPEN_D`: valid only if the key has already been taken and the avatar is adjacent (Manhattan distance 1) to `D`

## Validity Rules

- a move outside the grid is invalid
- a move into `#` is invalid
- a move into `D` is invalid until `OPEN_D` has been executed
- the sequence is valid if all actions are valid in order
- victory is achieved if the final position is `G`

## Expected Global Output

- `format`: JSON list of strings
- `expected_reference_output` (example of the shortest path):

```json
["R", "R", "D", "D", "TAKE_K", "R", "R", "OPEN_D", "R", "D", "D", "R"]
```

## Common Rules P0..P5

- the first agent is always `SystemDescriber`
- `SystemDescriber` describes the grid and the allowed actions
- each `P` explicitly contains the `SystemDescriber` JSON in its description, followed by an `Expected Output` section

## Orchestration Variants

| P | Agents | Mode | Order | Note |
| --- | --- | --- | --- | --- |
| `P0` | 1 | sequential | `A1` | puzzle display only |
| `P1` | 2 | sequential | `A1 -> A2` | |
| `P2` | 4 | sequential | `A1 -> A2 -> A3 -> A4` | |
| `P3` | 8 | hybrid | <code>A1 -> A2 -> (A3 &#124;&#124; A4 &#124;&#124; A5) -> A6 -> A7 -> A8</code> | 3 agents executed in parallel |
| `P4` | 8 | hybrid with loop | `A1 -> A2 -> [A3 <-> A4, 2 iterations] -> A5 -> A6 -> A7 -> A8` | 2-iteration loop over 2 agents |
<!-- | `P5` | 8 | hybrid with loop | `A1 -> A2 -> [A3 <-> A4 <-> A5, 2 iterations] -> A6 -> A7 -> A8` | 2-iteration loop over 3 agents | -->
