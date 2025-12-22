// Package main implements the main Wails application logic for a chat interface.
//
// Provides configuration management, file handling for dev/prod environments,
// and JSON file operations for questions and agent configuration.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/73ddy-io/logger"
)

// App represents the main application instance.
//
// Manages application lifecycle, configuration, and dev/prod file paths.
// Automatically detects development mode based on go.mod and assets presence.
type App struct {
	ctx         context.Context
	windowTitle string
	isDev       bool
}

// AppConfig holds the application configuration loaded from config.json.
//
// Contains authentication credentials for the chat API.
type AppConfig struct {
	Token   string `json:"token"`
	AgentID string `json:"agentId"`
}

// NewApp creates a new application instance.
//
// Initializes the logger and detects development/production mode.
// Development mode is detected when both go.mod and assets/questions.json exist.
func NewApp(windowTitle string) *App {
	fmt.Println("---1")
	logger.InitLogger("log/logger.log")
	logger.Info("Creating App instance: Processing")

	// Detect development mode
	isDev := false
	if _, err := os.Stat("go.mod"); err == nil {
		// go.mod exists in working directory
		if _, err := os.Stat("assets/questions.json"); err == nil {
			isDev = true
		}
	}

	return &App{
		windowTitle: windowTitle,
		isDev:       isDev,
	}
}

// startup initializes the application after Wails context is available.
//
// Performs production-specific file setup and logs initialization success.
// Called by Wails runtime during application startup.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	logger.Info("Creating App instance: Success")

	// In production, create external questions.json and config.json if missing
	if !a.isDev {
		if err := ensureQuestionsFile(); err != nil {
			logger.Error("ensureQuestionsFile error: %v", err)
		}
		if err := ensureConfigFile(); err != nil {
			logger.Error("ensureConfigFile error: %v", err)
		}
	}
}

// GetTitle returns the application window title.
func (a *App) GetTitle() string {
	return a.windowTitle
}

// File path utilities

// externalFilePath returns the path to a file next to the executable.
//
// Used in production mode to locate config and questions files
// relative to the application binary.
func externalFilePath(filename string) (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exePath)
	return filepath.Join(dir, filename), nil
}

// devFilePath returns the development path for asset files.
//
// Reads from assets/ directory during development builds.
func devFilePath(filename string) string {
	return filepath.Join("assets", filename)
}

// Production file creation utilities

// ensureQuestionsFile creates questions.json next to executable if missing.
//
// Writes default sample questions for new production installations.
func ensureQuestionsFile() error {
	path, err := externalFilePath("questions.json")
	if err != nil {
		return err
	}

	if _, err := os.Stat(path); err == nil {
		return nil // already exists
	}

	sample := []string{
		"test question 1",
		"test question 2",
		"test question 3",
	}

	data, err := json.MarshalIndent(sample, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0o644)
}

// ensureConfigFile creates config.json next to executable if missing.
//
// Writes default configuration template for new production installations.
func ensureConfigFile() error {
	path, err := externalFilePath("config.json")
	if err != nil {
		return err
	}

	if _, err := os.Stat(path); err == nil {
		return nil // already exists
	}

	// Default config template
	sample := AppConfig{
		Token:   "YOUR_TOKEN_HERE",
		AgentID: "YOUR_AGENT_ID_HERE",
	}

	data, err := json.MarshalIndent(sample, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0o644)
}

// GetQuestions loads and parses the questions.json file.
//
// Returns questions array for the chat interface question slider.
// Automatically uses correct path based on dev/prod mode.
func (a *App) GetQuestions() ([]string, error) {
	var path string
	var err error

	if a.isDev {
		path = devFilePath("questions.json")
	} else {
		path, err = externalFilePath("questions.json")
		if err != nil {
			return []string{}, err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return []string{}, err
	}

	var qs []string
	if err := json.Unmarshal(data, &qs); err != nil {
		return []string{}, err
	}

	return qs, nil
}

// GetConfig loads and parses the config.json file.
//
// Returns application configuration for WebSocket authentication.
// Automatically uses correct path based on dev/prod mode.
func (a *App) GetConfig() (AppConfig, error) {
	var path string
	var err error

	if a.isDev {
		path = devFilePath("config.json")
	} else {
		path, err = externalFilePath("config.json")
		if err != nil {
			return AppConfig{}, err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return AppConfig{}, err
	}

	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return AppConfig{}, err
	}

	return cfg, nil
}
