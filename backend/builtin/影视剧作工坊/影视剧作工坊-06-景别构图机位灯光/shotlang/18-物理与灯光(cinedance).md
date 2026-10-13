# Physics, lighting, audio, references and style

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：cinedance · 光线保持与灯光约束（物理真实性校验的灯光侧）
> 原文文件名：`physics-lighting(cinedance物理与灯光).txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

## Physics lock

Every object and body has physical properties. Enforce: gravity, mass, inertia, friction, contact, weight transfer, ground pressure, collision, follow-through, cloth delay, hair delay, liquid flow, blood viscosity, snow accumulation, fire heat shimmer, vehicle mass, door hinge resistance, weapon weight.

Motion must have cause and effect. No floating bodies, no weightless weapons, no frictionless feet, no teleporting, no impossible object movement, no rubbery CG motion, no fake game-engine physics.

**Walking:** heel contact, weight transfer, hip shift, toe push-off, body mass settling.
**Running:** real ground contact, knee lift, opposing arm swing, torso lean, varied stride, no floaty CG-running look.
**Weapons/props:** arm carries visible weight, wrist angle reacts to mass, object has inertia, motion has acceleration and deceleration, the object does not teleport between poses.
**Liquids:** blood clings, drips, smears, pools, stains and follows gravity; droplets travel in parabolic arcs; wet contact leaves visible residue; flow has viscosity and direction.
**Snow, smoke, fire, dust, particles:** particles move with wind direction; exist in foreground, midground and background if atmosphere is critical; objects accumulate particles over time; heat creates shimmer where hot air meets cold.

## Scale reference objects

When the shot must communicate absolute size, never write bare numbers — the model does not read "30 meters". Put a viewer-familiar reference object in the frame as visual proof of scale:

```text
· Giant: his palm is as wide as a car; his head rises into the darkness of the roof
· Colossus: a human figure standing beside it only reaches its ankle
```

Principle: do not just tell the model "it is huge" — place evidence in the frame that makes the size self-evident.

## Lighting priority lock

Lighting is not style decoration — it is a priority constraint.

Backlit contre-jour:

```text
Subject stays between camera and the brighter background.
Camera stays on the shadow side of the subject.
Faces remain in deep shadow unless explicitly lit.
Only rim light, edge light, wet speculars, eye glints, and environmental bounce reveal detail.
No frontal key.
No flat exposure.
No beauty fill.
No studio light unless requested.
```

If previous generations came out flat, strengthen:

```text
The entire shot is exposed for the backlight, not for the face.
The face is allowed to fall into crushed shadow.
The silhouette and rim contour carry the image.
```

## Lighting direction

Always define: primary light source, light direction, camera side relative to light, subject side in shadow or rim, background brightness, exposure priority, allowed highlights, forbidden lighting failure.

```text
The camera stays on the shadow side of @HERO4. Morning sun comes from camera-right, behind and to the side of him, creating gold rim light along his shoulders and head while his camera-facing back stays dark. No flat front light, no beauty fill.
```

## Dialogue rules

Only the quoted scripted line is spoken. No extra words, no ad-libs, no subtitles, no captions, no narration unless requested, no character names spoken unless inside the provided dialogue, no offscreen voices unless explicitly specified. Lips are still when not speaking.

Clean dialogue: ambient sound ducks under dialogue; voice is close, clean, emotionally controlled. If silence framing is needed: at least 1 second of silence before and after each spoken line. If immediate speech is required: the line begins within the first 0.3 seconds of the main shot.

Prior audio context (emotional continuity only): `Prior audio context only, not visual content: "line."` — never visualize names, people or objects from prior audio unless active in this shot.

## Voice asset

Give each major character a fixed voice description (timbre / pace / accent / emotion) and re-insert it before every line they speak. Test a few generations until pitch, pace and accent stop drifting, then freeze it as an official asset.

```text
VOICE ASSET — @CHARACTER
"A low, gravelly baritone, slow deliberate pace, a hint of East London street accent,
 calm with menace underneath — the angrier he gets, the softer he speaks."
```

Note: this locks the voice *characteristics*, not a repeated line. The character still says fresh dialogue each time; only the fixed voice text is reused.

## Reference control hierarchy

**Identity reference controls:** face, body, age, proportions, costume, unique anchors.
**Location reference controls:** architecture, materials, geography, atmosphere, landmarks, lighting direction if relevant.
**Prop reference controls:** shape, scale, material, hand contact, state.
**Vehicle reference controls:** model, decals, plate, doors, position, movement, damage, reflections.

Never let a location reference override the required camera angle unless requested. Never let style references override identity, spatial blocking, action, optics, or lighting.

## Character asset set (multi-state + headless full-body)

To hold a character's identity across shots, build an asset set per character instead of relying on a single reference:

```text
CHARACTER ASSET SET — @CHARACTER
  1) HD face close-up: the ONLY source the model reads the face from (primary reference)
  2) Front full-body: head cropped off — used only for body type / costume / proportions
  3) Back full-body: locks the back silhouette and profile
```

Separate state versions: normal / injured / costumed each get their own images and are never mixed. In wide shots the model must never extract facial features from a blurry full-body face — force it to read only the face close-up, or the identity drifts toward a known celebrity.

Local changes (a scar, a costume swap): generate only that small patch separately (Jimeng / Nano Banana), then composite it back with a PS mask so the original skin texture survives. Principle: more generations = worse image — when something breaks, fix only the local part, never regenerate the whole frame.

## Style language

Style must support control, not replace it. Place style references after spatial, optics, action and lighting locks.

Good: `Kodak Vision3 500T, naturalistic low-key backlit silhouette, real grain, grounded physical cinema texture.`

Compact style anchors when helpful: Lubezki natural-light handheld · Deakins controlled silhouette · Cuarón intimate wide · Bergman profile face acting · Refn slow-walk minimalism.

Avoid: purely poetic mood language, vague cinematic adjectives without physical instructions, style references that contradict camera or lighting, overloaded DP name chains.
