# Youmio RTC Chat Desktop App

Youmio RTC Chat is a frameless Wails Go/React desktop application for real-time AI chat with Youmio RTC API. Features WebSocket streaming responses, animated question slider with auto-send functionality, and seamless dev/prod configuration management.


## Features

- **Real-time Streaming Chat**: WebSocket connection to `wss://api.youmio.ai/api/chat` with agent response buffering and smooth display
- **Question Slider**: Animated slider showing 5 questions (3 visible) with click-to-send on center item and auto-send loop
- **Auto-send Modes**: Fast (2.5s) or Slow (8s) intervals with smooth slide transitions and automatic progression
- **Dev/Prod File Handling**: Automatic detection - uses `assets/` in dev, creates `questions.json`/`config.json` next to binary in prod


## Architecture

```
Backend (Go/Wails v2.10.1):
├── app.go - Config/Questions management, dev/prod file paths
├── main.go - Frameless window setup, asset embedding
└── go.mod - Wails + Go dependencies

Frontend (React/TypeScript/Vite/Tailwind):
├── MainContent.tsx - Chat logic, WebSocket, slider animation
├── TitleBar.tsx - Custom window controls
├── constants.ts - WS URL, config, animation timings
└── index.css - Dark theme, custom scrollbars, animations
```


## Quick Start

1. **Prerequisites**: Go 1.22+, Node.js 18+, Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)
2. **Development**:
   ```bash
   wails dev
   ```
3. **Build by your platform**:
   ```bash
   wails build
   ```
   Creates `youmio-rtc` binary + `questions.json`/`config.json` next to executable.


## Configuration

**config.json** (auto-created in prod):
```json
{
  "token": "YOUR_SESSION(BEARER)_TOKEN_HERE",
  "agentId": "YOUR_AGENT_ID_HERE"
}
```

**questions.json** (loads sample questions like "Analyze wallet transaction risks", "Create tone board for crypto brand")


## Controls

| Action | Keys/Buttons | Description |
|--------|--------------|-------------|
| Manual Send | Enter / Send button | Send current input |
| Auto-send Start | Start button | Begin question loop |
| Auto-send Stop | Stop button | Pause auto-send |
| Reload Questions | Reload button | Refresh from JSON |
| Reconnect WS | Refresh icon | Restart WebSocket |


## Tech Stack

- **Backend**: Go 1.22, Wails v2.10.1, iologger
- **Frontend**: React 18.3, TypeScript 5.5, Vite 6.3, TailwindCSS 3.4
- **Fonts**: Unbounded (title), Inter (body)
