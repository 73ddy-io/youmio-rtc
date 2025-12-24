import React, { useEffect, useRef, useState } from 'react';
import * as AppAPI from '../../wailsjs/go/main/App';

// Application configuration loaded from backend.
type AppConfig = {
    token: string;
    agentId: string;
};

// WebSocket base URL for chat API.
const WS_BASE_URL = 'wss://api.youmio.ai/api/chat';

// Chat message displayed in the conversation.
type ChatMessage = {
    id: string;
    text: string;
    sender: 'User' | 'Agent';
};

// Single incoming chat message from WebSocket.
type IncomingChatMsg = {
    type: 'ChatMsg';
    id: string;
    text?: string;
    sender: 'User' | 'Agent';
};

// Batch of incoming chat messages from WebSocket.
type IncomingChatMsgList = {
    type: 'ChatMsgList';
    messages: IncomingChatMsg[];
};

// Buffer state for streaming agent responses.
type AgentBufferItem = {
    text: string;
    shownLength: number;
    timerId: number | null;
};

// Row height in pixels for question slider.
const ROW_HEIGHT = 50;
// Number of visible rows in question slider.
const VISIBLE_ROWS = 3;

// Animation constants for auto-send timing.
const INTERVAL_FAST_MS = 2500;
const INTERVAL_SLOW_MS = 8000;
const STREAM_SILENCE_MS = 3500;

/**
 * Generates a random ID string for messages.
 * @param len Length of the ID (default 20)
 * @returns Random alphanumeric string
 */
function genId(len = 20): string {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < len; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
    }
    return res;
}

/**
 * Main chat interface component with question slider and WebSocket messaging.
 *
 * Features:
 * - Real-time chat with streaming agent responses
 * - Question slider with auto-send functionality
 * - Speed toggle (Fast 2.5s / Slow 8s intervals)
 * - WebSocket connection with reconnection logic
 * - Backend config loading (token/agentId)
 */
