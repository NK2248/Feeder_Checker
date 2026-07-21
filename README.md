# I/O Points Dataset Manager

A single-page, browser-based tool for building, importing, and maintaining DNP3.0 I/O point-list datasets for electrical substations and devices (AVR, LBS, RCS, REC, SCB, etc.). All data is stored in a Supabase Postgres table and synced live — no backend server required beyond Supabase.

## What it's for

Utility/protection engineers maintain large spreadsheets of I/O points (status points, control outputs, analog points) per feeder, bay, and device. This tool replaces those loose spreadsheets with:

- A structured, hierarchical way to organize points (Substation → Voltage → Scheme → Feeder → Number → Main → Point Type)
- A flexible importer that can read messy real-world Excel exports (multi-table sheets, merged cells, inconsistent headers) and map them into a clean schema
- Built-in duplicate/blank-cell checking, history/versioning, and file comparison
- A shared "DEFAULT" template that seeds new substations/devices with a standard baseline dataset

## Two modes

### Substation / Feeder mode
Organizes data by:
```
Substation → Voltage Level → Scheme (e.g. "H Scheme", "DBSB", "BR & A Half")
  → Feeder (e.g. TP, LINE, BUS_ZONE) → Number (if applicable) → Main
  → Point Type (Status Point / Control Output / Analog Point)
```
Scheme templates (`SCHEME_TEMPLATES`) define the standard feeder layout for a given voltage class (115kV, 22kV, 33kV, AIS/GIS substations, etc.) and are cloned into a substation the first time that scheme is used there.

### Device mode
Organizes data by:
```
Device (AVR / LBS / RCS(SF6) / RCS(Solid Dielectric) / REC / SCB / custom)
  → Point Type (Status Point / Control Output / Analog Point)
```
Optionally scoped to a substation, so the same device type can hold different data per site.

Both modes share the same underlying point schema per type (see **Data schema** below) and the same table/import/export/history tooling.

## The DEFAULT template

A hidden, reserved substation named `DEFAULT` acts as the master baseline:
- New substations automatically clone `DEFAULT`'s device datasets on first use.
- Any scheme newly added to a real substation seeds itself from `DEFAULT`'s data for that scheme, if present.
- "Restore from default template" lets you overwrite a substation/device dataset with the current `DEFAULT` version (after taking a history checkpoint first).
- Editing `DEFAULT` directly shows a warning banner, since changes there ripple forward into every new substation/device going forward.

## Data schema

Each point type has a fixed column set:

| Type | Key distinguishing columns |
|---|---|
| Status Point | `STATE_0`–`STATE_3`, `DNP3.0_OBJ/VAR/QII/CLASS/TYPE`, `DNP3.0_ADDRESS` |
| Control Output | `STATE_CLOSE`, `STATE_TRIP`, DNP3 fields |
| Analog Point | `SPECIFICATION_UNIT`, `SCALE_ACTUAL_DATA`, `SCALE_RAW_DATA`, DNP3 fields |

All types also carry `SPECIFICATION_POINT_NAME`, `REMARK`, `NOTE`, and a set of protection/BCU/IEC 61850 reference columns (hidden from the table by default; toggle with **show all columns**).

Feeder-mode datasets additionally carry `FEEDER_NAME` and `BAY_NAME`.

### Origin vs. added rows
Every dataset distinguishes:
- **Origin rows** — imported/locked rows. Only `DNP3.0_ADDRESS`, `NOTE`, `REMARK`, `SCALE_ACTUAL_DATA`, `SCALE_RAW_DATA` (and `BAY_NAME` in feeder mode) are editable; they cannot be deleted.
- **Added rows** — manually added or imported as "add-on"; fully editable and deletable.

## Key features

- **Import wizard (3-step column mapper)** — handles arbitrary Excel/CSV layouts:
  1. **Sheet & Table** — auto-detects one or more tables per sheet (multi-table sheets, section-labeled blocks), lets you merge same-structure tables.
  2. **Headers & Rows** — pick single or multi-row (up to 3) merged headers; mark a bottom boundary; skip/unskip individual rows; handles hidden Excel rows/columns and merged-cell fill-down.
  3. **Map Columns** — fuzzy auto-matches file columns to schema columns; save/reuse named mapping presets.
  - Includes automatic destination routing: guesses substation/feeder/device/type from the filename, sheet name, and a sample of the data, with a manual override modal and "remembered routes" for recurring filename patterns.
- **Duplicate check** — exact or fuzzy (Levenshtein-based) matching on `DNP3.0_ADDRESS`, `SPECIFICATION_POINT_NAME`, or any chosen column; also a cross-feeder address-conflict scan across an entire substation/scheme.
- **Blank-cell check** — flags empty editable cells, respecting origin-row lock rules.
- **Renumber** — bulk-reassigns `DNP3.0_ADDRESS` with a start value/step, optionally leaving origin rows untouched.
- **Compare** — diffs the current dataset against an uploaded file (or another dataset), row-matched by configurable key columns, with same/only-A/only-B/different-value breakdown and apply/merge actions.
- **History** — every save/edit auto-checkpoints (capped at 30 entries per dataset); manual "save history now"; preview or restore any past version.
- **Export** — per-type Excel/TCD export, whole-substation Excel export (one sheet per feeder/main combination), whole-device Excel export.
- **Multi-user awareness** — every row/edit is stamped with a user name (`localStorage`-based identity) and timestamp; sync status indicator shows live save state.

## Tech stack

- Vanilla HTML/CSS/JS, no build step or framework.
- [SheetJS (xlsx)](https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/) for reading/writing Excel files.
- [Supabase](https://supabase.com) (PostgREST over `feeder_data` table) as the persistence layer — all reads/writes go through `sbFetch`/`sbFetchAll` helpers directly against the REST API.
- Google Fonts (Instrument Sans, DM Mono).

## Data storage model

Everything lives in one Supabase table (`feeder_data`) with rows shaped like:
```
{ dataset_key, row_index, data: {...pointFields}, origin_count }
```
`dataset_key` encodes the full path to a dataset, e.g.:
```
__feeder__<substation>__<voltage>__<scheme>__<feeder>__<number>__<subset>__<main>__<type>
<substation>__<device>_<type>            (device mode)
__history__<dataset_key>                  (version history)
__config__ / __feeder_config__            (schema & structure config)
__colmap_presets__ / __route_presets__    (import mapping/routing presets)
```

## Running it

This is a single self-contained HTML file — open it directly in a browser, or serve it statically. It connects to a pre-configured Supabase project (URL/anon key are embedded in the file) and requires network access to `*.supabase.co`.

## Known constraints

- No authentication — access control is whatever your Supabase RLS policies enforce; user names are self-reported and not verified.
- Large substations pull row counts for every dataset combination on load (`preloadAllCounts`), which can mean many small requests — normal for typical substation sizes but worth watching if a scheme/feeder tree grows very large.
- Browser `localStorage` is only used for the local user-name identity, not for any dataset content.
