// Package main is the Wails application entrypoint for Youmio RTC chat application.
//
// Embeds frontend assets and configures frameless desktop window with dark theme.
// Binds App struct methods to frontend for configuration and questions management.
package main

import (
	"embed"
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed frontend/dist/*
var assets embed.FS

// Icon data for application window (currently unused).
var icon []byte

// main initializes and runs the Wails desktop application.
//
// Configures frameless window (850x540) with dark background (#222020),
// embeds frontend assets, and binds backend App methods to frontend JavaScript.
func main() {
	title := "Youmio Rtc"

	// Create application instance
	app := NewApp(title)

	// Run Wails application with configured options
	err := wails.Run(&options.App{
		Title:  title,
		Width:  850,
		Height: 540,

		// Serve embedded frontend assets
		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		// Dark theme background color (RGB: 34,32,32)
		BackgroundColour: &options.RGBA{R: 34, G: 32, B: 32, A: 1},

		// Frameless window for custom title bar
		Frameless: true,

		// Startup callback
		OnStartup: app.startup,

		// Bind App methods to frontend
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		fmt.Println("Wails error:", err.Error())
		fmt.Println("Press Enter to exit...")
		fmt.Scanln()
	}
}
