import React, { useEffect, useRef, useState } from 'react';
import * as AppAPI from '../../wailsjs/go/main/App';

// Типы
type AppConfig = {
    token: string;
    agentId: string;
}

const WS_BASE_URL = 'wss://api.youmio.ai/api/chat';

type ChatMessage = {
    id: string;
    text: string;
    sender: 'User' | 'Agent';
};

type IncomingChatMsg = {
    type: 'ChatMsg';
    id: string;
    text?: string;
    sender: 'User' | 'Agent';
};

type IncomingChatMsgList = {
    type: 'ChatMsgList';
    messages: IncomingChatMsg[];
};

type AgentBufferItem = {
    text: string;
    shownLength: number;
    timerId: number | null;
};

const ROW_HEIGHT = 50;
const VISIBLE_ROWS = 3;

// --- КОНСТАНТЫ СКОРОСТИ ---
const INTERVAL_FAST_MS = 2500;
const INTERVAL_SLOW_MS = 8000;
const STREAM_SILENCE_MS = 3500;

function genId(len = 20): string {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < len; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
    }
    return res;
}

export default function MainContent() {
    // --- State ---
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [questions, setQuestions] = useState<string[]>([]);
    const [questionsLoaded, setQuestionsLoaded] = useState(false);

    // Auto-send State
    const [autoRunning, setAutoRunning] = useState(false);
    const [sendSpeed, setSendSpeed] = useState<'fast' | 'slow'>('fast'); // Новый стейт для скорости
    const autoTimerRef = useRef<number | null>(null);
    const autoIndexRef = useRef(0);

    // Slider State
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isSliding, setIsSliding] = useState(false);
    const sliderRef = useRef<HTMLDivElement | null>(null);

    // Refs
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const agentBuffersRef = useRef<Map<string, AgentBufferItem>>(new Map());
    const pendingOpenRef = useRef<Promise<WebSocket> | null>(null);

    // --- Init & Config ---

    const loadConfig = async () => {
        try {
            const cfg = (await (AppAPI as any).GetConfig()) as AppConfig;
            if (cfg && cfg.token && cfg.agentId) {
                console.log("Config loaded successfully");
                setConfig(cfg);
            }
        } catch (e) {
            console.error("Failed to load config:", e);
        }
    };

    const loadQuestions = async () => {
        try {
            const qs = (await (AppAPI as any).GetQuestions()) as string[];
            if (Array.isArray(qs) && qs.length > 0) {
                setQuestions(qs);
                setQuestionsLoaded(true);
            } else {
                setQuestions([]);
                setQuestionsLoaded(false);
            }
        } catch {
            setQuestions([]);
            setQuestionsLoaded(false);
        }
    };

    useEffect(() => {
        loadConfig();
        loadQuestions();
    }, []);

    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (config) {
             if (ws) ws.close();
             createSocket();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    // --- Buffer Logic ---

    const flushAgentById = (id: string) => {
        const map = agentBuffersRef.current;
        const item = map.get(id);
        if (!item) return;
        const finalText = item.text.trim();
        if (item.timerId !== null) clearTimeout(item.timerId);
        map.delete(id);
        if (!finalText) return;
        setMessages((prev) => [...prev, { id, text: finalText, sender: 'Agent' }]);
    };

    const scheduleFlushAgentById = (id: string) => {
        const map = agentBuffersRef.current;
        const item = map.get(id);
        if (!item) return;
        if (item.timerId !== null) clearTimeout(item.timerId);
        const timerId = window.setTimeout(() => flushAgentById(id), STREAM_SILENCE_MS);
        item.timerId = timerId;
        map.set(id, item);
    };

    // --- WebSocket Logic ---

    const attachSocketHandlers = (socket: WebSocket) => {
        socket.onopen = () => setConnected(true);
        socket.onerror = () => setConnected(false);
        socket.onclose = () => setConnected(false);
        socket.onmessage = (event) => {
            try {
                const raw = JSON.parse(event.data.toString()) as IncomingChatMsg | IncomingChatMsgList;
                if (raw.type === 'ChatMsg') handleIncomingChatMsg(raw);
            } catch { /* ignore */ }
        };
    };

    const createSocket = () => {
        if (!config) return null;
        const fullUrl = `${WS_BASE_URL}?agentId=${config.agentId}&token=${config.token}`;
        const socket = new WebSocket(fullUrl);
        attachSocketHandlers(socket);
        setWs(socket);
        return socket;
    };

    const ensureSocketOpen = async (): Promise<WebSocket | null> => {
        if (!config) return null;
        if (ws && ws.readyState === WebSocket.OPEN) return ws;
        if (pendingOpenRef.current) {
            try {
                const existing = await pendingOpenRef.current;
                return existing.readyState === WebSocket.OPEN ? existing : null;
            } catch { return null; }
        }

        const openPromise = new Promise<WebSocket>((resolve, reject) => {
            try {
                const fullUrl = `${WS_BASE_URL}?agentId=${config.agentId}&token=${config.token}`;
                const socket = new WebSocket(fullUrl);
                socket.onopen = () => {
                    setConnected(true);
                    attachSocketHandlers(socket);
                    setWs(socket);
                    resolve(socket);
                };
                socket.onerror = (ev) => {
                    socket.close();
                    reject(ev);
                };
                socket.onclose = () => setConnected(false);
            } catch (e) { reject(e); }
        });

        pendingOpenRef.current = openPromise;
        try { return await openPromise; } 
        catch { return null; } 
        finally { pendingOpenRef.current = null; }
    };

    const handleIncomingChatMsg = (msg: IncomingChatMsg) => {
        if (msg.sender !== 'Agent') return;
        const id = msg.id || genId();
        const full = msg.text ?? '';
        if (!full) return;

        const map = agentBuffersRef.current;
        const existing = map.get(id) || { text: '', shownLength: 0, timerId: null } as AgentBufferItem;
        const prevLen = existing.text.length;
        const part = full.slice(prevLen);
        if (!part) {
            scheduleFlushAgentById(id);
            return;
        }
        const newText = existing.text + part;
        map.set(id, { text: newText, shownLength: newText.length, timerId: existing.timerId });
        scheduleFlushAgentById(id);
    };

    useEffect(() => {
        return () => {
            ws?.close();
            agentBuffersRef.current.forEach((item) => {
                if (item.timerId !== null) clearTimeout(item.timerId);
            });
            agentBuffersRef.current.clear();
            stopAutoSend();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Button Handlers ---

    const handleReloadQuestions = async () => {
        stopAutoSend();
        await loadQuestions();
    };

    const handleReconnect = () => {
        if (!config) return;
        if (ws) {
            try { ws.close(); } catch {}
        }
        setWs(null);
        setConnected(false);
        agentBuffersRef.current.forEach((item) => {
            if (item.timerId !== null) clearTimeout(item.timerId);
        });
        agentBuffersRef.current.clear();
        createSocket();
    };
    
    const handleUpdateConfig = async () => {
        stopAutoSend();
        setConnected(false);
        if (ws) { ws.close(); setWs(null); }
        await loadConfig();
        if (config) setTimeout(() => handleReconnect(), 100);
    };

    // --- Sending Logic ---

    const sendMessage = async (text: string) => {
        if (!text.trim()) return;
        const socket = await ensureSocketOpen();
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        const trimmed = text.trim();
        const msg = {
            type: 'ChatMsg',
            id: genId(),
            text: trimmed,
            sender: 'User' as const,
            createdAts: Math.floor(Date.now() / 1000),
            url: null, b64Data: null, skill: null, messageType: 'text', audioEnabled: false, files: [] as any, isBuffer: false,
        };

        socket.send(JSON.stringify(msg));
        setMessages((prev) => [...prev, { id: msg.id, text: trimmed, sender: 'User' }]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        await sendMessage(input);
        setInput('');
        stopAutoSend();
    };

    // --- Slider & Auto Loop ---

    const getItemOrEmpty = (index: number): string => {
        if (index < 0 || index >= questions.length) return '';
        return questions[index];
    };

    const animateToIndex = (nextIndex: number, cb: () => void) => {
        const track = sliderRef.current;
        if (!track) {
            setCurrentIndex(nextIndex);
            cb();
            return;
        }
        if (isSliding) return;

        setIsSliding(true);
        setCurrentIndex(nextIndex);

        track.style.transition = 'none';
        track.style.transform = `translateY(${ROW_HEIGHT}px)`;
        void track.offsetHeight;

        requestAnimationFrame(() => {
            track.style.transition = 'transform 0.5s ease';
            track.style.transform = 'translateY(0px)';
            const handleEnd = () => {
                track.removeEventListener('transitionend', handleEnd);
                requestAnimationFrame(() => {
                    track.style.transition = 'none';
                    track.style.transform = 'translateY(0px)';
                    void track.offsetHeight;
                    setIsSliding(false);
                    cb();
                });
            };
            track.addEventListener('transitionend', handleEnd, { once: true });
        });
    };

    const stopAutoSend = () => {
        if (autoTimerRef.current !== null) {
            clearInterval(autoTimerRef.current);
            autoTimerRef.current = null;
        }
        setAutoRunning(false);
    };

    const sendQuestionByIndex = async (index: number) => {
        if (index < 0 || index >= questions.length) return;
        const q = questions[index];
        if (!q) return;
        await sendMessage(q);
    };

    // Функция запуска цикла таймера (вынесена отдельно)
    const runTimerLoop = (delay: number) => {
        if (autoTimerRef.current !== null) clearInterval(autoTimerRef.current);

        autoTimerRef.current = window.setInterval(async () => {
            if (isSliding) return;

            const current = autoIndexRef.current;
            const next = current + 1;
            if (next >= questions.length) {
                stopAutoSend();
                return;
            }

            animateToIndex(next, async () => {
                autoIndexRef.current = next;
                await sendQuestionByIndex(autoIndexRef.current);
            });
        }, delay);
    };

    const startAutoSend = async () => {
        if (!questions.length) return;
        
        // Если уже запущен, не дублируем, но можем обновить если что-то сбилось
        if (autoRunning && autoTimerRef.current !== null) return;

        const socket = await ensureSocketOpen();
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        setAutoRunning(true);
        autoIndexRef.current = currentIndex;
        
        // Сразу отправляем первый (текущий) вопрос
        await sendQuestionByIndex(autoIndexRef.current);

        // Определяем задержку на основе текущего режима
        const delay = sendSpeed === 'fast' ? INTERVAL_FAST_MS : INTERVAL_SLOW_MS;
        runTimerLoop(delay);
    };

    // Обработчик смены скорости
    const toggleSpeed = (mode: 'fast' | 'slow') => {
        setSendSpeed(mode);
        // Если авто-режим активен, перезапускаем таймер с новой скоростью "на лету"
        if (autoRunning) {
            const newDelay = mode === 'fast' ? INTERVAL_FAST_MS : INTERVAL_SLOW_MS;
            runTimerLoop(newDelay);
        }
    };

    const handleCenterClick = () => {
        const q = getItemOrEmpty(currentIndex);
        if (!q) return;
        setInput(q);
        stopAutoSend();
    };

    const prevIndex = currentIndex - 1;
    const nextIndex = currentIndex + 1;

    return (
        <div className="flex-1 p-4 overflow-hidden bg-primary text-afafaf flex gap-4">
            {/* Левый слайдер вопросов */}
            <div className="w-[260px] bg-primary flex flex-col items-center justify-center">
                <div className="relative w-full mb-3">
                    <div
                        style={{
                            height: ROW_HEIGHT * VISIBLE_ROWS,
                            overflow: 'hidden',
                            position: 'relative',
                            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 33%, rgba(0,0,0,1) 66%, transparent 100%)',
                            maskImage: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 33%, rgba(0,0,0,1) 66%, transparent 100%)',
                        }}
                    >
                        <div ref={sliderRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: 'translateY(0px)' }}>
                            <div style={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 16px', color: '#afafaf' }}>
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>{getItemOrEmpty(prevIndex)}</span>
                            </div>
                            <div onClick={handleCenterClick} style={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 16px', color: '#afafaf', fontWeight: 600, cursor: 'pointer' }}>
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>{getItemOrEmpty(currentIndex)}</span>
                            </div>
                            <div style={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '0 16px', color: '#afafaf' }}>
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 }}>{getItemOrEmpty(nextIndex)}</span>
                            </div>
                        </div>
                        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', height: ROW_HEIGHT, width: '100%', border: '1px solid #afafaf', borderRadius: 10, pointerEvents: 'none', boxSizing: 'border-box' }} />
                    </div>
                </div>

                {/* --- SPEED TOGGLE --- */}
                <div className="w-full flex bg-[#222] rounded-md p-1 mb-2">
                    <button
                        onClick={() => toggleSpeed('fast')}
                        className={`flex-1 text-[10px] py-1 rounded-sm transition-colors ${
                            sendSpeed === 'fast' 
                            ? 'bg-[#444] text-white font-bold shadow-sm' 
                            : 'text-[#666] hover:text-[#999]'
                        }`}
                    >
                        Fast (2.5s)
                    </button>
                    <button
                        onClick={() => toggleSpeed('slow')}
                        className={`flex-1 text-[10px] py-1 rounded-sm transition-colors ${
                            sendSpeed === 'slow' 
                            ? 'bg-[#444] text-white font-bold shadow-sm' 
                            : 'text-[#666] hover:text-[#999]'
                        }`}
                    >
                        Slow (8s)
                    </button>
                </div>

                <div className="flex gap-2 text-xs w-full justify-between">
                    <button
                        type="button"
                        className="flex-1 py-1 border border-[#444] rounded-md hover:bg-[#222]"
                        onClick={startAutoSend}
                        disabled={!questionsLoaded || autoRunning}
                    >
                        Start
                    </button>
                    <button
                        type="button"
                        className="flex-1 py-1 border border-[#444] rounded-md hover:bg-[#222]"
                        onClick={stopAutoSend}
                        disabled={!autoRunning}
                    >
                        Stop
                    </button>
                    <button
                        type="button"
                        className="flex-1 py-1 border border-[#444] rounded-md hover:bg-[#222]"
                        onClick={handleReloadQuestions}
                    >
                        Reload
                    </button>
                </div>

                {!questionsLoaded && (
                    <div className="mt-2 text-[11px] text-neutral-500">
                        Couldn&apos;t load questions.json
                    </div>
                )}
            </div>

            {/* Правая часть: чат */}
            <div className="flex-1 flex flex-col border border-[#242426] rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-[#242426] flex items-center justify-between text-sm">
                    <span className="font-unbounded">Chatting</span>
                    <div className="flex items-center gap-3">
                        <button onClick={handleUpdateConfig} className="px-2 py-1 text-xs border border-[#444] rounded-md hover:bg-[#222] text-[#9f9f9f]" title="Reload config.json & Reconnect">
                            Update config
                        </button>
                        <div className="h-4 w-[1px] bg-[#333]" />
                        <span className={connected ? 'text-green-400' : 'text-red-400'}>{connected ? 'online' : 'offline'}</span>
                        <button onClick={handleReconnect} title="Reconnect Socket" className="h-[28px] w-[28px] flex items-center justify-center text-[#9f9f9f] rounded-md hover:text-secondary hover:bg-[#222]">
                             <span className="rotate-icon text-xl">↻</span>
                        </button>
                    </div>
                </div>

                <div ref={messagesContainerRef} className="flex-1 overflow-auto p-3 bg-primary space-y-2 text-sm scroll-thin">
                    {messages.map((m) => (
                        <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 ${m.sender === 'User' ? 'ml-auto bg-[#333]' : 'mr-auto bg-[#222222]'}`}>
                            <div className="text-[10px] opacity-60 mb-1">{m.sender === 'User' ? 'You' : 'Mio'}</div>
                            <div>{m.text}</div>
                        </div>
                    ))}
                    {messages.length === 0 && <div className="text-xs text-neutral-500">use how u like.</div>}
                </div>

                <form onSubmit={handleSubmit} className="border-t border-primary p-2 flex gap-2">
                    <input className="flex-1 bg-[#101010] text-sm px-3 py-2 rounded-md outline-none border border-[#222] focus:border-[#333] input-placeholder-dark" placeholder="type here..." value={input} onChange={(e) => setInput(e.target.value)} />
                    <button type="submit" className="px-4 py-2 text-sm rounded-md hover:bg-[#222]" disabled={!input.trim()}>Send</button>
                </form>
            </div>
        </div>
    );
}
