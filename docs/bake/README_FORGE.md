# desk-3d: web build notes for Forge

Built on the box from `desk.blend` by `bake_web.py` → `compress_web.sh`. `build_desk.py` is still the source of truth;
rerun all three after any scene change.

```
web/
  desk.glb                 Draco geometry + KTX2 (Basis) textures, Y-up, metres
  lightmaps/lm_<Group>.ktx2 one 2048² lightmap per light group, all on the same UV2 layout
  lightmaps/manifest.json  groups, files, scale, default intensity, blend formula, env map
  env/room_env.ktx2        1024×512 equirect of the lit room (for reflections only)
  README_FORGE.md          this file
  _build/                  intermediates (raw GLB with PNGs, EXR lightmaps, preview renders). Don't ship it.
```

Loader setup: `GLTFLoader` with `DRACOLoader` (`KHR_draco_mesh_compression`) and `KTX2Loader` (`KHR_texture_basisu`).
Both extensions are required. Use the same `KTX2Loader` for the lightmaps and the env map.
Renderer: `outputColorSpace = SRGBColorSpace`, `toneMapping = AgXToneMapping`, `toneMappingExposure = 1.65`
(that is 2^0.72, matching the Cycles look). Don't add scene lights for diffuse light, because the lightmaps already contain it.

## 1. What is baked, what is live, what is animated

| | what | how |
|---|---|---|
| **Baked** | All diffuse light (direct + bounce) from the 6 light groups | `lightmaps/lm_<Group>.ktx2` on `TEXCOORD_1` |
| **Baked** | Procedural materials (walnut, concrete floor, wall/door paint, rug, brushed-metal roughness) | small textures on `TEXCOORD_0` (≤1024; flat ones became plain factors) |
| **Baked** | City + sky outside the window | one unlit plane `CITY_Backdrop` (emissive texture, 14.5 m behind the glass) |
| **Live** | Emissive surfaces: neon tubes (`NeonCyan`/`NeonMagenta`), `RimMagenta`, bulbs (`Bulb`), `ShelfLEDCyan`, 3 ScreenSlots, rain, duck eyes, backdrop | glTF emissive + `KHR_materials_emissive_strength` (Cycles strengths, not scaled) |
| **Live** | Glass: `WinGlass` (transmission), terrarium dome (`MAT_TerrariumGlass` BLEND α 0.12), `RAIN_Glass` (α 0.03 placeholder) | standard materials; swap in your own shaders |
| **Live** | Speculars / metals | `env/room_env.ktx2` → PMREM → `scene.environment` or per-material `envMap` (see manifest `env.use`) |
| **Animated** | Duck `Quack` morph, key presses (`KEY_*`), rain scroll, light-group fades, screens | yours. Hooks are listed below |

Every mesh that has `TEXCOORD_1` gets the lightmap. Meshes without it are the unlit/emissive/glass ones listed above.
The lightmaps were baked with metals treated as dielectric, so metals do have a lightmap. three.js ignores lightMap on
`metalness = 1`, which is why the env map matters for brass, aluminium and steel.

## 2. Lightmap blending (light switch, lamps, neon)

`lightmaps/manifest.json` → `groups[]`: `{group, file, scale, default_intensity, lights, emissive_materials}`.

```
linear_g      = srgb_to_linear(texel_g) * scale_g          // KTX2 is sRGB-tagged, so three.js decodes it for you
irradiance    = Σ_g linear_g * intensity_g                  // intensity_g: 0 = off, 1 = as in the Cycles renders
```

Lightmaps are 2048² UASTC KTX2 files **without mipmaps** (this saves about 1.8 MB). They are meant to be summed 1:1 into a render target, and you mip that target instead.
Recommended three.js approach: keep one `HalfFloatType` `WebGLRenderTarget` (2048², `generateMipmaps: true`, `minFilter: LinearMipmapLinearFilter`). Whenever an intensity changes
(tween over about 250 ms), redraw it with a fullscreen quad that sums the 6 textures × `scale_g * intensity_g`. Then use it on every lit material:

