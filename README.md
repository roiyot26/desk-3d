# desk-3d

Roi Yotvat's 3D portfolio: a cozy, rainy evening room you can walk through in the browser.
Built with React, Vite, react-three-fiber, drei and @react-three/postprocessing.

**Live:** https://roiyot26.github.io/desk-3d/ · **Plain version:** https://roiyot26.github.io/desk-3d/?view=list

![Desk 3D screenshot](docs/screenshot.png)

## Portfolio interactions

- **Loader → Enter.** `index.html` paints `public/poster.jpg` (a still of the room, ~58 KB) before any JS runs. Over it, a coding-agent style log ticks through real progress: download first, then shader warm-up ("plugging in the monitor ✓", "convincing the rain to fall 72%"). When the room is ready, the log waits for **Enter** (button or the Enter key; this click is also what unlocks audio) or **Just the résumé →** (the plain page).
- **Recruiter lane.** **Just the résumé →** sits in the top-right corner the whole time, next to the secrets counter and the mute button. Phones (a mobile user agent or a screen narrower than 600 px) open the plain page first, with a poster and an **Enter the 3D room** button. `?view=room` forces the room, and `?view=list` forces the page.
- **Tour.** The cold open has **Start the tour**. There are seven numbered, glowing markers, aligned to Wanda's `STOP_1..7` (`forge_manifest.json`): 1 desk/monitor (who I am + projects carousel), 2 laptop + 3D frame (3D for the web), 3 bookshelf (stack), 4 terrarium (Virtual Garden), 5 cork board (career path), 6 mug (contact), 7 rubber duck (Ask the Duck). Each stop flies to Wanda's Blender camera for it (`STOP_<n>_*_Cam`, see below). Next/Back and ←/→ move between stops; deep links are `#stop-1`..`#stop-7` (plus aliases such as `#duck`). **Free roam**, Escape, the × button or a click on the room closes the panel. A progress row of 7 dots tracks visited stops. Seeing all seven shows a small "you've seen the room" card. Bonus objects stay outside the tour (a ★ appears only after one is found).
- **Ask the Duck (tour stop 7).** Click the rubber duck (`CLICK_Duck`), marker 7, or open `#stop-7` / `#duck`. It opens a small chat with 13 preset chips and a text box. Free text is fuzzy-matched to the closest preset (keywords, word overlap and Damerau-Levenshtein edit distance, so `raect` / `recat` still find React). Desktop shows 5 chips + **More questions**; phones show one scrolling row of 3 with a pinned **More questions** chip that opens all 13. There is no model and no backend. A monospace ticker shows the tool calls (`search_portfolio("AI project") → 2 sources`, `fly_to("monitor")`, `open("retrieval-tracer")`). A thin cyan beam (a 3 mm tube mesh, not GL lines, so it renders on software GL too; 40% opacity, gone after ~1.5 s) runs from `DUCK_BeamOrigin` to each cited object, which gets a slim pulsing ring. The duck quacks (sound + the `Quack` shape key), and `MAT_DuckEyes` glows while it "thinks". Then the camera flies to the answer and opens its panel, and the reply stays in a small card with **Back to the duck**.
  - The interface is `AnswerEngine.ask(question) → { steps, reply, tools[] }` in `src/duck/engine.ts`. `ScriptedIntentEngine` implements it, and a real model behind a server can replace it later without UI changes.
  - The tools are whitelisted: `search_portfolio`, `fly_to`, `open`, `show_contact`, `quack`, `set_lights`, `set_weather`, `set_mode`, `set_audio`. The presets and their tool calls live in `content.json → duck.intents`. Personal questions (age, salary, address…) get a polite deflection.
