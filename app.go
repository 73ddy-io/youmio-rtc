package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/73ddy-io/logger"
)

type App struct {
	ctx         context.Context
	windowTitle string
	isDev       bool
}

// AppConfig описывает структуру config.json
type AppConfig struct {
	Token   string `json:"token"`
	AgentID string `json:"agentId"`
}

func NewApp(windowTitle string) *App {
	fmt.Println("---1")
	logger.InitLogger("log/logger.log")
	logger.Info("Creating App instance: Processing")

	// Определение режима (dev/prod)
	isDev := false
	if _, err := os.Stat("go.mod"); err == nil {
		// есть go.mod в текущей рабочей директории
		// дополнительно проверяем, что есть assets/questions.json
		if _, err := os.Stat("assets/questions.json"); err == nil {
			isDev = true
		}
	}

	return &App{
		windowTitle: windowTitle,
		isDev:       isDev,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	logger.Info("Creating App instance: Success")

	// в prod создаём внешний questions.json и config.json рядом с .exe, если их нет
	if !a.isDev {
		if err := ensureQuestionsFile(); err != nil {
			logger.Error("ensureQuestionsFile error: %v", err)
		}
		if err := ensureConfigFile(); err != nil {
			logger.Error("ensureConfigFile error: %v", err)
		}
	}
}

// название окна
func (a *App) GetTitle() string {
	return a.windowTitle
}

// ==== пути к файлам ====

func externalFilePath(filename string) (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(exePath)
	return filepath.Join(dir, filename), nil
}

func devFilePath(filename string) string {
	// в dev читаем исходный файл из assets проекта
	return filepath.Join("assets", filename)
}

// ==== создание внешних файлов в prod ====

func ensureQuestionsFile() error {
	path, err := externalFilePath("questions.json")
	if err != nil {
		return err
	}

	if _, err := os.Stat(path); err == nil {
		return nil // уже существует
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

func ensureConfigFile() error {
	path, err := externalFilePath("config.json")
	if err != nil {
		return err
	}

	if _, err := os.Stat(path); err == nil {
		return nil // уже существует
	}

	// Дефолтный конфиг-пример
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

// ==== чтение вопросов ====

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

// ==== чтение конфига ====

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