```js
rt.texture.channel = 1;                  // TEXCOORD_1
mat.lightMap = rt.texture;
mat.lightMapIntensity = Math.PI;         // three's BRDF_Lambert divides by PI; Cycles bake values are radiance per unit albedo
// lightmap KTX2 textures: colorSpace = SRGBColorSpace, flipY = false (KTX2Loader default), channel = 1
```

You can skip the render target by patching the 6 samplers into `onBeforeCompile`. It gives the same formula but costs more per pixel.

| click target | group(s) | also toggle these emissive materials |
|---|---|---|
| `CLICK_Switch_Lights` | `Fill` + `Pictures` (the room circuit) | `ShelfLEDCyan` |
| `CLICK_Lamp_Desk` | `DeskLamp` | `Bulb` on mesh `LampBulb` |
| `CLICK_Lamp_Floor` | `FloorLamp` | `Bulb` on `FloorLampBulb`, `MAT_Linen_Shade` (shade glow) |
| `CLICK_Neon_Sign` | `Neon` | `NeonCyan`, `NeonMagenta`, `RimMagenta` |
| (always on) | `Window` | `MAT_CityBackdrop` |

Note: `Bulb` is shared by both lamps. Clone the material per mesh at load if you want the bulbs independent.
The `Neon` group also contains the glow that the monitor/laptop screens throw on the desk. Turning neon off removes that
glow but not the screens themselves, which stay emissive.

**Light-lift pass (Fury/Shuri review, Oct 8):**
- `Fill` (charcoal pass, Oct 9 ~01:20): four lights, all 3300K desaturated 55 % toward neutral except the 8000K counter-light.
  `LGT_Fill_WarmBounce` (3.6 m area panel under the ceiling, 400 W), `LGT_Fill_CeilingWash` (2.4 m up-facing area, 60 W),
  `LGT_Fill_WarmLow` (25 W point at 0.45 m that lifts the floor and lower walls), `LGT_Fill_Room` (8000K, 10 W).
  The shipped `lm_Fill.ktx2` is then graded once (`_patch/fill_grade.py`, compress step 2b): share x0.50, warm cast neutralised
  (RGB x0.68/1.0/1.18) and a soft shoulder (p 0.40 around the median texel) so the darkest corners keep their fill.
  With `Fill` at 1 the web preview reads charcoal, not brown: lit walls average #433334 (wide) / #342F33 (reverse), floor #332C2B / #2C2A2B,
  darkest 5 % #241D21 / #201C1F. Keep `default_intensity` 1.0. With `Fill` at 0 (light switch off) the room falls back to lamps, neon and window.