export default function MainContent() {
    // --- Core State ---
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [questions, setQuestions] = useState<string[]>([]);
    const [questionsLoaded, setQuestionsLoaded] = useState(false);

    // --- Auto-send State ---
    const [autoRunning, setAutoRunning] = useState(false);
    const [sendSpeed, setSendSpeed] = useState<'fast' | 'slow'>('fast');
    const autoTimerRef = useRef<number | null>(null);
    const autoIndexRef = useRef(0);

    // --- Slider State ---
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isSliding, setIsSliding] = useState(false);
    const sliderRef = useRef<HTMLDivElement | null>(null);

    // --- Refs ---
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const agentBuffersRef = useRef<Map<string, AgentBufferItem>>(new Map());
    const pendingOpenRef = useRef<Promise<WebSocket> | null>(null);

    // --- Initialization ---

    /**
     * Loads application configuration from backend.
     */
    const loadConfig = async () => {
        try {
            const cfg = (await (AppAPI as any).GetConfig()) as AppConfig;
            if (cfg && cfg.token && cfg.agentId) {
                console.log('Config loaded successfully');
                setConfig(cfg);
            }
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    };

    /**
     * Loads questions list from backend.
     */
    const loadQuestions = async () => {
        try {
            const qs = (await (AppAPI as any).GetQuestions()) as string[];
            if (Array.isArray(qs) && qs.length > 0) {
                setQuestions(qs);
                setQuestionsLoaded(true);
                // Fix: Reset slider to beginning
                autoIndexRef.current = 0;
                setCurrentIndex(0);
            } else {
                setQuestions([]);
                setQuestionsLoaded(false);
            }
        } catch {
            setQuestions([]);
            setQuestionsLoaded(false);
        }
    };

    // Load config and questions on mount
    useEffect(() => {
        loadConfig();
        loadQuestions();
    }, []);

    // Auto-scroll to latest message
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    // Recreate WebSocket when config changes
    useEffect(() => {
        if (config) {
            if (ws) ws.close();
            createSocket();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    // --- Streaming Buffer Logic ---

    /**
     * Flushes buffered agent message to chat display.
     */
    const flushAgentById = (id: string) => {
        const map = agentBuffersRef.current;
        const item = map.get(id);
        if (!item) return;
        const finalText = item.text.trim();
        if (item.timerId !== null) clearTimeout(item.timerId);
        map.delete(id);
        if (!finalText) return;
        setMessages((prev) => [
            ...prev,
            { id, text: finalText, sender: 'Agent' },
        ]);
    };

    /**
     * Schedules agent buffer flush after silence timeout.
     */
    const scheduleFlushAgentById = (id: string) => {
        const map = agentBuffersRef.current;
        const item = map.get(id);
        if (!item) return;
        if (item.timerId !== null) clearTimeout(item.timerId);
        const timerId = window.setTimeout(
            () => flushAgentById(id),
            STREAM_SILENCE_MS
        );
        item.timerId = timerId;
        map.set(id, item);
    };

    // --- WebSocket Logic ---

    /**
     * Handles incoming WebSocket messages.
     */
    const handleIncomingChatMsg = (msg: IncomingChatMsg) => {
        if (msg.sender !== 'Agent') return;
        const id = msg.id || genId();
        const full = msg.text ?? '';
        if (!full) return;

        const map = agentBuffersRef.current;
        const existing =
            map.get(id) ||
            ({
                text: '',
                shownLength: 0,
                timerId: null,
            } as AgentBufferItem);

        const prevLen = existing.text.length;
        const part = full.slice(prevLen);

        if (!part) {
            scheduleFlushAgentById(id);
            return;
        }

        const newText = existing.text + part;
        const updated: AgentBufferItem = {
            text: newText,
            shownLength: newText.length,
            timerId: existing.timerId,
        };
        map.set(id, updated);
        scheduleFlushAgentById(id);
    };

    /**
     * Attaches event handlers to WebSocket instance.
     */
    const attachSocketHandlers = (socket: WebSocket) => {
        socket.onopen = () => {
            setConnected(true);
            pendingOpenRef.current = null;
        };
        socket.onerror = () => {
            setConnected(false);
        };
        socket.onclose = () => {
            setConnected(false);
            pendingOpenRef.current = null;
        };
        socket.onmessage = (event) => {
            try {
                const raw = JSON.parse(event.data.toString()) as
                    | IncomingChatMsg
                    | IncomingChatMsgList;

                if (raw.type === 'ChatMsg') {
                    handleIncomingChatMsg(raw);
                }

                if (raw.type === 'ChatMsgList' && Array.isArray(raw.messages)) {
                    const last = raw.messages[raw.messages.length - 1];
                    if (last) handleIncomingChatMsg(last);
                }
            } catch {
                // ignore
            }
        };
    };

    /**
     * Creates new WebSocket connection.
     */
    const createSocket = () => {
        if (!config) return null;
        const fullUrl = `${WS_BASE_URL}?agentId=${config.agentId}&token=${config.token}`;
        const socket = new WebSocket(fullUrl);
        attachSocketHandlers(socket);
        setWs(socket);
        return socket;
    };

    /**
     * Ensures WebSocket is open, creates new connection if needed.
     */
    const ensureSocketOpen = async (): Promise<WebSocket | null> => {
        if (!config) return null;

        if (ws && ws.readyState === WebSocket.OPEN) {
            return ws;
        }

        if (pendingOpenRef.current) {
            try {
                const existing = await pendingOpenRef.current;
                if (existing.readyState === WebSocket.OPEN) return existing;
                pendingOpenRef.current = null;
            } catch {
                pendingOpenRef.current = null;
            }
        }

        const openPromise = new Promise<WebSocket>((resolve, reject) => {
            try {
                const fullUrl = `${WS_BASE_URL}?agentId=${config.agentId}&token=${config.token}`;
                const socket = new WebSocket(fullUrl);

                socket.onopen = () => {
                    setConnected(true);
                    resolve(socket);
                };
                socket.onerror = (err) => {
                    setConnected(false);
                    reject(err);
                };
                socket.onclose = () => {
                    setConnected(false);
                };
                socket.onmessage = (event) => {
                    try {
                        const raw = JSON.parse(event.data.toString()) as
                            | IncomingChatMsg
                            | IncomingChatMsgList;
                        if (raw.type === 'ChatMsg') {
                            handleIncomingChatMsg(raw);
                        }
                        if (
                            raw.type === 'ChatMsgList' &&
                            Array.isArray(raw.messages)
                        ) {
                            const last = raw.messages[raw.messages.length - 1];
                            if (last) handleIncomingChatMsg(last);
                        }
                    } catch {
                        // ignore
                    }
                };
                setWs(socket);
            } catch (e) {
                reject(e);
            }
        });

        pendingOpenRef.current = openPromise;
        return openPromise.catch(() => null);
    };

    /**
     * Reconnects WebSocket and clears buffers.
     */
    const handleReconnect = () => {
        if (!config) return;
        if (ws) {
            try {
                ws.close();
            } catch {
                // ignore
            }
        }
        setWs(null);
        setConnected(false);

        agentBuffersRef.current.forEach((item) => {
            if (item.timerId !== null) clearTimeout(item.timerId);
        });
        agentBuffersRef.current.clear();

        createSocket();
    };

    /**
     * Reloads config and reconnects.
     */
    const handleUpdateConfig = async () => {
        stopAutoSend();
        setConnected(false);
        if (ws) ws.close();
        setWs(null);
        await loadConfig();
        // Allow state to update then reconnect
        if (config) {
            setTimeout(handleReconnect, 100);
        }
    };

    // --- Message Sending ---

    /**
     * Sends message via WebSocket and adds to local chat.
     */
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
            url: null,
            b64Data: null,
            skill: null,
            messageType: 'text',
            audioEnabled: false,
            files: [] as any,
            isBuffer: false,
        };

        socket.send(JSON.stringify(msg));
        setMessages((prev) => [
            ...prev,
            { id: msg.id, text: trimmed, sender: 'User' },
        ]);
    };

    /**
     * Handles form submission for manual messages.
     */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        await sendMessage(input);
        setInput('');
        stopAutoSend();
    };

    // --- Slider Logic ---

    const getItemOrEmpty = (index: number): string => {
        if (index < 0 || index >= questions.length) return '';
        return questions[index];
    };

    /**
     * Animates slider to next index with "anti-blink" logic.
     */
    const animateToIndex = (nextIndex: number, cb: () => void) => {
        const track = sliderRef.current;
        if (!track) {
            setCurrentIndex(nextIndex);
            cb();
            return;
        }

        if (isSliding) return;
        setIsSliding(true);

        // Reset to 0 with no transition
        track.style.transition = 'none';
        track.style.transform = 'translateY(0px)';
        void track.offsetHeight;

        // Animate to -ROW_HEIGHT
        track.style.transition = 'transform 0.5s ease';
        track.style.transform = `translateY(-${ROW_HEIGHT}px)`;

        const handleEnd = () => {
            track.removeEventListener('transitionend', handleEnd);

            requestAnimationFrame(() => {
                // Update state
                setCurrentIndex(nextIndex);

                // Reset transform without transition
                requestAnimationFrame(() => {
                    track.style.transition = 'none';
                    track.style.transform = 'translateY(0px)';
                    void track.offsetHeight;
                    setIsSliding(false);
                    cb();
                });
            });
        };

        track.addEventListener('transitionend', handleEnd, { once: true });
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

    /**
     * Runs auto-send timer loop with specified delay.
     */
    const runTimerLoop = (delay: number) => {
        if (autoTimerRef.current !== null) {
            clearInterval(autoTimerRef.current);
        }
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

    /**
     * Starts auto-send loop from current slider position.
     */
    const startAutoSend = async () => {
        if (!questions.length) return;
        if (autoRunning && autoTimerRef.current !== null) return;

        const socket = await ensureSocketOpen();
        if (!socket || socket.readyState !== WebSocket.OPEN) return;

        setAutoRunning(true);
        autoIndexRef.current = currentIndex;
        await sendQuestionByIndex(autoIndexRef.current);

        const delay =
            sendSpeed === 'fast' ? INTERVAL_FAST_MS : INTERVAL_SLOW_MS;
        runTimerLoop(delay);
    };

    /**
     * Toggles auto-send speed and updates running timer.
     */
    const toggleSpeed = (mode: 'fast' | 'slow') => {
        setSendSpeed(mode);
        if (autoRunning) {
            const newDelay =
                mode === 'fast' ? INTERVAL_FAST_MS : INTERVAL_SLOW_MS;
            runTimerLoop(newDelay);
        }
    };

    /**
     * Reloads questions from backend and resets slider.
     */
    const handleReloadQuestions = async () => {
        stopAutoSend();
        await loadQuestions();
    };

    /**
     * Loads current question into input field.
     */
    const handleCenterClick = () => {
        const q = getItemOrEmpty(currentIndex);
        if (!q) return;
        setInput(q);
        stopAutoSend();
    };

    const prevIndex = currentIndex - 1;
    const nextIndex = currentIndex + 1;

    return (
        <div className='flex-1 p-4 overflow-hidden bg-primary text-[#afafaf] flex gap-4'>
            {/* Left Panel - Questions Slider */}
            <div className='w-[260px] bg-primary flex flex-col items-center justify-center'>
                <div className='relative w-full mb-3'>
                    <div
                        style={{
                            height: ROW_HEIGHT * VISIBLE_ROWS,
                            overflow: 'hidden',
                            position: 'relative',
                            WebkitMaskImage:
                                'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 33%, rgba(0,0,0,1) 66%, transparent 100%)',
                            maskImage:
                                'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,1) 33%, rgba(0,0,0,1) 66%, transparent 100%)',
                        }}
                    >
                        <div
                            ref={sliderRef}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transition: 'transform 0.5s ease',
                            }}
                        >
                            {/* prev */}
                            <div
                                style={{
                                    height: ROW_HEIGHT,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'flex-start',
                                    padding: '0 16px',
                                    color: '#afafaf',
                                }}
                            >
                                <span
                                    style={{
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        minWidth: 0,
                                        flex: 1,
                                    }}
                                >
                                    {getItemOrEmpty(prevIndex)}
                                </span>
                            </div>

                            {/* current */}
                            <div
                                onClick={handleCenterClick}
                                style={{
                                    height: ROW_HEIGHT,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'flex-start',
                                    padding: '0 16px',
                                    color: '#afafaf',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >
                                <span
                                    style={{
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        minWidth: 0,
                                        flex: 1,
                                    }}
                                >
                                    {getItemOrEmpty(currentIndex)}
                                </span>
                            </div>

                            {/* next */}
                            <div
                                style={{
                                    height: ROW_HEIGHT,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'flex-start',
                                    padding: '0 16px',
                                    color: '#afafaf',
                                }}
                            >
                                <span
                                    style={{
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        minWidth: 0,
                                        flex: 1,
                                    }}
                                >
                                    {getItemOrEmpty(nextIndex)}
                                </span>
                            </div>
                        </div>

                        <div
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                height: ROW_HEIGHT,
                                width: '100%',
                                border: '1px solid #afafaf',
                                borderRadius: 10,
                                pointerEvents: 'none',
                                boxSizing: 'border-box',
                            }}
                        />
                    </div>
                </div>

                {/* Speed Toggle Controls */}
                <div className='w-full flex bg-[#222] rounded-md p-1 mb-2'>
                    <button
                        onClick={() => toggleSpeed('fast')}
                        className={`flex-1 text-[10px] py-1 rounded-sm transition-colors ${
                            sendSpeed === 'fast'
                                ? 'bg-[#444] text-white font-bold shadow-sm'
                                : 'text-[#666] hover:text-[#999]'
                        }`}
                        aria-label='Fast mode (2.5s interval)'
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
                        aria-label='Slow mode (8s interval)'
                    >
                        Slow (8s)
                    </button>
                </div>

                {/* Control Buttons */}
                <div className='flex gap-2 text-xs w-full justify-between'>
                    <button
                        type='button'
                        className='flex-1 py-1 border border-[#444] rounded-md hover:bg-[#222]'
                        onClick={startAutoSend}
                        disabled={!questionsLoaded || autoRunning}
                        aria-label='Start auto-send loop'
                    >
                        Start
                    </button>
                    <button
                        type='button'
                        className='flex-1 py-1 border border-[#444] rounded-md hover:bg-[#222]'
                        onClick={stopAutoSend}
                        disabled={!autoRunning}
                        aria-label='Stop auto-send loop'
                    >
                        Stop
                    </button>
                    <button
                        type='button'
                        className='flex-1 py-1 border border-[#444] rounded-md hover:bg-[#222]'
                        onClick={handleReloadQuestions}
                        aria-label='Reload questions from backend'
                    >
                        Reload
                    </button>
                </div>

                {!questionsLoaded && (
                    <div className='mt-2 text-[11px] text-neutral-500'>
                        Couldn&apos;t load questions.json
                    </div>
                )}
            </div>

            {/* Chat Panel - Right Side */}
            <div className='flex-1 flex flex-col border border-[#242426] rounded-lg overflow-hidden'>
                {/* Chat Header */}
                <div className='px-3 py-2 border-b border-[#242426] flex items-center justify-between text-sm'>
                    <span className='font-unbounded'>Chatting</span>
                    <div className='flex items-center gap-3'>
                        <button
                            onClick={handleUpdateConfig}
                            className='px-2 py-1 text-xs border border-[#444] rounded-md hover:bg-[#222] text-[#9f9f9f]'
                            title='Reload config.json & Reconnect'
                            aria-label='Update configuration'
                        >
                            Update config
                        </button>
                        <div className='h-4 w-[1px] bg-[#333]' />
                        <span
                            className={
                                connected ? 'text-green-400' : 'text-red-400'
                            }
                        >
                            {connected ? 'online' : 'offline'}
                        </span>
                        <button
                            onClick={handleReconnect}
                            title='Reconnect Socket'
                            className='h-[28px] w-[28px] flex items-center justify-center text-[#9f9f9f] rounded-md hover:text-secondary hover:bg-[#222]'
                            aria-label='Reconnect WebSocket'
                        >
                            <span className='rotate-icon text-xl'>↻</span>
                        </button>
                    </div>
                </div>

                {/* Messages Container */}
                <div
                    ref={messagesContainerRef}
                    className='flex-1 overflow-auto p-3 bg-primary space-y-2 text-sm scroll-thin'
                >
                    {messages.map((m) => (
                        <div
                            key={m.id}
                            className={`max-w-[80%] rounded-lg px-3 py-2 ${
                                m.sender === 'User'
                                    ? 'ml-auto bg-[#333]'
                                    : 'mr-auto bg-[#222222]'
                            }`}
                        >
                            <div className='text-[10px] opacity-60 mb-1'>
                                {m.sender === 'User' ? 'You' : 'Mio'}
                            </div>
                            <div>{m.text}</div>
                        </div>
                    ))}
                    {messages.length === 0 && (
                        <div className='text-xs text-neutral-500'>
                            use how u like.
                        </div>
                    )}
                </div>

                {/* Input Form */}
                <form
                    onSubmit={handleSubmit}
                    className='border-t border-primary p-2 flex gap-2'
                >
                    <input
                        className='flex-1 bg-[#101010] text-sm px-3 py-2 rounded-md outline-none border border-[#222] focus:border-[#333] input-placeholder-dark'
                        placeholder='type here...'
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        aria-label='Chat input'
                    />
                    <button
                        type='submit'
                        className='px-4 py-2 text-sm rounded-md hover:bg-[#222]'
                        disabled={!input.trim()}
                        aria-label='Send message'
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
}
