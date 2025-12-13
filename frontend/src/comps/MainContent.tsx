import React, { useEffect, useRef, useState } from 'react';
import * as AppAPI from '../../wailsjs/go/main/App';

// ==== Константы WebSocket ====
const TOKEN =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJFTzVUcmt2YzhrT0k1dzNzd3hpb21RIiwibmFtZSI6Imdtbm92YSIsInRva2VuX3ZlcnNpb24iOiIxIiwicm9sZSI6IlVzZXIiLCJuYmYiOjE3NjUwMzE2NTYsImV4cCI6MTc3MDIxNTY1NiwiaWF0IjoxNzY1MDMxNjU2LCJpc3MiOiJEcmVhbWlhLkJhY2tlbmQiLCJhdWQiOiJEcmVhbWlhLlVzZXJzIn0.6X62mrZr45COrhDKELvB-vGRsI1UJnWDySqKSwGYCW8';
const AGENT_ID = 'NbbX98RMRkOLrNAutJqPKQ';

type ChatMessage = {
    id: string;
    text: string;
    sender: 'User' | 'Agent';
};

type IncomingChatMsg = {
    type: 'ChatMsg';
    id: string;
    text: string;
    sender: 'User' | 'Agent';
};

type IncomingChatMsgList = {
    type: 'ChatMsgList';
    messages: IncomingChatMsg[];
};

function genId(len = 20) {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    for (let i = 0; i < len; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
    }
    return res;
}

// ==== Параметры слайдера ====
const ROW_HEIGHT = 50;
const VISIBLE_ROWS = 3;

// таймаут «тишины» после последнего чанка, мс
const STREAM_SILENCE_MS = 3500;

// интервал между вопросами (ожидание ответа + пауза)
const AUTO_SEND_INTERVAL_MS = 8000;

// буфер по id для стриминга агента
type AgentBufferItem = {
    text: string;
    shownLength: number;
    timerId: number | null;
};

