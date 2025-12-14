package main

import (
	"context"
	"encoding/json"
	"os"

	"github.com/73ddy-io/logger"
)

type App struct {
	ctx         context.Context
	windowTitle string
}

func NewApp(windowTitle string) *App {
	logger.Info("Creating App instance: Processing")
	return &App{
		windowTitle: windowTitle,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	logger.Info("Creating App instance: Success")
}

// название окна
func (a *App) GetTitle() string {
	return a.windowTitle
}

// поиск и чтение assets/questions.json из embed.FS
func (a *App) GetQuestions() ([]string, error) {
	data, err := os.ReadFile("assets/questions.json")
	if err != nil {
		return []string{}, err
	}
	var qs []string
	if err := json.Unmarshal(data, &qs); err != nil {
		return []string{}, err
	}
	return qs, nil
}

type AgentConfig struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

// чтение assets/agents.json
func (a *App) GetAgents() ([]AgentConfig, error) {
	data, err := os.ReadFile("assets/agents.json")
	if err != nil {
		return []AgentConfig{}, err
	}
	var agents []AgentConfig
	if err := json.Unmarshal(data, &agents); err != nil {
		return []AgentConfig{}, err
	}
	return agents, nil
}
