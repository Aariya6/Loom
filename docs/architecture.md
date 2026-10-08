# LOOM architecture

## Request path

Browser -> FastAPI -> SQLAlchemy -> SQLite/PostgreSQL

The browser keeps audio real-time. The server keeps persistence and deterministic analysis. This split prevents transport latency from entering playback.

## State model

Project state is versioned. A save increments `revision`, stores a snapshot and updates the current project row. Restore never mutates an old snapshot; it creates a new revision from that snapshot.

## Analysis model

Raw notes -> numeric arrays -> feature series -> Canvas charts.

No analysis result is persisted as truth about the music. It is recomputable from the project state.
