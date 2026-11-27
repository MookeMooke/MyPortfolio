# Projection Mapper

A browser app for projection mapping onto a wall. No install, no build step.

## Run it

Use Chrome or Edge on the laptop that is plugged into the projector.

- Hosted: open `projection-mapper/` on the site this repo is published to.
- Local: run `python -m http.server` in this folder and open `http://localhost:8000`.

Opening `index.html` by double-click does not work reliably. Use one of the two options above.

## Use it

1. Click **Open projector window**. Move it to the projector screen if needed, then click it for fullscreen.
2. **Add surface** and drag its points to fit the object on the wall.
3. Raise **Grid** for curved things or corners.
4. Choose **Content**: image, video, slideshow, effect, clock, weather.
5. **Add mask** to black out an area.
6. Add **Scenes** for different looks on the same shapes. Keys 1 to 9 switch them.

Keys: arrows nudge 1 pixel (Shift = 10), Tab = next point, G = guides, T = test pattern, B = blackout, Ctrl+Z = undo.

## Start automatically with Windows

`output.html` shows the last scene by itself, without the editor. Put a shortcut like this in the Startup folder
(`Win+R`, then `shell:startup`), using your own address:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk https://YOUR-SITE/projection-mapper/output.html
```

## Good to know

- Everything is saved in the browser on that laptop. **Export** saves the layout to a file; media files are not included.
- Music-reactive effects use the microphone or PC sound (choose in the top bar).
- Weather uses open-meteo.com and needs internet.
- Videos play muted.

## Files

- `index.html`, `js/editor.js`: the control screen
- `output.html`, `js/output.js`: the projector window
- `js/renderer.js`: mesh warp, WebGL drawing, masks and guides
- `js/effects.js`: effect shaders
- `js/store.js`: project data, saving, sync between windows, media library
- `js/audio.js`, `js/widgets.js`: sound analysis; clock, weather, slideshow