export default function MainContent() {
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);

    const [questions, setQuestions] = useState<string[]>([]);
    const [questionsLoaded, setQuestionsLoaded] = useState(false);

    // автоотправка
    const [autoRunning, setAutoRunning] = useState(false);
    const autoTimerRef = useRef<number | null>(null);

    // индекс текущего вопроса
    const autoIndexRef = useRef<number>(0);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isSliding, setIsSliding] = useState(false);

    const sliderRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);

    // стриминг агента по id
    const agentBuffersRef = useRef<Map<string, AgentBufferItem>>(new Map());

    // ==== загрузка вопросов ====
    const loadQuestions = async () => {
        try {
            const qs = (await (AppAPI as any).GetQuestions()) as string[];
            if (Array.isArray(qs) && qs.length > 0) {
                setQuestions(qs);
                setQuestionsLoaded(true);
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

    useEffect(() => {
        loadQuestions();
    }, []);

    // автоскролл чата
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [messages]);

    // ====== стриминг агента: flush и таймер тишины ======
    const flushAgentById = (id: string) => {
        const map = agentBuffersRef.current;
        const item = map.get(id);
        if (!item) return;

        const finalText = item.text.trim();
        if (item.timerId !== null) {
            clearTimeout(item.timerId);
        }
        map.delete(id);

        if (!finalText) return;

        setMessages((prev) => [
            ...prev,
            {
                id,
                text: finalText,
                sender: 'Agent',
            },
        ]);
    };

    const scheduleFlushAgentById = (id: string) => {
        const map = agentBuffersRef.current;
        const item = map.get(id);
        if (!item) return;

        if (item.timerId !== null) {
            clearTimeout(item.timerId);
        }

        const timerId = window.setTimeout(() => {
            flushAgentById(id);
        }, STREAM_SILENCE_MS);

        item.timerId = timerId;
        map.set(id, item);
    };

    // ==== WebSocket ====
    const createSocket = () => {
        const socket = new WebSocket(
            `wss://api.youmio.ai/api/chat?agentId=${AGENT_ID}&token=${TOKEN}`,
        );

        socket.onopen = () => {
            setConnected(true);
        };

        socket.onerror = () => {
            setConnected(false);
        };

        socket.onclose = () => {
            setConnected(false);
        };

        socket.onmessage = (event) => {
            try {
                const raw = JSON.parse(event.data.toString()) as
                    | IncomingChatMsg
                    | IncomingChatMsgList
                    | any;

                if (raw.type === 'ChatMsg') {
                    handleIncomingChatMsg(raw);
                }

                if (
                    raw.type === 'ChatMsgList' &&
                    Array.isArray(raw.messages)
                ) {
                    const last = raw.messages[raw.messages.length - 1];
                    if (last) {
                        handleIncomingChatMsg(last);
                    }
                }
            } catch {
                // ignore
            }
        };

        setWs(socket);
    };

    // ====== входящий чанк от агента (дельтовая логика) ======
    const handleIncomingChatMsg = (msg: IncomingChatMsg) => {
        if (msg.sender !== 'Agent') return;

        const id = msg.id || genId();
        const full = msg.text ?? '';
        if (!full) return;

        const map = agentBuffersRef.current;
        const existing =
            map.get(id) || ({ text: '', shownLength: 0, timerId: null } as AgentBufferItem);

        // backend шлёт полный текст, уже набранный ранее
        const prevLen = existing.text.length;
        const part = full.slice(prevLen);

        if (!part) {
            // ничего нового, только перезапускаем таймер тишины
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

    useEffect(() => {
        createSocket();
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

    const handleReconnect = () => {
        if (ws) {
            try {
                ws.onopen = null;
                ws.onclose = null;
                ws.onerror = null;
                ws.onmessage = null;
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

    // ==== отправка сообщения ====
    const sendMessage = (text: string) => {
        if (!ws || ws.readyState !== WebSocket.OPEN || !text.trim()) return;

        const trimmed = text.trim();

        const msg = {
            type: 'ChatMsg',
            id: genId(),
            text: trimmed,
            sender: 'User',
            createdAts: Math.floor(Date.now() / 1000),
            url: null,
            b64Data: null,
            skill: null,
            messageType: 'text',
            audioEnabled: false,
            files: [] as any[],
            isBuffer: false,
        };

        ws.send(JSON.stringify(msg));

        setMessages((prev) => [
            ...prev,
            { id: msg.id, text: trimmed, sender: 'User' },
        ]);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        sendMessage(input);
        setInput('');
        stopAutoSend();
    };

    // ==== слайдер ====
    const getItemOrEmpty = (index: number) => {
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

        setIsSliding(true);

        track.style.transition = 'none';
        track.style.transform = 'translateY(0px)';
        void track.offsetHeight;
        track.style.transition = 'transform 0.5s ease';

        requestAnimationFrame(() => {
            track.style.transform = `translateY(${-ROW_HEIGHT}px)`;
        });

        const handler = () => {
            track.removeEventListener('transitionend', handler);

            setCurrentIndex(nextIndex);

            track.style.transition = 'none';
            track.style.transform = 'translateY(0px)';
            void track.offsetHeight;
            track.style.transition = 'transform 0.5s ease';

            setIsSliding(false);
            cb();
        };

        track.addEventListener('transitionend', handler, { once: true });
    };

    // ==== автоотправка пачки вопросов ====
    const stopAutoSend = () => {
        if (autoTimerRef.current !== null) {
            clearInterval(autoTimerRef.current);
            autoTimerRef.current = null;
        }
        setAutoRunning(false);
    };

    const sendQuestionByIndex = (index: number) => {
        if (index < 0 || index >= questions.length) return;
        const q = questions[index];
        if (!q) return;
        sendMessage(q);
    };

    const startAutoSend = () => {
        if (!questions.length) return;
        if (autoTimerRef.current !== null) return;

        setAutoRunning(true);

        autoIndexRef.current = currentIndex;
        sendQuestionByIndex(autoIndexRef.current);

        autoTimerRef.current = window.setInterval(() => {
            if (isSliding) return;

            const current = autoIndexRef.current;
            const next = current + 1;

            if (next >= questions.length) {
                stopAutoSend();
                return;
            }

            animateToIndex(next, () => {
                autoIndexRef.current = next;
                sendQuestionByIndex(autoIndexRef.current);
            });
        }, AUTO_SEND_INTERVAL_MS);
    };

    const handleReloadQuestions = async () => {
        stopAutoSend();
        await loadQuestions();
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
        <div className='flex-1 p-4 overflow-hidden bg-primary text-[#afafaf] flex gap-4'>
            {/* Левая часть: слайдер вопросов + кнопки */}
            <div className='w-[260px] bg-primary flex flex-col items-center justify-center'>
                <div className='relative w-full mb-3'>
                    <div
                        ref={sliderRef}
                        className='slider-track'
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transition: 'transform 0.5s ease',
                        }}
                    >
                        <div
                            className='slide-item'
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
                                className='slide-text'
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
                        <div
                            className='slide-item cursor-pointer'
                            style={{
                                height: ROW_HEIGHT,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                                padding: '0 16px',
                                color: '#ffffff',
                                fontWeight: 600,
                            }}
                            onClick={handleCenterClick}
                        >
                            <span
                                className='slide-text'
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
                        <div
                            className='slide-item'
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
                                className='slide-text'
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
                        className='slider-window'
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
                            className='slider-frame'
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

                <div className='flex gap-2 text-xs'>
                    <button
                        type='button'
                        className='px-3 py-1 border border-[#444] rounded-md hover:bg-[#222]'
                        onClick={startAutoSend}
                        disabled={!questionsLoaded || autoRunning}
                    >
                        Start
                    </button>
                    <button
                        type='button'
                        className='px-3 py-1 border border-[#444] rounded-md hover:bg-[#222]'
                        onClick={stopAutoSend}
                        disabled={!autoRunning}
                    >
                        Stop
                    </button>
                    <button
                        type='button'
                        className='px-3 py-1 border border-[#444] rounded-md hover:bg-[#222]'
                        onClick={handleReloadQuestions}
                    >
                        Reload
                    </button>
                </div>

                {!questionsLoaded && (
                    <div className='mt-2 text-[11px] text-neutral-500'>
                        Couldn't load questions.json
                    </div>
                )}
            </div>

            {/* Правая часть: чат */}
            <div className='flex-1 flex flex-col border border-[#242426] rounded-lg overflow-hidden'>
                <div className='px-3 py-2 border-b border-[#242426] flex items-center justify-between text-sm'>
                    <span className='font-unbounded'>Chatting</span>
                    <div className='flex items-center gap-2'>
                        <span
                            className={
                                connected ? 'text-green-400' : 'text-red-400'
                            }
                        >
                            {connected ? 'online' : 'offline'}
                        </span>
                        <button
                            onClick={handleReconnect}
                            className="h-[33px] w-[33px] justify-center text-[#9f9f9f] rounded-md hover:text-secondary hover:bg-[#222]"
                        >
                            <span className="rotate-icon text-xl">↻</span>
                        </button>
                    </div>
                </div>

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
                            Напишите сообщение, кликните по центральному вопросу
                            или нажмите Start для автоотправки.
                        </div>
                    )}
                </div>

                <form
                    onSubmit={handleSubmit}
                    className='border-t border-primary p-2 flex gap-2'
                >
                    <input
                        className='flex-1 bg-[#101010] text-sm px-3 py-2 rounded-md outline-none border border-[#222] focus:border-[#333] input-placeholder-dark'
                        placeholder='type here...'
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                    <button
                        type='submit'
                        className='px-4 py-2 text-sm rounded-md hover:bg-[#222]'
                        disabled={!connected || !input.trim()}
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
}
