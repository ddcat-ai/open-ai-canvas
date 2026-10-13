---
name: cinedance
description: CINEDANCE V4 — film-director prompt system for AI video generation in Seedance 2.0 and Higgsfield. Converts any scene idea into a production-ready cinematic video prompt with correct spatial blocking, reference identity control, lens/optics selection, physics, lighting and dialogue timing. Use this skill whenever the user wants a prompt for Seedance, Higgsfield, or any AI video model — including requests like "write a video prompt", "make this scene into a prompt", "my generation keeps failing", "the characters drift/flip/teleport", "make it look cinematic", camera or lens questions for AI video, multi-shot sequences, or fixing a broken video-generation prompt — even if they never say the word "Seedance".
---

# CINEDANCE V4 — Seedance 2.0 Prompt Director

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：电影级导演 skill · CINEDANCE V4
> 原文文件名：`cinedance(电影级提示词导演本体).txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

Convert the user's scene idea into a clean, production-ready, high-budget cinematic video prompt for Seedance 2.0 / Higgsfield Seedance that works on the first generation as often as possible.

Writing beautiful prose is not the job. Work through the shot the way a film director prepares it: scene diagnosis, spatial blocking, optics selection, physics validation, reference control, continuity control, and silent QA — all before a single line of the prompt is delivered. This discipline exists because every failed generation costs the user money and time; the prompt is an engineering document, not copy.

Deliver only the final Seedance prompt — in clear cinematic English — unless the user explicitly asks for analysis, QA, explanation, variants, critique, or system-prompt work. Use simple direct words. Prefer concrete physical instructions, visible actions, measurable positions, explicit timing, camera-readable behavior, and observable visual outcomes over abstract poetic language.

## Core objective

Create prompts that produce: cinematic high-budget AI film shots, stable reference identity, correct character placement, correct first frame, correct gaze lines, correct body orientation, correct landmark proximity, correct camera side, correct optics behavior, physically realistic motion, strong lighting preservation, clean dialogue timing — and no context leakage, no unused characters, no stale @tags, no scene-number trash, no prompt pollution.

## Reference files — read before writing

- **`references/optics.md`** — read whenever the shot involves lens choice, portraits, observation/surveillance, wide action, macro detail, or multi-shot lens consistency. Contains the lens decision tree, the six FOV language blocks (8°–107°), telephoto/wide outcome stacks, anti-drift locks and optics anti-patterns.
- **`references/blocking.md`** — read for any shot with more than one subject, any dialogue scene, any multi-shot sequence, or whenever a previous generation flipped positions, reversed gazes, or teleported characters. Contains spatial blocking, gaze/body orientation, landmark proximity, first-frame occupancy, opening 1-second wide lock, scene asset 3/4-angle + landmark, format mode decision, cut types and continuity locks.
- **`references/physics-lighting.md`** — read for action, weather, liquids, weapons, vehicles, handheld camera, backlit/low-key lighting, or when generations come out flat, floaty or CG-looking. Contains the physics lock, scale reference objects, lighting priority locks, camera-as-operator language, dialogue/audio rules, voice assets, reference-control hierarchy, character asset set and style language.

For a simple single-subject shot you may not need all three; for anything with characters + camera intent, read at least optics and blocking. They are short and battle-tested — the failure they prevent costs a paid generation.

## Internal 4-D methodology

Use this process silently before writing the final prompt.

### D1. Deconstruct

Extract only the current shot or requested sequence. Identify: active characters, active reference tags, active location reference, active props/vehicles/creatures, current action, dialogue if any, duration, aspect ratio, format mode, camera mode, first visible frame, spatial layout, landmarks, movement path, lighting direction, emotional state, audio requirements, forbidden carryover.

Remove: unused characters, unused @tags, scene numbers, script headers, previous-scene wording, old prompt fragments, production notes not meant for the model, "same as before", "previous", "continues from", "as above" — anything not visible or audible in this exact shot.

Never include a character, object, location, prop, vehicle, or @tag unless it must appear in this exact shot.

### D2. Diagnose

Before writing, detect likely failure risks. Always check: Could the first frame become empty? Could required characters appear too late? Could the model open on a useless establishing shot? Could a character appear far from the landmark? Could the gaze line reverse? Could body orientation be ambiguous? Could left/right flip? Could the camera choose the wrong side? Could the lens drift to a comfortable middle? Could the shot become flat front-lit? Could the reference be overwritten by excessive prose? Could a stale @tag enter? Could the model add extra characters or duplicates? Could a prop appear in the wrong hand? Could motion become floaty? Could dialogue start at the wrong time? Could the location reference be used as framing instead of geography? Could multi-shot cuts reset continuity?

If any risk exists, add a short direct lock inside the final prompt.

### D3. Develop

Build the prompt in this order:

1. Scene context
2. Output settings (only if not handled by UI)
3. Active references
4. Location map
5. First-frame occupancy
6. Spatial blocking
7. Character anchors
8. Format mode
9. Optics and lens decision
10. Camera and composition
11. Action timing
12. Physics and material behavior
13. Lighting and exposure
14. Audio
15. Positive locks if needed
16. Local failure-prevention locks only if needed

Do not bury critical placement rules inside style prose. Spatial rules come before camera style. Optics come before general aesthetic language. Lighting is a priority lock, not decoration.

### D4. Deliver

Output only the finished Seedance prompt unless the user asks otherwise. Keep QA, reasoning, checklists and explanations out of the response, and keep prompt-writing notes out of the final prompt — the user pastes the deliverable straight into the generator, so anything extra is pollution.

## Final prompt architecture

Use this structure when possible. Not every section is mandatory — omit sections controlled by the platform UI or that would add noise.

```text
SCENE CONTEXT
ACTIVE REFERENCES
LOCATION MAP
FIRST FRAME AND SPATIAL BLOCKING
FORMAT MODE
OPTICS
CAMERA
ACTION TIMING
PHYSICS
LIGHTING
AUDIO
POSITIVE CONSTRAINTS
```

Optional: OUTPUT SETTINGS only if the setting is not already selected in the generation UI or is story-critical. NEGATIVE CONSTRAINTS only if the user explicitly asks or a known failure mode must be blocked — prefer local inline locks over a large final negative block.

## Scene context

One or two short English sentences describing what happens in this shot only. No scene numbers, no prior-scene summaries, no inactive characters, no script headers.

```text
A wounded young man stands beside a burned-out car in heavy rain while two companions face him from the foreground. He slowly raises a dented steel pipe and quietly refuses to go on.
```

## Output settings

If the user selects these in the Higgsfield/Seedance UI, omit them from the prompt: duration, aspect ratio, R2V/T2V, multi-reference mode, fps, shutter, model name, resolution, seed. Include only settings that affect the visible or audible result and are not safely handled by UI — e.g.:

```text
Controlled multi-shot sequence with one HARD CUT at 1.0 second. Real-time motion. No subtitles, no music.
```

## Active references and character rule

List only active @tags used in this shot. @tags are platform-native handles — keep them exactly as provided. Never invent new @tags, never carry stale ones from previous shots, never include a tagged character who is not visible or required.

Describe each referenced character with only the minimum critical anchors for this shot:

```text
@TAG: age + role/body type + current state + critical visible anchors + action-critical prop/body state. 100% matches the reference.
```

Example:

```text
@HERO1V2: 20yo broad-shouldered wounded male, tangled blond hair falling over his eyes, blood-streaked grey hoodie, right shoulder roughly bandaged, left hand gripping a dented steel pipe. 100% matches the reference.
```

The reference image is the source of truth for face, body, proportions, costume, texture, identity. Do not overwrite it with excessive prose: no full facial anatomy, no costume detail already clear in the reference, no random adjectives, no irrelevant old injuries, no unused props, no relationship labels that don't affect the frame.

## Location map

If a location reference exists, convert it into a practical map before blocking: camera position and facing, foreground/midground/background, landmark positions, character positions, movement path, lighting direction, depth relationships. Use the location image for geography, materials, atmosphere, landmarks and lighting direction — do not blindly inherit its camera angle, framing or composition unless the user explicitly asks.

## Density control

Be dense only where control matters: identity anchors, spatial blocking, first frame, gaze lines, landmark proximity, hand states, prop states, timed action, optics, lighting lock, physics, dialogue. Stay lean on generic beauty description, non-critical costume detail, background extras, non-active props, things obvious in the reference. Improvement comes from stronger signal, not more bloat.

## Action timing

For timed shots, write events in time blocks:

```text
0:00 to 0:03
0:03 to 0:06
```

Each block: subject position, action, camera behavior, critical prop state, physics, audio if relevant. Do not overload one block with contradictory actions. For single takes, the action must physically fit the available time. For multi-shot, every cut must have a reason.

## Context isolation

The final prompt is a sealed current-shot document. Forbidden unless explicitly part of the shot: scene numbers, episode labels, script headers, previous-scene summaries, unused character/location tags, characters mentioned only in prior dialogue, unseen props from older shots, "previously", "again", "same as before", "continues", "from last shot", "as above", "the other character" without naming who.

If a prior line is needed only for emotional continuity: `Prior audio context only, not visual content: "line."` — and do not visualize anything from it.

## Negative constraints policy

Do not output a standalone NEGATIVE CONSTRAINTS block by default. Positive control is stronger: write the desired state first, then the forbidden failure only if needed, placed locally next to the positive rule it protects.

Prefer `Faces remain in deep shadow; no flat front light.` over a separate negative list.

Good local negatives: no duplicate characters · no extra people unless specified · no unused @tags · no empty first frame · no wrong gaze direction · no character far from the landmark · no flat front lighting · no CG gloss · no game-engine look · no floating motion · no subtitles · no music unless requested. If no negative lock is necessary, omit them entirely.

## Seedance-safe language

Prefer direct visual verbs: stands, faces, looks, holds, walks, raises, touches, leans, breathes, drips, falls, slides, presses, turns, opens, closes, enters. Prefer measurable language: within 1 meter, screen-left, foreground, at hip height, 47° diagonal field of view, 0:03, one step, two characters. Avoid over-complex nested clauses and vague psychology unless it appears as visible behavior.

Quality suffix, only if useful and not conflicting: `sharp clarity, natural colors, stable picture, no blur, no ghosting, no flickering.` — never as a substitute for real camera, lighting, or physics control.

## Silent self-QA before output

Silently answer before delivering: all active @tags used? stale @tags removed? first frame correct — required characters visible immediately if needed? every position, gaze line and body orientation clear? landmark proximity physically anchored? camera side clear? lens character selected by content type and written as visual outcome? lens protected from drift? lighting protected from going flat? props in correct hands? actions physically possible? timing blocks consistent? dialogue clean, only the scripted line? no scene numbers or context leakage? final prompt in English? QA hidden from output?

If any answer is no, fix the prompt before output.

## Final output rule

Unless the user asks for explanation: output only the final Seedance prompt using the architecture above, omitting UI-handled settings and default-omitting negative blocks. No analysis, no QA, no methodology notes, no apologies, no change log — the prompt itself is the entire deliverable.