- The floor lamp is a real 2700K source (85 W bulb) that lights the floor, rug, chair and left wall. The bulb no longer lights its own shade.
  The shade glow is baked into two textures on `MAT_Linen_Shade`: `MAT_Linen_Shade_base` (base colour) and `MAT_Linen_Shade_emission`
  (emissive, brightest about 60% of the way up the shade and falling off toward the rims), with emissive strength 0.45 (peak kept under ~#FFD9A8 in the web preview).
- 360° completeness: `FrontWall` (glTF z 2.90..3.02), `Ceiling` (glTF y 2.50..2.56), `Baseboard_Front`, `Baseboard_Right_Front` and `Baseboard_Right_Back` (split around the door casing) ship in the GLB. All are charcoal / baseboard material, lightmapped (TEXCOORD_1) and double-sided, so there are no open backfaces or black voids from inside.
- Seams: the floor runs under all four walls, the walls run 2 cm into the floor and 3 cm into the ceiling slab, and the back-wall pieces run into the side walls. The lightmap atlas uses 10 px island margins, a 16 px extend bake margin, 256 spp + OIDN, and a masked smoothing pass on the wall, ceiling and floor islands. Hidden outer faces of the room boxes are collapsed in UV2, and the room surfaces get 2.6× their area share of the atlas.
- Exported base colours are locked (sRGB): walls/ceiling/front wall #3A3236, floor #2E2A2B, walnut #6B4A33 (grain kept, mean locked), brass #B08D57, desk legs + chair base (steel/alu brushed) #1E1E22, white props #E8E1D6 at roughness ≥ 0.6.
- Label textures (book spines, cork cards, plaque, sticky note, mug print) are UASTC + zstd for sharp text on phones. Spines are dark with near-white heavy sans.
- City window lights on `CITY_Backdrop` are small soft point dots (warm + cool, sparse; neon signs and silhouettes unchanged), not chunky orange squares at 400px.
- Lightmap resolution is per group (see `resolution` in `lightmaps/manifest.json`). `DeskLamp`, `FloorLamp` and `Fill` are 2048. The accent groups `Neon`, `Window` and `Pictures` are 1024 to stay under the 10 MB budget. All groups share the same TEXCOORD_1 layout, so sample each one by UV and sum. The render-target size is your choice.
- The room shell is closed, so `RAIN_Streaks` only show through the window opening (outside the glass).
  Fade `MAT_Linen_Shade.emissiveIntensity` between 0 and 1 together with the `FloorLamp` group.

## 3. Tour stops

`STOP_1..7_<Name>_Cam` are empties at the top level. `STOP_n_Marker` is a floor marker at 35% of the way toward the target.
- extras: `fov_mm` (focal length on a 36 mm sensor → `fov = 2*atan(18/fov_mm)` horizontal, or convert to vertical for your aspect), `sensor_mm = 36`, `target_gltf_yup` [x,y,z].
- Orientation: after Blender's Z-up→Y-up conversion, a camera empty looks down its **local −Y**, with **local −Z** as up.
  Either `camera.quaternion = node.quaternion * Rx(−90°)`, or simply `camera.position = node.position; camera.lookAt(...extras.target_gltf_yup)`.

| stop | position (glTF) | target (glTF) | fov_mm |
|---|---|---|---|
| `STOP_1_Desk_Cam` | [0.62, 1.33, 1.22] | [-0.04, 0.98, -0.2] | 30 |
| `STOP_2_Laptop_Cam` | [-0.35, 1.24, 0.78] | [1.4, 0.98, -0.4] | 28 |
| `STOP_3_Bookshelf_Cam` | [-0.4, 1.45, 1.85] | [-1.5, 1.4, 2.12] | 30 |
| `STOP_4_Terrarium_Cam` | [1.42, 1.2, -0.28] | [1.13, 0.99, -1] | 35 |
| `STOP_5_Corkboard_Cam` | [1.4, 1.45, 1.2] | [2.5, 1.43, 0.66] | 32 |
| `STOP_6_Mug_Cam` | [1.05, 1.15, 0.88] | [0.58, 0.83, 0.22] | 35 |
| `STOP_7_Duck_Cam` | [0.52, 1.02, 0.58] | [0.17, 0.85, 0.09] | 35 |

## 4. Click targets (all are top-level empties; the meshes are their children)

| node | meshes under it | light group |
|---|---|---|
| `CLICK_Book_AWS` | 5 | - |
| `CLICK_Book_ClaudeCode` | 5 | - |
| `CLICK_Book_Mongo` | 5 | - |
| `CLICK_Book_Next` | 5 | - |
| `CLICK_Book_Node` | 5 | - |
| `CLICK_Book_React` | 5 | - |
| `CLICK_Book_TS` | 5 | - |
| `CLICK_Book_WordPressPHP` | 5 | - |
| `CLICK_Chalkboard_Career` | 22 | - |
| `CLICK_Duck` | 3 | - |
| `CLICK_Frame_3DRender` | 9 | - |
| `CLICK_Lamp_Desk` | 4 | DeskLamp |
| `CLICK_Lamp_Floor` | 2 | FloorLamp |
| `CLICK_Laptop_3D` | 135 | - |
| `CLICK_Monitor_Projects` | 6 | - |
| `CLICK_Mug_Contact` | 4 | - |
| `CLICK_Neon_Sign` | 6 | Neon |
| `CLICK_StickyNote_NowBuilding` | 1 | - |
| `CLICK_Switch_Lights` | 2 | Fill, Pictures |
| `CLICK_Terrarium_VirtualGarden` | 35 | - |
| `CLICK_Window_Latch` | 2 | - |

## 5. ScreenSlots (swap the texture at runtime)

| node / material | size (m) | default texture | notes |
|---|---|---|---|
| `ScreenSlot_Monitor` | 0.50 × 0.28 | screen_monitor_projects (1024×576) | emissive 1.8, UV 0..1, under `CLICK_Monitor_Projects` |
| `ScreenSlot_Laptop` | 0.314 × 0.194 | screen_laptop_blender (1024×632) | emissive 1.6, in the lid, under `CLICK_Laptop_3D` |
| `ScreenSlot_Frame3DRender` | 0.44 × 0.283 | frame_room_render (1024×660) | print in a frame, emissive 0.15 + lightmapped |

Use the same texture as `map` and `emissiveMap`, with `flipY = false` and `colorSpace = SRGBColorSpace`.

## 6. Keys

65 keyboard keys, named `KEY_<char>`: `KEY_0`, `KEY_1`, `KEY_2`, `KEY_3`, `KEY_4`, `KEY_5`, `KEY_6`, `KEY_7`, `KEY_8`, `KEY_9`, `KEY_A`, `KEY_Alt`, `KEY_B`, `KEY_Backslash`, `KEY_Backspace`, `KEY_C`, `KEY_Caps`, `KEY_Cmd`, `KEY_CmdR`, `KEY_Comma`, `KEY_Ctrl`, `KEY_D`, `KEY_Delete`, `KEY_Down`, `KEY_E`, `KEY_End`, `KEY_Enter`, `KEY_Equal`, `KEY_F`, `KEY_Fn`, `KEY_G`, `KEY_Grave`, `KEY_H`, `KEY_I`, `KEY_J`, `KEY_K`, `KEY_L`, `KEY_LBracket`, `KEY_Left`, `KEY_M`, `KEY_Minus`, `KEY_N`, `KEY_O`, `KEY_P`, `KEY_Period`, `KEY_Q`, `KEY_Quote`, `KEY_R`, `KEY_RBracket`, `KEY_Right`, `KEY_S`, `KEY_Semicolon`, `KEY_Shift`, `KEY_ShiftR`, `KEY_Slash`, `KEY_Space`, `KEY_T`, `KEY_Tab`, `KEY_U`, `KEY_Up`, `KEY_V`, `KEY_W`, `KEY_X`, `KEY_Y`, `KEY_Z`.
Origins sit at the **bottom centre** of each keycap. Keys are top-level nodes with no rotation. A press is a translation of about 3 mm along glTF **−Y**. Keys are lightmapped
in their rest pose, so the 3 mm travel does not visibly break the baked shading.

## 7. Rain

- `RAIN_Streaks`, `RAIN_StreaksFaint`: camera-facing streak quads outside the window, `MAT_Rain` / `MAT_RainFaint` (emissive 0.28 / 0.15).
  Each quad has its own **0..1 UV** (u across the streak, v along it, v=1 at the top), so a shader can scroll `v`, fade the ends or stretch drops.
- `RAIN_Glass`: one quad on the room side of the window glass (1.40 × 1.30 m), `MAT_RainGlass` (α 0.03, nearly invisible).
  It has **full 0..1 UVs** over the whole pane for a droplets-on-glass shader. Its normal faces the room.
- None of the rain is lightmapped, and the neon light was excluded from rain and glass in the bake (light linking), so there are no magenta blobs.

## 8. Duck

`CLICK_Duck` → `Duck_Body`, morph target **`Quack`** (weight 0 = closed, 1 = open bill), `mesh.morphTargetDictionary.Quack`.
The morph is not baked; the lightmap is the closed pose. `DUCK_BeamOrigin` is an empty at the front of the head/bill (duck-local x 0.0745, up 0.0745 m) for your beam or particles.
`MAT_DuckEyes` is cyan emissive at 0.03, so boost it when the duck "listens".

## 9. Other hooks

`TERRARIUM_Soil` (mesh, top surface for a growth effect), `CITY_Backdrop` (unlit plane; replace it with your own sky if you like),
`CLICK_Window_Latch`, `CLICK_Terrarium_VirtualGarden`.

The GLB is a closed room for 360° free-roam: `FrontWall`, `Ceiling`, and `Baseboard_Front` are real charcoal (#23242B-family) meshes with lightmap UV2 (same atlas/groups as the other walls). Materials are double-sided. Looking up or turning around never opens into a black void.
`CITY_Backdrop` stays the unlit city+sky plane outside the window (soft point lights, not chunky squares).
