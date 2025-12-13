// @ts-ignore
import React, { useState, useEffect } from 'react';
import {
    WindowMinimise,
    WindowToggleMaximise,
    WindowIsMaximised,
    Quit,
} from '../../wailsjs/runtime/runtime';

import {APP_CONSTANTS} from "../constants";



export default function TitleBar(){
    const [title, setTitle] = useState('');
    useEffect(function(){
        (async function() { setTitle(await APP_CONSTANTS.title) })();
    }, []);
    const [isMaximised, setIsMaximised] = useState(false);

    // Проверяем состояние окна при загрузке
    useEffect(function (){
        async function checkWindowState(){
            const maximised = await WindowIsMaximised();
            setIsMaximised(maximised);
        }
        checkWindowState();
    }, []);

    const handleMaximize = async function() {
        await WindowToggleMaximise();
        setIsMaximised(!isMaximised);
    };

    return (
        <div className="flex justify-center items-center bg-primary text-secondary relative border-b-[1px] border-[#242426] no-copy"
             style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
            <span className="absolute left-1/2 transform -translate-x-1/2 truncate font-unbounded font-bold text-[12px]">{title}</span>
            <div className="flex ml-auto gap-1">
                <button
                    onClick={WindowMinimise}
                    className="h-[33px] w-[33px] justify-center text-[#9f9f9f] hover:text-secondary"
                >
                    –
                </button>
                <button
                    onClick={handleMaximize}
                    className="h-[33px] w-[33px] justify-center text-[#9f9f9f] hover:text-secondary"
                >
                    <span className="rotate-icon">◻</span>
                </button>
                <button
                    onClick={Quit}
                    className="hover:bg-[#da3e44] h-[33px] w-[33px] justify-center text-[#9f9f9f] hover:text-secondary"
                >
                    ✕
                </button>
            </div>
        </div>
    );
};