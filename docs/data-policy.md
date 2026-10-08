# LOOM data policy

## Bundled data
The repository bundles only a small metadata snapshot for source-linked scores. It does not redistribute commercial recordings.

## Generated sound
The instrument layer uses Web Audio synthesis. This is runtime-generated sound, not a concealed third-party recording pack.

## Procurement
`scripts/procure_mutopia.py` refreshes metadata from Mutopia when network access exists. A saved HTML fixture can be supplied to make the process deterministic in CI.

## Evidence labels
Every external catalogue item retains source URL and licence/provenance text. Derived statistics are marked as derived rather than source measurements.
