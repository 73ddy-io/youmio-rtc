// @ts-ignore
import React, { useState, useEffect } from 'react';
import {
    WindowMinimise,
    WindowToggleMaximise,
    WindowIsMaximised,
    Quit,
} from '../../wailsjs/runtime/runtime';

import { APP_CONSTANTS } from "../constants";

/**
 * Custom title bar component for Wails desktop application.
 * 
 * Provides window controls (minimize, maximize/restore, close) and displays
 * the application title. Uses Wails runtime APIs for window management.
 */
export default function TitleBar() {
    const [title, setTitle] = useState('');
    
    // Set window title on component mount
    useEffect(() => {
        (async () => { 
            setTitle(await APP_CONSTANTS.title); 
        })();
    }, []);

    const [isMaximised, setIsMaximised] = useState(false);

    /**
     * Check and sync window maximization state on component mount.
     */
    useEffect(() => {
        async function checkWindowState() {
            const maximised = await WindowIsMaximised();
            setIsMaximised(maximised);
        }
        checkWindowState();
    }, []);

    /**
     * Toggle window maximize/restore state.
     */
    const handleMaximize = async () => {
        await WindowToggleMaximise();
        setIsMaximised(!isMaximised);
    };

    return (
        <div 
            className="flex justify-center items-center bg-primary text-secondary relative border-b-[1px] border-[#242426] no-copy"
            style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        >
            {/* Application title - centered and truncated */}
            <span className="absolute left-1/2 transform -translate-x-1/2 truncate font-unbounded font-bold text-[12px] text-[#afafaf]">
                {title}
            </span>
            
            {/* Window controls - right aligned */}
            <div className="flex ml-auto gap-1">
                {/* Minimize button */}
                <button
                    onClick={WindowMinimise}
                    className="h-[33px] w-[33px] justify-center text-[#9f9f9f] hover:text-secondary hover:bg-[#121212]"
                    aria-label="Minimize window"
                >
                    –
                </button>
                
                {/* Maximize/Restore button */}
                <button
                    onClick={handleMaximize}
                    className="h-[33px] w-[33px] justify-center text-[#9f9f9f] hover:text-secondary hover:bg-[#121212]"
                    aria-label={isMaximised ? "Restore window" : "Maximize window"}
                >
                    <span className="rotate-icon">◻</span>
                </button>
                
                {/* Close button */}
                <button
                    onClick={Quit}
                    className="hover:bg-[#da3e44] h-[33px] w-[33px] justify-center text-[#9f9f9f] hover:text-secondary"
                    aria-label="Close application"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