- **Light switches & rain.** `CLICK_Switch_Lights` toggles the room circuit (bake groups `Fill` + `Pictures`, plus the `ShelfLEDCyan` strip). The wall switch is off-screen from the default view, so the HUD has the same control: the **bulb button** next to mute (filled = on). The HUD button doesn't count as the "Flipped a light" secret; the switch and the lamps do. `CLICK_Lamp_Desk` and `CLICK_Lamp_Floor` each toggle one lamp, and the bulbs' emission follows. Switches ramp over ~250 ms. `CLICK_Window_Latch` stops or starts the rain: drops dry up on the glass and the streaks fade. `CLICK_Neon_Sign` makes the `</>` sign blink. The neon stays on with the lights off.
- **Typing + agentic mode (desktop).** Typing anywhere outside a text field presses the matching `KEY_*` mesh on the 3D keyboard, with a click sound. Shifted symbols press their base key. If a key mesh is missing, typing still works, just without movement. Typing `claude` starts **agentic mode** for 9 s: room lights dim to 35%, the neon pulses, the duck's eyes glow and the hum gets louder.
- **Secrets found x/6** (HUD, kept in `sessionStorage`). They are: talk to the duck, type `claude`, flip a light (wall switch or a lamp), stop the rain with the window latch, poke the neon sign, and finish the tour. Finding all six shows a small card. The list is in `content.json → secrets`.
- **Art.** The two artworks are non-interactive decor: no hover label, no caption, no click handling, no stops, placards or secrets.
- **Deep links.** `#stop-1` … `#stop-6`, plus aliases `#projects`, `#3d`/`#goal`, `#skills`/`#stack`, `#garden`, `#career`, `#contact`, and `#project-<slug>` / `#skill-<id>`. Links open after Enter.
- **Plain version.** `?view=list` renders the same content as a fast, printable HTML page. It is also the automatic fallback when WebGL is missing or fails twice, and a static copy is baked into `<noscript>` at build time for crawlers.

### Sound

The sounds are small, loaded lazily (nothing is fetched before Enter), and the mute button is always visible. The mute choice is kept in `localStorage`.

| File | Use | Size |
| --- | --- | --- |
| `public/audio/rain.mp3` | rain-on-glass loop; louder the closer the camera is to the window, silent when latched | 50 KB |
| `public/audio/lofi.mp3` | quiet lofi loop (Fmaj7–Em7–Dm7–Cmaj7, 72 bpm); the duck's "Play some music" toggles it | 80 KB |
| `public/audio/hum.mp3` | neon hum, only audible near the sign | 8 KB |
| `public/audio/key.mp3` | key click (pitch-jittered); also the switch click | 1 KB |
| `public/audio/quack.mp3` | the duck | 2 KB |

**License: CC0 1.0 (public domain).** Every sound is synthesized from scratch by `scripts/make-sounds.py` (numpy + ffmpeg). No samples or third-party recordings are used. Run `python3 scripts/make-sounds.py` to regenerate them.

### Content: `src/content/content.json`

Every word on the site lives in one file: bio, projects, skills, career, contact, panel copy, hover labels, tour buttons, loader lines, toasts, secrets and the duck's presets. The 3D panels, the hover labels, the list page and the `<noscript>`/meta tags all read from it. Contact has GitHub and LinkedIn. `contact.email` is a slot that stays hidden until `enabled: true` and an address are set.

### The model contract (Wanda's portfolio GLB)

`src/targets.ts` holds the map. Every interactive object is a top-level **empty named `CLICK_<Thing>`** with its meshes as children, and a raycast hit walks up the parents to the nearest registered node.

| Node | Does |
| --- | --- |
| `CLICK_Monitor_Projects` | stop 1. `ScreenSlot_Monitor` shows Wanda's projects grid; while stop 1 is open it shows the carousel's project. |
| `CLICK_Laptop_3D`, `CLICK_Frame_3DRender` | stop 2 (`ScreenSlot_Laptop` / `ScreenSlot_Frame3DRender` keep their images) |
| `CLICK_Book_<ClaudeCode/React/Next/Node/TS/Mongo/AWS/WordPressPHP>` | stop 3; a book highlights its skill |
| `CLICK_Terrarium_VirtualGarden` | stop 4 (`TERRARIUM_Soil` is reserved for the later sprouts feature) |
| `CLICK_Chalkboard_Career` (the cork board) | stop 5 |
| `CLICK_Mug_Contact` | stop 6 |
| `CLICK_Duck` (+ `DUCK_BeamOrigin`, shape key `Quack`, `MAT_DuckEyes`) | stop 7: Ask the Duck |
| `CLICK_StickyNote_NowBuilding` | "now building" aside |
| `CLICK_Switch_Lights`, `CLICK_Lamp_Desk`, `CLICK_Lamp_Floor` | light groups (desk / floor / ambient) |
| `CLICK_Window_Latch` | rain on/off |
| `CLICK_Neon_Sign` | neon blink |
| `STOP_1..7_*_Cam` | tour cameras (7 = duck). The camera sits at the node and looks at `userData.target_gltf_yup`, with a horizontal FOV of `2·atan(sensor_mm / 2 / fov_mm)`. The FOV is widened so the shot fills the part of the screen the panel leaves free. Without a target, the node looks down local −Y with −Z up (`node.quaternion · Rx(−90°)`). |
| `KEY_*` (65 keys) | typing |
| `RAIN_Streaks`, `RAIN_StreaksFaint` | static rain cards. They are hidden while the GPU rain runs and come back if auto-quality turns the particles off. The latch hides them too. |

