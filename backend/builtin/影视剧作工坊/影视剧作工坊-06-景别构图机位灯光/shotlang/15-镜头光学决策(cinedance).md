# Optics and lens control

> **落位说明**（并入影视剧作工坊时添加，正文保留原文）
> 来源：cinedance · 电影级导演 skill
> 原文文件名：`optics(cinedance镜头光学决策).txt`
> 链路归位：见第四批提取索引 `INDEX.md`（镜头→光影→物理→分镜连续→提示词→声音BGM→连续性）

Seedance responds better to observable lens results than to camera metadata. Do not rely on millimeters, f-stops, ISO, lens brand names, or vintage lens model names as primary control. Prefer: diagonal field of view in degrees, physical camera distance, visible optical outcome, content-FOV alignment.

Use these FOV anchors: 8° · 18° · 29° · 47° · 84° · 107°.

Avoid as primary control: 85mm, 35mm, f/1.4, ISO 800, Cooke S4, Master Prime, Helios, K35, Laowa, Sigma.

## Lens decision tree

Silently choose the lens character by content type before writing.

**Face portrait:**
- close intimate face with environment visible → 84° Cuarón intimate-wide
- medium portrait → 29° short telephoto portrait
- tight emotional close-up → 18° classic telephoto
- distant hidden observation → 8° super-telephoto observation with foreground occlusion

**Environmental action:**
- natural documentary action → 47° standard normal
- wide environmental action → 84° classic wide
- large-scale environmental geography → 107° wide rectilinear
- extreme environmental immersion → 135° wide environmental pattern only if the whole beat is environmental action

**Detail or macro:**
- standard detail → 29° or 18°
- detail inside a wide environment → SNAKE CAM style only if explicitly needed
- avoid mixing macro detail with wide environmental action in one beat unless using a named technique

**Observation at distance:**
- sports broadcast, paparazzi, wildlife observation → 8° super-telephoto observation
- compressed surveillance portrait → 18° or 8° telephoto with foreground occlusion and atmospheric haze

## Content-FOV alignment rule

The lens choice must match the shot content. Wide-angle works when the content is environmental, spatial, physical, immersive, or body-near-camera. Telephoto works when the content is portrait, observation, isolation, compression, or distant watching. Macro/detail works as its own insert beat.

Do not mix incompatible content classes inside one lens beat — face portrait plus environmental geography plus macro detail in the same beat causes lens drift. If the scene needs different content classes, use controlled internal cuts and assign a separate lens character to each shot.

## Angle-of-view language bank

Use one of these blocks inside the Optics or Camera section.

### 47° Standard normal

```text
47° diagonal field of view, standard normal lens character, camera 3 to 5 meters from subject, natural human-eye perspective. Zero obvious distortion, natural face and body proportions, comfortable depth of field, background readable but not exaggerated, classic grounded cinema framing.
```

### 84° Classic wide

```text
84° diagonal field of view, classic wide-angle lens character, camera 1 to 1.5 meters from subject, slight low angle if needed. Wide-angle lens with strong but natural perspective expansion, foreground body presence feels larger and closer, environment remains visible to the frame edges, deep readable spatial context, straight architectural lines stay rectilinear, no fisheye curve.
```

### 107° Wide rectilinear

```text
107° diagonal field of view, wide rectilinear lens character, camera 0.5 to 0.8 meters from foreground subject. Immediate foreground looms large, surrounding environment spreads wide to all frame edges, deep edge-to-edge focus, straight lines remain straight, subtle chromatic aberration near frame edges, no circular vignette, no fisheye bubble.
```

### 29° Short telephoto portrait

```text
29° diagonal field of view, short telephoto portrait lens character, camera 4 to 6 meters from subject. Close framing achieved through lens reach, not physical proximity. Subject is razor-sharp, background begins to compress closer behind them, face proportions are flattering and stable, background dissolves into creamy soft bokeh, subject pops clearly from the environment.
```

### 18° Classic telephoto

```text
18° diagonal field of view, classic telephoto lens character, camera 6 to 8 meters from subject. Strong background compression, distant elements appear stacked closer behind the subject, razor-thin focus isolates the eyes and key facial features, foreground and background melt into soft bokeh, the image feels observed from a distance.
```

### 8° Super-telephoto observation

```text
8° diagonal field of view, super-telephoto observation lens character, camera 20 to 25 meters from subject. Extreme background compression, background flattened into a soft color wash, only the subject is sharp, everything else dissolves into creamy bokeh. The image feels like distant paparazzi, wildlife documentary, or sports-broadcast observation. Foreground occlusion is mandatory: blurred foreground objects occupy the lower 30 to 45 percent of frame as oversized dark bokeh shapes, framing the subject from far away.
```

## Telephoto visual outcome stack

For any telephoto shot, include at least 4 of these observable phrases: background completely blurred into a soft warm color wash · razor focus on the subject · only the subject is sharp, everything else is soft · creamy bokeh wash behind the subject · background compressed flat behind the subject · the subject pops sharply against a dissolved background · close framing achieved through lens reach, not physical proximity · camera positioned far from the subject in physical space · atmospheric haze suspended between camera and subject · foreground occlusion frames the subject as soft dark bokeh.

## Wide-angle visual outcome stack

For any wide-angle shot, include at least 3 of these observable phrases: foreground body presence looms larger than natural · environment remains visible around the subject · deep edge-to-edge focus · straight lines stay rectilinear · wide spatial context visible to frame edges · camera physically close to subject · immersive close perspective · no telephoto compression · no creamy portrait bokeh unless explicitly wanted.

## Multi-shot lens consistency

If the sequence has internal cuts, define lens character per shot.

Same-lens multishot:

```text
LENS IS X° ACROSS ALL SHOTS. NOT NEGOTIABLE.
Each shot opens with: LENS LOCK SHOT A = X°.
Each shot closes with: LENS CHECK SHOT A: X° maintained, no drift.
```

Mixed-lens multishot: each shot gets its own lens character only if the content type changes. Hard cuts only between different lens characters. No smooth FOV transitions. No random lens drift inside a shot. No changing lens character unless a new shot begins.

Every internal cut preserves: active characters, location geography, screen direction, gaze line, body orientation, lighting direction, prop state, wound state, blood/snow/dirt continuity, world physics.

## Anti-drift locks

Use only when relevant.

Telephoto:

```text
No part of this shot becomes wide-angle or normal-lens coverage. Wider framing is achieved by the camera being farther away with the same long-lens reach, not by switching lenses. The background remains compressed and dissolved in every frame.
```

Wide-angle:

```text
No part of this shot becomes telephoto portrait coverage. The environment stays visible around the subject, the camera remains physically close, and the image keeps wide-angle spatial expansion with deep readable context.
```

Normal lens:

```text
No extreme wide distortion, no telephoto compression. The image stays natural, grounded, and human-eye neutral.
```

## Optics anti-patterns

Do not write: extreme/ultra/super wide-angle lens · "wide shot" as a lens instruction · "establishing shot" as a lens instruction · zoom out plus wide-angle · tight wide framing · f-stop, ISO or lens-brand metadata as primary control · compound camera movements in the same shot · mixed content classes inside one beat · negative-only lens control.
