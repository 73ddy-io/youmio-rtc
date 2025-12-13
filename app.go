package main

import (
	"context"

	"github.com/73ddy-io/logger"
)

type App struct {
	ctx         context.Context
	windowTitle string
	// другие поля
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
	// Инициализация приложения
}

func (a *App) domReady(ctx context.Context) {}

func (a *App) GetTitle() string {
	return a.windowTitle
}
