# xhs-trip-pipeline Acceptance

Date: 2026-07-02

## Environment Gate

- `data/spike/links.txt`: BLOCKED-BY-INPUT, file missing.
- `.env.local` map keys: BLOCKED-BY-INPUT, `AMAP_REST_KEY` / `NEXT_PUBLIC_AMAP_JS_KEY` not present.
- `claude` CLI: available, `2.1.195`.

Because real XHS links and Amap keys are absent, full real-scene acceptance is blocked. The fallback smoke path used `ManualFetcher` with mocked LLM/map dependencies to verify contracts, checkpoint layout, and UI rendering.

## Smoke Scenario

- Data root: `/tmp/packup-acceptance.ytgoyg`
- Trip id: `acceptance-smoke`
- Input: one manual note for 上海 / 外滩.
- Result: `40-plan.json` generated with 1 day and 1 item.

## Timing

| Stage | Start | Done | Duration |
| --- | --- | --- | --- |
| fetch | 2026-07-02T10:10:20.084Z | 2026-07-02T10:10:20.086Z | ~2ms |
| extract | 2026-07-02T10:10:20.086Z | 2026-07-02T10:10:20.087Z | ~1ms |
| ground | 2026-07-02T10:10:20.087Z | 2026-07-02T10:10:20.087Z | ~0ms |
| plan | 2026-07-02T10:10:20.087Z | 2026-07-02T10:10:20.088Z | ~1ms |
| end-to-end | - | - | 6ms |

Mock timing is not representative of real xhs/AMAP/LLM latency.

## Checklist

- [x] Pipeline emits start/done events for Fetch, Extract, Ground, Plan.
- [x] Checkpoints are written in `00-input.json`, `10-notes.json`, `20-pois.json`, `30-grounded.json`, `40-plan.json`.
- [x] Segment contracts parse through zod in unit tests.
- [x] ManualFetcher fixture path can drive the full pipeline with mocked dependencies.
- [x] `npm run stage -- acceptance-smoke plan --force` executed successfully with `PACKUP_STAGE_MOCK=1`.
- [x] Input page renders and `/trip/mock-trip` renders timeline + missing map-key placeholder under `npm run dev`.
- [ ] Real XHS extraction: BLOCKED-BY-INPUT.
- [ ] Real Amap grounding/routing: BLOCKED-BY-INPUT.
- [ ] Two real scenarios, including pure-image note: BLOCKED-BY-INPUT.

## Quality Observations

- POI authenticity and route realism were not manually audited because real XHS/Amap inputs were unavailable.
- Mock smoke verified the shape of preserved note reason text and timeline rendering, not semantic itinerary quality.

## Residuals

- Provide `data/spike/links.txt` and `.env.local` map keys, then rerun Spike A and real acceptance scenarios.
- Real `xhs read` output parser may need adjustment after Spike A captures concrete output samples.
