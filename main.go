package main

import (
	"embed"
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

var assets embed.FS

var icon []byte

func main() {
	// Create an instance of the app structure
	app := NewApp("New App")

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "console-art-gen2",
		Width:  850,
		Height: 540,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 34, G: 32, B: 32, A: 1},
		Frameless:        true,
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		fmt.Println("Error:", err.Error())
	}
}
