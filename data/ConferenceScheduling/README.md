# ConferenceScheduling

ConferenceScheduling is the participant-facing scenario used to build a scientific conference programme. No task receives user input at runtime: all initial facts are contained in `ConferenceContextAgent`, which is present in every task and always has the purpose `present the conference situation and its factual information.` This agent reports facts only. It must not state a problem to solve, propose a solution, construct a schedule, or explain what later agents do.

## Experimental process

The participant follows a progressive sequence of tasks built around the same conference-scheduling scenario. The first task introduces a simple sequential workflow, and the second adds an explicit validation step for familiarization. The two measured tasks then introduce the orchestration mechanisms evaluated in the study: parallel analysis and iterative refinement. The underlying domain remains stable throughout the experiment, while the multi-agent architecture progressively increases in structural complexity. This design limits domain-learning effects and focuses the evaluation on the effort required to implement and transfer the specified multi-agent workflows.

`T1` is the training task, `T2` is the familiarization task, and `T3` and `T4` are measured tasks. The experiment retains the existing counterbalancing mechanism and both configured frameworks (`crewai` and `adk`) to compare GEAR Studio with direct Python implementation.

## Task progression

| Prompt | Protocol role | Orchestration |
| --- | --- | --- |
| `P0` | scenario presentation, not measured | `ConferenceContextAgent` |
| `P1` / `T1` | training, not measured | `ConferenceContextAgent -> SchedulePlannerAgent` |
| `P2` / `T2` | familiarization, not measured | `ConferenceContextAgent -> SchedulePlannerAgent -> ScheduleValidatorAgent` |
| `P3` / `T3` | measured | `ConferenceContextAgent -> (TimeConstraintAnalyzerAgent || RoomConstraintAnalyzerAgent) -> SchedulePlannerAgent` |
| `P4` / `T4` | measured | `ConferenceContextAgent -> SchedulePlannerAgent -> [ScheduleReviewerAgent -> ScheduleRefinerAgent] x2 -> FinalScheduleAgent` |

## Stable output format

Schedules use a Markdown table with the columns `Start`, `End`, `Room`, `Presentation`, and `Speaker`. Times use 24-hour `HH:MM` notation. The reference outputs in `P3.md` and `P4.md` are valid examples; another schedule is acceptable when it satisfies every stated fact and constraint.
