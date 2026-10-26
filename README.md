# Caelestia Homepage

> A custom browser homepage inspired by the Arch Linux desktop look of [caelestia-shell](https://github.com/caelestia-dots/shell), built with plain HTML, CSS, and JavaScript.

**Live demo:** https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/

## Overview

This project replaces the default browser start page with a desktop-style homepage: a side/top bar, widgets, a wallpaper switcher, and a music player with a built-in equalizer. It was created to practice front-end development and to build a portfolio of practical projects. No frameworks or build tools are used.

## Features

- Desktop-shell style interface inspired by caelestia-shell
- Configurable bar position (left, right, top, or bottom) for desktop and tablet
- Wallpaper carousel with color filtering and wallpaper management
- Music player and equalizer; import audio files through the library (no built-in tracks are currently configured)
- 10-band equalizer (31 Hz - 16 kHz) built with the Web Audio API (`BiquadFilterNode`)
  - Presets: Flat, Bass, Treble, Vocal, Pop, Rock, Jazz, Classic
- Modular structure with a simple plugin manager
- Responsive layout for desktop, tablet, and phone

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript (vanilla, ES modules)
- **Audio:** Web Audio API
- **Hosting:** GitHub Pages
- **Tools:** Visual Studio Code, Git, GitHub

## Getting Started

### Prerequisites

- A modern web browser (Chrome, Edge, Firefox)
- Visual Studio Code (recommended) with the Live Server extension
- Git (optional)

### Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
   ```

2. Navigate to the project directory:

   ```bash
   cd YOUR-REPOSITORY
   ```

3. Open the project in Visual Studio Code:

   ```bash
   code .
   ```

4. Start a local server. Do **not** just double-click `index.html`: the project uses ES modules and loads plugin manifests with `fetch()`, which browsers block on `file://`.

   - VS Code: right-click `index.html` and choose **Open with Live Server**, or
   - Terminal: `python -m http.server 8000`, then open `http://localhost:8000`

### Use as Your Browser Homepage

Set the deployed GitHub Pages URL (or your local server URL) as the homepage / new tab page in your browser settings.

## Project Structure

```text
YOUR-REPOSITORY/
├── index.html
├── core/
├── css/
│   ├── components.css
│   ├── dashboard.css
│   └── ...
├── assets/
│   ├── transparent_ui_icons/   # 46 UI and weather icons
│   └── wallpapers/
│       ├── Black.jpg
│       ├── Blue.jpg
│       ├── Colorfull.jpg
│       └── thumbs/             # Wallpaper thumbnails
├── js/
│   ├── appearance/
│   ├── calendar/
│   ├── core/
│   ├── library/
│   ├── music/
│   ├── system/
│   ├── ui/
│   ├── ux/
│   └── widgets/
├── .gitignore
└── README.md
```

The built-in wallpaper list is registered in `js/core/builtin-assets.js`. Audio files can be imported into the library in the browser; there are no bundled music files in the current `assets/` directory.

## Deployment (GitHub Pages)

1. Push the project to GitHub (`index.html` must be in the repository root).
2. Go to **Settings -> Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Your site will be available at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

Use relative paths (for example, `css/base.css` and `js/main.js`, not `/css/base.css`) so the site works under the repository sub-path.

## Development Status

**Status:** In Development

New widgets, settings, and visual improvements are added over time.

## Contributing

Suggestions and feedback are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes with a clear message.
4. Open a Pull Request describing your changes.

## Credits

- Visual inspiration: [caelestia-shell](https://github.com/caelestia-dots/shell)

## License

No license has been specified yet. All rights are reserved by default unless a license is added to this repository.

## Author

**Nathan**

- GitHub: [@YOUR-USERNAME](https://github.com/YOUR-USERNAME)