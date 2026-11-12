# Desktop Pet

Desktop Pet is an Angular desktop companion application with an Electron shell. It provides an interactive virtual pet, reminders, timers, tasks, speech, and productivity habits.

## Features

- Animated desktop pet experience
- Dashboard for overview and status
- Task and reminder management
- Focus timer and productivity tracking
- Random motivational quotes and inspirational mini-stories
- Pet behavior responses
- Speech synthesis with sentence navigation and an expandable dialogue bubble
- Frameless transparent pet window, always-on-top behavior, system tray, notifications, and autostart using Electron

## Tech Stack

- Angular 21
- TypeScript
- RxJS
- Electron
- Python speech engine for local text-to-speech
- Vitest for frontend testing

## Prerequisites

Before you start, make sure you have the following installed:

- Node.js 20+ and npm
- Python 3.12 (recommended for the speech engine)
- Windows is recommended for the desktop shell and local speech engine

## Quick Start

1. Install project dependencies:

```bash
npm install
```

2. Start Electron (it starts the Angular development server automatically):

```bash
npm run electron
```

To run only the browser preview:

```bash
npm run start
```

## Production Build

Build the Angular frontend:

```bash
npm run build
```

The Electron main process loads `dist/desktop-pet/browser/index.html` when packaged. A distribution installer/build configuration still needs to be added before release packaging.

## Project Structure

```text
desktop-pet/
├── src/                     # Angular frontend app
│   ├── app/                 # App components, routes, and services
│   ├── assets/              # Images, sounds, and app data
│   ├── styles.css           # Global styles
│   └── index.html           # App entry HTML
├── electron/                # Electron main process and secure preload bridge
├── speech-engine/           # Local Python speech engine
│   ├── engine.py            # TTS processing logic
│   ├── requirements.txt     # Python dependencies
│   └── tests/               # Speech engine tests
├── public/                  # Static public assets
├── angular.json             # Angular workspace config
├── package.json             # NPM scripts and dependencies
├── tsconfig.json            # TypeScript config
├── README.md                # Project documentation
└── Desktop_Pet_Phase_1_Documentation_2026-09-20.docx
```

## Speech Engine

The project includes a local speech engine under `speech-engine/` for voice output. If the audio backend is missing, install the Python requirements:

```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r speech-engine\requirements.txt
```

For Windows packaging, the project also includes a build script:

```powershell
./speech-engine/build.ps1
```

This builds the bundled speech runtime used by the desktop app.

## Development Scripts

```bash
npm run start
npm run build
npm run watch
npm test
```

## Notes

- Electron is the active desktop shell. The legacy `src-tauri/` directory remains in the repository for reference but is no longer used by the desktop start scripts.
- The Electron shell uses a restricted preload bridge for IPC; Node.js integration is disabled in Angular renderer windows.
- `npm run electron` launches the pet and starts an Angular dev server on port 4200 if one is not already available.

## License

This project does not currently include a license file in the repository root. If you plan to distribute or publish the app, add a license before release.
