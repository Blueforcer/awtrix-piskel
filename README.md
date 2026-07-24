AWTRIX Piskel
=============

A fork of [Piskel](https://github.com/piskelapp/piskel) (Apache-2.0) turned
into the icon editor embedded by the
[AWTRIX NG](https://github.com/Blueforcer/awtrix-ng) web UI. The AWTRIX page —
same-origin with the clock — loads this editor in an `<iframe>` and brokers
every save/load over the clock's `/api/v1/files` API; the editor only draws
and exchanges image bytes over postMessage (`src/js/embed-bridge.js` documents
the message contract).

Modifications relative to upstream (per the Apache-2.0 notice requirement):

- **Layout**: one symmetric "instrument panel" shell for every screen size —
  56px tool rail (colors pinned sticky at the bottom), centered canvas stage,
  56px menu rail with a sheet-style settings drawer, horizontal frames dock at
  the bottom with the FPS/onion row. The animated-preview minimap, layers,
  transformations, palettes list, zoom readout and debug header are removed.
  (`src/css/awtrix-layout.css`, `src/css/awtrix-theme.css`, `src/index.html`,
  `DrawingController.getAvailableWidth_/Height_`.)
- **Touch**: one finger draws (page no longer scrolls under the stroke), two
  fingers pinch-zoom/pan, touches outside the canvas scroll natively
  (`DrawingController` touch handlers, registered `{passive:false}`).
- **AWTRIX panel**: the Save icon opens Save-to-clock / Open-from-clock /
  Live-preview (`controller/settings/AwtrixController.js`,
  `templates/settings/awtrix.html`); Piskel's save and import drawers are
  removed. Sprites start at 32×8 and the resize panel is two fixed matrix-size
  buttons, 8×8 and 32×8.
- **Theming**: light/dark skin driven by the host via `?theme=` / postMessage
  (`data-theme` on `<html>`), including the canvas letterbox painted by
  `FrameRenderer` (`--awx-letterbox`).

Build as upstream: `npm install && npm run build` → static site in
`dest/prod/`. Everything below is the original Piskel README.

---

Piskel 
======

[![E2E Tests](https://github.com/piskelapp/piskel/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/piskelapp/piskel/actions/workflows/ci.yml)

Piskel is an easy-to-use sprite editor. It can be used to create game sprites, animations, pixel-art...
It is the editor used in **[piskelapp.com](https://www.piskelapp.com)**.

<img
  src="https://screenletstore.appspot.com/img/95aaa0f0-37a4-11e7-a652-7b8128ce3e3b.png"
  title="Piskel editor screenshot"
  width="500">

## About Piskel

### Built with

The Piskel editor is purely built in **JavaScript, HTML and CSS**.

We also use the following **libraries** :
* [spectrum](https://github.com/bgrins/spectrum) : awesome standalone colorpicker
* [gifjs](https://jnordberg.github.io/gif.js/) : generate animated GIFs in javascript, using webworkers
* [supergif](https://github.com/buzzfeed/libgif-js) : modified version of SuperGif to parse and import GIFs
* [jszip](https://github.com/Stuk/jszip) : create, read and edit .zip files with Javascript
* [canvas-toBlob](https://github.com/eligrey/canvas-toBlob.js/) : shim for canvas toBlob
* [jquery](https://jquery.com/) : used sporadically in the application
* [bootstrap-tooltip](https://getbootstrap.com/javascript/#tooltips) : nice tooltips
* [playwright](https://playwright.dev/): End to end testing

As well as some **icons** from the [Noun Project](https://thenounproject.com/) :
* Folder by Simple Icons from The Noun Project
* (and probably one or two others)

### Browser Support

Piskel supports the following browsers:
* **Chrome** (latest)
* **Firefox** (latest)
* **Edge** (latest)
* **Brave** (latest) but **only if canvas fingerprinting is disabled** ([more info](https://github.com/piskelapp/piskel/wiki/About-canvas%E2%80%90based-browser-fingerprinting-and-Brave-browser))

### Mobile/Tablets

There is no support for mobile.

### Offline builds

Offline builds are available. More details in the [dedicated wiki page](https://github.com/piskelapp/piskel/wiki/Desktop-applications).

## Contributing ?

### Reporting an issue

Found a problem when using the application, want to request a feature, [open an issue](https://github.com/piskelapp/piskel/issues).
 
### About PR contributions

#### PR Contributions we accept
- Small, straightforward fixes (documentation updates, typos, incorrect strings, minor bugs): only a few words or lines.

#### PR Contributions we are unlikely to merge/review
- Large or complex bug fixes that are spread across multiple areas of the codebase
- Major refactors that require significant testing, validation, or architectural discussion
- Pull requests that modify the user experience or introduce new features

You are still welcome to open a PR, but please note that complex or UX-impacting changes are unlikely to be reviewed or merged due to limited time and resources.

### Setting up Development environment
Have a look at the [wiki](https://github.com/piskelapp/piskel/wiki) to set up the development environment.



## License

Copyright 2017 Julian Descottes

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