On purpose, the page ignores `STOP_8_Art_Cam` / `STOP_8_Marker` and hides every `PLACARD_*` node (no art stop, no placards). `STOP_<n>_Marker` empties are floor-level stand points, so the numbered markers stay anchored above each `CLICK_*` object.

Missing nodes are skipped silently: no marker, no hit area, and the panel stays reachable from the dots, deep links and list. Name fallbacks remain only for optional things that aren't `CLICK_*` in the export. The two artworks (`Poster_*`/`PosterFrame_*`, `ArtPan*`) are deliberately not targets: plain decor. If `CLICK_Duck` is missing, a procedural `PLACEHOLDER_Duck` with `MAT_DuckEyes` and a beam origin is added on the desk (`src/placeholders.ts`). Small objects get an invisible, larger hit box.

**Light groups.** `src/LightMixer.tsx` holds one level per group (desk, floor, ambient, neon, plus the duck's eyes) and ramps it on a switch. With the bake package the levels drive the lightmap blend (below). Without it, Blender lights aren't exported, so the web lights mirror the bake groups: desk = `LGT_DeskLamp_*`/`LGT_Key_Lamp*`, floor = `LGT_FloorLamp_*`, neon = `LGT_Neon_*`, ambient = `LGT_Fill_*` + `LGT_Window_*` + `LGT_Picture_*`. The `Bulb` material shared by both lamps is cloned per lamp first, so they switch separately.

### Baked lighting (Wanda's web package)

The page has two lighting paths and picks one at build time:

- **Baked** when `public/bake/lightmaps/manifest.json` exists and is valid.
- **Live** otherwise: today's live lights on the unbaked `public/desk.glb`. `?bake=0` forces this path on a baked build, for comparison.

**Drop path.** Copy Wanda's `web/` folder into `public/bake/` 1:1, without `_build/` or `README_FORGE.md`:

```
public/bake/desk.glb                    Draco + KTX2 room (used instead of public/desk.glb)
public/bake/lightmaps/manifest.json     the switch: groups, scales, env
public/bake/lightmaps/lm_<Group>.ktx2   DeskLamp, FloorLamp, Fill, Window, Neon, Pictures
public/bake/env/room_env.ktx2           reflections only
```

Then rebuild (`npm run build`, or reload `npm run dev`). No code changes are needed. Keep `public/desk.glb` as the fallback: if the bake package fails to load, the room drops back to the live path instead of the plain page. The manifest is inlined at build time (`import.meta.glob` in `src/bake/assets.ts`), so a site without the package never requests a missing file. In dev, Vite logs "Assets in public directory cannot be imported" for that glob. It's harmless.

**How it works** (`src/bake/`, following `README_FORGE.md`):

- **Loaders.** `GLTFLoader` gets `DRACOLoader` (`KHR_draco_mesh_compression`, glTF-only decoder) and one shared `KTX2Loader` (`KHR_texture_basisu`), which also loads the lightmaps and the env map. The decoders come from the installed three.js (`three/examples/jsm/libs/{draco,basis}`). Vite bundles them as hashed assets in `dist/assets/`, so they always match the three version. There's no CDN and nothing vendored. The wasm is only fetched when a Draco/KTX2 asset needs it.
- **Lightmap blend.** The six 2048² lightmaps are summed into one `HalfFloatType` render target (mipmapped, 1024² below the high tier) by a fullscreen quad: `Σ lm_g × scale_g × intensity_g`. The quad redraws only when an intensity changes. Every mesh with `TEXCOORD_1` gets `lightMap = rt.texture` (channel 1) and `lightMapIntensity = π`. If a material is shared with a mesh that has no UV2, the material is cloned first. Without float render targets, an 8-bit target with a pre-divided sum is used.
- **Switches.** `CLICK_Switch_Lights`/HUD bulb → `Fill` + `Pictures` (+ `ShelfLEDCyan`). `CLICK_Lamp_Desk` → `DeskLamp` (+ `Bulb` on `LampBulb`). `CLICK_Lamp_Floor` → `FloorLamp` (+ `Bulb` on `FloorLampBulb`, `MAT_Linen_Shade`). `CLICK_Neon_Sign` → `Neon` (+ `NeonCyan`, `NeonMagenta`, `RimMagenta`). `Window` is always on. Emissives keep Wanda's Cycles strengths, and the shared `Bulb` is cloned per lamp. Agentic mode dims the lamps and the circuit and pulses `Neon`, the same as on the live path.
- **Env.** `env/room_env.ktx2` → one blit (KTX2 keeps the top row at v = 0, and Blender centres the panorama on −Z) → PMREM → `scene.environment` at `env.scale × 0.5`. It's used for reflections only.
- **Renderer.** sRGB output, AgX, exposure 1.65. No diffuse scene lights are added, because the lightmaps already contain them. Shadow maps and the AO pass are off. A dark unlit plane closes the ceiling.

### Resilience

- Software GL (SwiftShader, llvmpipe) starts on the **low** tier: no post, no shadows, Lambert materials.
- A shader link failure or a lost WebGL context remounts the room on the low tier. A second failure switches to the plain page.
- **Auto quality.** Under 30 fps for 3 s steps down: post off → rain particles off → DPR 1 (off when `?quality=` forces a tier).
- `three` is aliased to `src/three-shim.ts`, which swaps the deprecated `THREE.Clock` that react-three-fiber v8 creates for a `THREE.Timer`-backed one. Nothing reads pixels back per frame.

## What's in it

- **Interior camera.** Eye height 1.4 m, 26 mm-equivalent lens. A 26 mm full-frame lens has a 69.4° horizontal FOV, so we keep that on landscape screens (about 42–47° vertical `fov` at 16:9–16:10). Portrait screens get up to 72° vertical and their own framing, so the desk and the window both fit. Drag to look around: the room follows the cursor. Scroll to step closer. There is no pan, and the camera is kept inside the walls. When idle it drifts gently instead of spinning.
- **Rain.** The window pane gets a GPU shader with misty glass, beads, and running drops that leave trails. Every frame, the city behind the glass is rendered at half resolution into a mip-mapped target. Mist reads a blurred mip, while drops and trails refract a sharp image. Behind the glass, instanced GPU streaks fall through the city layer. Blender's static `RAIN_*` cards stand in only when the particles are off (`KEEP_GLB_RAIN` in `src/Room.tsx`).
- **Light.** Blender lights aren't exported, so lights are placed from what the model contains: a warm 2700K shadowed spot at the desk-lamp bulb, a warm point light at each other bulb, small neon accents, a cool window fill, and a soft warm ceiling bounce. Shadows are soft PCF and render once (the room is static).
- **Post.** N8AO ambient occlusion, then bloom (HDR above 1.0, so only neon, bulbs and city signs glow), AgX tone mapping, a teal-shadow / warm-highlight split tone, a small saturation and contrast lift, vignette, light film grain, and SMAA.
- **Performance.** DPR is capped at 2 (1.5 below the high tier). Phones and low-power devices get the medium tier: no AO, no grain, no SMAA, cheaper bloom, fewer rain streaks. `prefers-reduced-motion` turns off the drift and the camera eases. Force a tier with `?quality=high|medium|low`.

## Run locally

```bash
npm i
npm run dev
```

## Swapping the model

`public/desk.glb` is a replaceable asset. Drop in a new export with the same name and the page adapts. Mesh names are hints only, and each one has a geometric fallback:

- The room bounds come from wall and floor meshes (they keep the camera inside).
- The window pane is found by name (`glass`/`pane`), a transmission material, or a transparent material. If there's no pane, a rain overlay plane is placed in the `Win*`/`Window*` frame opening.
- Lamps come from emissive `*Bulb*` meshes and neon from emissive `*Neon*`/`*LED*` meshes.
- Anything outside the room (city, sky) is drawn in the window pass behind the glass.
- Baked lighting: Wanda's lightmap package goes in `public/bake/` (see **Baked lighting** above). On the live path, `aoMap`/`lightMap` on UV2 are left as exported. When they are present (or with `?baked=1`), the live lights dim to accents and AO post is skipped.

`node scripts/inspect-glb.mjs public/desk.glb` prints the nodes, materials and bounds of a GLB.

## License

MIT
