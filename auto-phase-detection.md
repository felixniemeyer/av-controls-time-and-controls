# Auto Phase Detection Specification

Date: 2026-03-05
Status: Draft for implementation
Scope: `time-n-controls` integration with browser-side ONNX bar-phase estimation

## Model Source

The phase detection model is trained in `/home/felix/dev/ai/dance`. The checkpoint used is:
- `checkpoints/sweep_L2_H512_M96/26.pt` (PhaseGRUMel, 96 mels, 512 hidden, 2 layers)

## Goals

- Replace manual BPM/tap clocking with automatic phase detection.
- Run phase detection in the artwork application (receiver side), not in the controller.
- Keep time-based features (including tap patterns) working with auto-phase input.
- Support phase anticipation via model-provided phase-rate output.

## Decisions

1. Runtime: browser-only ONNX inference (`onnxruntime-web`).
2. Audio source: in artwork runtime; device selection is exposed via a new `Menu` control.
3. Ownership: auto-phase runs receiver-side and drives receiver-side timing.
4. Manual fallback: no blend to manual tap workflow.
5. Tap pattern basis: refactor from beat/bar assumptions to pure phase-domain scheduling.
6. Prediction outputs: use phase + phase-rate; phase is decoded and constrained to monotonic progression.
7. Existing sample-rate/frame-size behavior in current implementation is accepted as-is.

## Conceptual Model

### Phase Domain

- Define a normalized cycle phase `p in [0, 1)`.
- `p = 0` means cycle start.
- A cycle length is application-defined (not tied to fixed 4/4 beats).
- Triggers can be placed at arbitrary phase positions inside the cycle.

### Phase Decode

- Model output is interpreted as:
  - `sinPhase = out[0]`
  - `cosPhase = out[1]`
- Normalize to scalar phase with:
  - `rawPhase = mod(atan2(sinPhase, cosPhase) / (2*pi), 1)`
- Runtime handles this conversion; downstream systems consume normalized phase only.

### Unwrapped Phase

- Maintain an internal unwrapped phase accumulator `P` (monotonic non-decreasing).
- Public/normalized phase is `p = P mod 1`.
- Scheduling should be based on `P` to avoid wrap discontinuities.

## TapPattern Refactor

Current `TapPattern` logic uses beats and `beatsPerCycle`. Refactor to phase-native semantics:

- Replace `beatsPerCycle` with `phasesPerCycle` conceptually fixed to `1.0` normalized cycle.
- Store pattern events as:
  - `onPhase: number` in `[0, 1)`
  - `durationPhase: number` in `(0, 1]`
  - `velocity: number`
- Recording:
  - `tap()` records `onPhase` from current normalized phase.
  - `release()` sets `durationPhase` from current phase delta.
- Playback:
  - Schedule ON/OFF by absolute unwrapped phase targets.
  - Repeat each cycle by adding integer phase offsets.

## Clock/Transport Abstraction

Introduce a phase-driven timing source in `time-n-controls`:

- `PhaseClock` (new) should expose:
  - `getPhase(): number` -> normalized `[0, 1)`
  - `getUnwrappedPhase(): number` -> monotonic
  - `getPhaseRate(): number` -> cycles/second
  - `getSeconds()` and `getTickDeltaS()` for existing utilities
  - queue registration callbacks for future event scheduling

- Existing beat-specific helpers can be deprecated or adapted by mapping:
  - `beat = phase * beatsPerCycle` only where explicitly needed by legacy consumers.

## Queue/Scheduling Changes

Current `Queue` converts beat targets to milliseconds. Replace with phase-based queue:

- `whenPhase(targetUnwrappedPhase, callback)`
- Scheduler computes `secondsTill = (target - currentUnwrappedPhase) / phaseRate`
- Look-ahead remains in time (`ms`) and is converted against current phase-rate.
- If phase-rate is invalid/too small, scheduler pauses firing rather than generating unstable timing.

## ONNX Inference Integration (Artwork Side)

### Pipeline

1. Capture audio in browser.
2. Resample/frame according to model requirements.
3. Run ONNX inference continuously with recurrent state.
4. Decode outputs:
   - `phase` from `[sin, cos]`
   - `phaseRate` from model output
5. Update `PhaseClock` each tick.

### Anticipation

- Use model `phaseRate` for short-horizon anticipation:
  - `phaseFuture = phaseNow + phaseRate * dt`
- Apply anticipation in timing-sensitive scheduling paths only.

## Monotonicity Policy

Model phase can jitter or wrap ambiguously frame-to-frame. Runtime policy:

- Initialize phase to `0`.
- Keep unwrapped phase `P` strictly non-decreasing.
- Resolve wrap by adding `+1` cycle on 1->0 transitions.
- Maximum forward step per model update: `0.5` phase (180 degrees).
- If computed step is negative or larger than `0.5`, treat sample as invalid and freeze (`P` unchanged).
- On invalid model/runtime state, hold last valid phase (no extrapolation).
- Prefer stable forward motion over exact raw-frame fidelity.

## Receiver/Controller Protocol Impact

- Auto-phase logic remains receiver-internal; no requirement to synchronize phase to controller.
- Controller remains for UI interaction; timebase is local to artwork runtime.

## New Control Type: `Menu`

Add a new protocol control type `Menu` for receiver-authored option lists (e.g., audio device selection).

Requirements:

- Receiver sends `Menu` description (title/description/items).
- Controller renders menu using the existing menu modal UI flow.
- User taps an item; receiver is notified with the tapped item id/action.
- Sender/controller cannot override menu options directly; options are receiver-defined.

Implementation direction:

- Reuse and refactor existing controller menu stack:
  - `controller/src/menu-globals.ts`
  - `controller/src/components/Menu.vue`
  - current menu trigger usage in `Controller.vue` and local controls (e.g. preset/mapping flows)
- Share rendering/interaction code between:
  - protocol `Menu` controls,
  - existing controller-local menu actions.
- Reuse control instances where possible for controller-local buttons to avoid duplicate UI pathways.

## Non-Goals (Current Phase)

- Manual tap blending or hybrid auto/manual clock.
- Confidence-driven blending.
- Enforcing musical beat-count derivation from phase for tap pattern usage.

## Implementation Phases

1. Refactor `TapPattern` + queue to phase-domain scheduling.
2. Add `PhaseClock` abstraction and adapt existing consumers.
3. Integrate browser ONNX runtime in artwork app and feed `PhaseClock`.
4. Add protocol-level `Menu` control for device selection and receiver-authored options.
5. Validate timing stability and trigger alignment under live audio.

## Validation Criteria

- Tap pattern repeats correctly over phase cycles without beat assumptions.
- No backward-trigger glitches due to phase wrap/jitter.
- Trigger timing remains stable under varying detected tempo.
- Receiver-side runtime works without controller-side time synchronization.
