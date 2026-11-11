# Desktop Pet

Desktop Pet is a desktop companion application built with Angular and Tauri. It gives you a small interactive virtual pet that can help with daily routines, reminders, timer tracking, and simple productivity habits while staying on your screen.

## Features

- Animated desktop pet experience
- Dashboard for overview and status
- Task and reminder management
- Focus timer and productivity tracking
- Motivational quotes and pet behavior responses
- Speech synthesis support for voice interactions
- Desktop app packaging using Tauri

## Tech Stack

- Angular 21
- TypeScript
- RxJS
- Tauri 2 / Rust
- Python speech engine for local text-to-speech
- Vitest for frontend testing

## Prerequisites

Before you start, make sure you have the following installed:

- Node.js 20+ and npm
- Rust toolchain (for Tauri)
- Python 3.12 (recommended for the speech engine)
- A Windows environment is recommended because the project includes Windows-specific Tauri and speech engine setup

## Quick Start

1. Install project dependencies:

```bash
npm install
```

2. Start the Angular app in development mode:

```bash
npm run start
```

3. Open the app in your browser:

```text
http://localhost:4200/
```

## Run the Desktop App

To launch the full desktop application with Tauri:

```bash
npx tauri dev
```

This will start the Angular development server and open the Tauri desktop shell configured in `src-tauri/tauri.conf.json`.

## Production Build

To build the app for production:

```bash
npm run build
npx tauri build
```

This creates the frontend production bundle and packages the desktop app.

## Project Structure

```text
desktop-pet/
├── src/                     # Angular frontend app
│   ├── app/                 # App components, routes, and services
│   ├── assets/              # Images, sounds, and app data
│   ├── styles.css           # Global styles
│   └── index.html           # App entry HTML
├── src-tauri/               # Tauri desktop wrapper and Rust backend
│   ├── src/                 # Rust source files
│   ├── tauri.conf.json      # Tauri configuration
│   └── icons/               # App icons
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

- The app is configured to run as a local desktop companion with a browser preview during development.
- The Tauri configuration points the desktop app to the Angular dev server on `http://localhost:4200`.
- The project includes both frontend logic and a native desktop wrapper, so both Angular and Rust toolchains are needed for full local development.

## License

This project does not currently include a license file in the repository root. If you plan to distribute or publish the app, add a license before release.
