# desk-3d

A cozy, rainy evening room you can look around in the browser. Built with React, Vite,
react-three-fiber, drei and @react-three/postprocessing.

**Live:** https://roiyot26.github.io/desk-3d/

![Desk 3D screenshot](docs/screenshot.png)

## What's in it

- **Interior camera.** Eye height 1.4 m, 26 mm-equivalent lens. A 26 mm full-frame lens has a 69.4° horizontal FOV, so we keep that on landscape screens (about 42–47° vertical `fov` at 16:9–16:10) and clamp portrait screens to 60° vertical. Drag to look around within a limited arc and scroll to step closer. There is no pan, and the camera is kept inside the walls. When idle it drifts gently instead of spinning.
- **Rain.** The window pane gets a GPU shader with misty glass, beads, and running drops that leave trails. Every frame, the city behind the glass is rendered at half resolution into a mip-mapped target. Mist reads a blurred mip, while drops and trails refract a sharp image. Behind the glass, instanced GPU streaks fall through the city layer. Blender's static rain cards are hidden (`KEEP_GLB_RAIN` in `src/Room.tsx`).
- **Light.** Blender lights aren't exported, so lights are placed from what the model contains: a warm 2700K shadowed spot at the desk-lamp bulb, a warm point light at each other bulb, small neon accents, a cool window fill, and a soft warm ceiling bounce. Shadows are soft PCF and render once (the room is static).
- **Post.** N8AO ambient occlusion, then bloom (HDR above 1.0, so only neon, bulbs and city signs glow), AgX tone mapping, a teal-shadow / warm-highlight split tone, a small saturation and contrast lift, vignette, light film grain, and SMAA.
- **Performance.** DPR is capped at 2 (1.5 on the low tier) and adapts down under load. Phones, low-power devices and `prefers-reduced-motion` get a light tier: no AO, no grain, cheaper bloom, fewer rain streaks, and slower or no camera drift. Force a tier with `?quality=low` or `?quality=high`.

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
- Baked lighting: `aoMap`/`lightMap` on UV2 are left as exported. When they are present (or with `?baked=1`), the live lights dim to accents and AO post is skipped.

`node scripts/inspect-glb.mjs public/desk.glb` prints the nodes, materials and bounds of a GLB.

## License

MIT
