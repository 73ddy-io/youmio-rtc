import MainContent from './comps/MainContent';
import TitleBar from './comps/TitleBar';
//@ts-ignore
import {useState} from "react";

export default function App() {

    return (
        <div className="flex flex-col h-screen relative"> {/* Добавляем relative для контекста позиционирования */}
            {/* TitleBar остается на своем месте */}
            <TitleBar />

            {/* Основной контент */}
            <div className="flex flex-1 overflow-hidden">
                <MainContent  />
            </div>
        </div>
    );
}