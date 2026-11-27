# Projection Mapper

A browser app for projection mapping onto a wall. No install, no build step.

## Desktop app (Windows, no install)

Download `ProjectionMapper-windows.zip`, right-click it and choose **Extract All**, then double-click
`Projection Mapper.exe` in the extracted folder. Nothing is installed. It opens in a few seconds.

There is also a single-file `ProjectionMapper.exe`. It unpacks itself on every start, so it shows nothing for
up to a minute before the window appears. Prefer the zip.

**Brick equalizer**: click **+ Brick EQ**. Enter how many bricks across and how many rows are inside the surface,
drag the points until the lines sit on your mortar, then untick **Show brick lines**. Proportions are
standard UK bricks (215 × 65 mm, 10 mm joints, half-brick offset per row).

- The projector window opens fullscreen on the projector by itself. Esc closes it.
- Music-reactive effects follow whatever the laptop is playing (Spotify, YouTube, anything). No setup.
- **Phone remote**: click **Phone remote**, scan the code with your phone. Switch scenes, blackout and brightness from the sofa.
  The phone needs to reach the laptop: same Wi-Fi, or a Bluetooth link (turn on Bluetooth tethering on the phone and join it
  from Windows Bluetooth settings). No phone app and no internet needed. Allow network access if Windows asks.
- Layouts and media are kept in your Windows user profile, so they survive restarts.
- Windows may show a "Windows protected your PC" warning the first time, because the app is not code-signed. Choose **More info**, then **Run anyway**.

Both are built by the "Projection Mapper desktop build" GitHub Action (download it from the run's Artifacts),
or locally with `npm install` then `npm run dist`. `npm start` runs it without packaging.

## Run it in a browser instead

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
- `desktop/`, `package.json`: the desktop shell (Electron)
