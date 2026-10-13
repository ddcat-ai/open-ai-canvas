# Blocking, first frame, format mode and continuity

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：cinedance · 空间调度（谁在哪、朝向哪）
> 原文文件名：`blocking(cinedance空间调度).txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

## First-frame occupancy lock

If the shot must start with characters visible, state it directly:

```text
The first visible frame already contains all required characters in their correct positions.
No empty establishing frame.
No delayed character reveal.
No opening frame without the required subjects.
The spatial relationship is readable immediately in frame one.
```

Only allow an empty opening if the user explicitly requests it. If the user requests a flash cut or very short establishing cut, it must still contain the required subject or location information immediately. No empty flash cuts, no abstract filler, no random landscape insert unless requested.

## Opening 1-second wide lock

For multi-character scenes (or any scene prone to characters swapping positions), open each scene with about 1 second of wide shot before cutting in:

```text
The shot opens on a 1-second wide establishing frame: no complex action, every character
visibly placed and facing, so the model registers "who stands where" before the first close-up.
```

That one second costs a little extra generation per shot but sharply improves cross-shot position consistency. Do not use it on every shot — reach for it when a multi-person dialogue keeps breaking continuity.

## Spatial blocking lock

Always define where everyone is. For each important subject specify: screen position, world position, distance from landmark or other character, body facing direction, gaze direction, movement direction, foreground/midground/background. Use simple physical language.

```text
@HERO1V2 stands within 1 meter of the burned-out car, one hand resting on the scorched hood.
@HERO2 and @HERO3 stand together in the foreground, facing @HERO1V2.
Hero2 is camera-right of the pair.
Hero3 is camera-left of the pair.
Both bodies face Hero1.
Both gaze lines are locked on Hero1.
Hero1 faces them from the car.
```

Never rely on weak words when spatial accuracy matters: near, around, beside, somewhere, in the area, nearby. Replace with: within 1 meter · touching · boots inside the root circle · hand on the handle · standing directly under the sign · back against the wall · in front of the rear passenger door · at the south kerb edge.

## Gaze line and body orientation lock

Body direction and eye direction are separate — always write both when character relationships matter: torso faces X · eyes stay locked on X · head turns toward X · back faces camera · profile faces screen-left · character looks past camera toward X · character does not look away unless specified.

For dialogue scenes: the speaking character's lips move only for the scripted line; other characters listen silently unless explicitly speaking; no offscreen voices unless specified.

## Landmark proximity lock

If a character must be near a landmark, anchor them physically.

Weak: `near the tree`, `by the taxi`, `around the location`.

Strong: `@HERO1V2 stands within 1 meter of the burned-out car, one hand planted on the scorched hood.`

## Format mode decision

Silently choose SINGLE CONTINUOUS TAKE or CONTROLLED MULTI-SHOT SEQUENCE.

Default to SINGLE CONTINUOUS TAKE unless: the user explicitly asks for cuts / flash cuts / montage / inserts / reverse shots / hard cuts; the action cannot be clearly staged in one camera position; a critical detail needs an insert close-up; two simultaneous emotional reactions must be shown from different angles; the scene needs geography plus reaction plus detail; the user asks for trailer-like, fragmented, memory, dream, chaos, impact, or music-video editing.

If choosing MULTI-SHOT, define every cut explicitly: Shot A duration, camera, subjects visible in first frame, spatial blocking, action; cut type; Shot B likewise. Never let the model invent unspecified cuts. Never allow random montage. Never cut to a character, object, or @tag not active in the shot. Every internal cut must preserve spatial continuity, screen direction, gaze line, lighting direction, and character positions.

## Multi-shot continuity lock

For every internal cut, preserve: same active character list · same location geography · same screen direction unless the camera angle explicitly changes · same gaze targets · same left/right relationship unless deliberately reversed by camera position · same lighting direction · same wardrobe, wounds, props, hand states · same blood, snow, dirt, sweat, water, fire, smoke continuity · same object states · same emotional progression.

Do not reset action after a cut. Do not teleport characters. Do not change distance to landmarks unless time and movement justify it. Do not introduce new props or characters after a cut unless explicitly requested.

## Cut types

Use only explicit cut types. Allowed: HARD CUT, SMASH CUT, MATCH CUT, INSERT CUT, REVERSE CUT, WHIP CUT. Avoid fade, crossfade, dissolve, transition effects. Unless explicitly requested:

```text
NO fade-to-black.
NO crossfade.
NO dissolve.
NO transition effects.
HARD CUTS only.
```

## Camera and composition

Write camera instructions as physical operator behavior. Define: lens character, camera height, camera distance, camera angle, camera side, subject size, screen placement, camera movement, focus behavior, depth of field, handheld quality, framing priority.

Prefer: camera fixed at X · camera moves from X to Y · lens at hip height · lens at snow level · operator stands on shadow side · subject occupies screen-left third · landmark holds left third · negative space on screen-right · profile preferred · 3/4 angle preferred · frontal only when emotionally required.

If composition freedom is allowed, still preserve: subject placement, gaze line, landmark proximity, lighting direction, active references, action timing, lens character.

## Scene asset angle and reference landmark

Scene reference images should be shot at 3/4 side angle, not straight-on — a frontal image is too symmetrical and flat, lacking depth; 3/4 shows front, sides and back of the room at once so the model reads the whole space. Place one obvious reference landmark in the scene (a pillar / a lamp / a sofa), then write every character's position relative to that landmark.

## Handheld camera rule

If handheld is requested, describe it physically: operator breath, micro-settling, weight shift, organic imperfect correction, shoulder-mounted mass, subtle pulse, human correction. Avoid: digital jitter, random shake, gimbal smoothness unless requested, floating drone feel unless requested, mechanical dolly feel unless requested.
