import React, { useEffect, useRef, useState } from 'react';
import * as AppAPI from '../../wailsjs/go/main/App';

// ==== типы ====

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

type AgentConfig = {
    id: string;          // и для WebSocket (agentId), и для REST /characters/{id}
    token: string;
    name?: string;       // подтягиваем с REST
};

// буфер по id для стриминга агента
type AgentBufferItem = {
    text: string;
    shownLength: number;
    timerId: number | null;
};

// ==== утилиты ====

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

export default function MainContent() {
    // агенты
    const [agents, setAgents] = useState<AgentConfig[]>([]);
    const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);

    // WebSocket для текущего агента
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [connectedByAgent, setConnectedByAgent] = useState<
        Record<string, boolean>
    >({});
    const connected =
        currentAgentId && connectedByAgent[currentAgentId]
            ? connectedByAgent[currentAgentId]
            : false;

    // чат по агентам
    const [messagesByAgent, setMessagesByAgent] = useState<
        Record<string, ChatMessage[]>
    >({});
    const currentMessages =
        currentAgentId && messagesByAgent[currentAgentId]
            ? messagesByAgent[currentAgentId]
            : [];

    // вопросы общий пул
    const [questions, setQuestions] = useState<string[]>([]);
    const [questionsLoaded, setQuestionsLoaded] = useState(false);

    // автоотправка по агентам
    const [autoRunningByAgent, setAutoRunningByAgent] = useState<
        Record<string, boolean>
    >({});
    const autoTimerRefByAgent = useRef<Record<string, number | null>>({});
    const autoIndexRefByAgent = useRef<Record<string, number>>({});

    // индекс текущего вопроса по агентам
    const [currentIndexByAgent, setCurrentIndexByAgent] = useState<
        Record<string, number>
    >({});
    const [isSliding, setIsSliding] = useState(false);

    const sliderRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);

    // стриминг агента: буферы по агенту и message id
    const agentBuffersRef = useRef<Map<string, Map<string, AgentBufferItem>>>(
        new Map(),
    );

    // ==== загрузка вопросов ====
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

    // ==== загрузка агентов из Go ====
    const loadAgents = async () => {
        try {
            const rawAgents = (await (AppAPI as any).GetAgents()) as AgentConfig[];
            const normalized = Array.isArray(rawAgents) ? rawAgents : [];
            setAgents(normalized);

            if (normalized.length > 0) {
                setCurrentAgentId(normalized[0].id);
            }
        } catch {
            setAgents([]);
            setCurrentAgentId(null);
        }
    };

    // ==== загрузка имени агентов через REST ====
    useEffect(() => {
        if (!agents.length) return;

        let aborted = false;

        const fetchNames = async () => {
            const updated: AgentConfig[] = [];
            for (const a of agents) {
                try {
                    const resp = await fetch(
                        `https://api.youmio.ai/api/characters/${a.id}`,
                    );
                    if (!resp.ok) {
                        updated.push(a);
                        continue;
                    }
                    const data = (await resp.json()) as { name?: string };
                    updated.push({
                        ...a,
                        name: data.name || a.name || a.id,
                    });
                } catch {
                    updated.push(a);
                }
            }
            if (!aborted) {
                setAgents(updated);
            }
        };

        fetchNames();

        return () => {
            aborted = true;
        };
    }, [agents.length]);

    useEffect(() => {
        loadQuestions();
        loadAgents();
    }, []);

    // автоскролл чата
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [currentMessages]);

    // ====== стриминг агента: flush и таймер тишины ======
    const getBufferMapForAgent = (agentId: string) => {
        let map = agentBuffersRef.current.get(agentId);
        if (!map) {
            map = new Map<string, AgentBufferItem>();
            agentBuffersRef.current.set(agentId, map);
        }
        return map;
    };

    const flushAgentById = (agentId: string, msgId: string) => {
        const map = getBufferMapForAgent(agentId);
        const item = map.get(msgId);
        if (!item) return;

        const finalText = item.text.trim();
        if (item.timerId !== null) {
            clearTimeout(item.timerId);
        }
        map.delete(msgId);

        if (!finalText) return;

        setMessagesByAgent((prev) => {
            const prevMsgs = prev[agentId] ?? [];
            return {
                ...prev,
                [agentId]: [
                    ...prevMsgs,
                    {
                        id: msgId,
                        text: finalText,
                        sender: 'Agent',
                    },
                ],
            };
        });
    };

    const scheduleFlushAgentById = (agentId: string, msgId: string) => {
        const map = getBufferMapForAgent(agentId);
        const item = map.get(msgId);
        if (!item) return;

        if (item.timerId !== null) {
            clearTimeout(item.timerId);
        }

        const timerId = window.setTimeout(() => {
            flushAgentById(agentId, msgId);
        }, STREAM_SILENCE_MS);

        item.timerId = timerId;
        map.set(msgId, item);
    };

    // ==== WebSocket ====
    const createSocket = (agent: AgentConfig) => {
        const socket = new WebSocket(
            `wss://api.youmio.ai/api/chat?agentId=${agent.id}&token=${agent.token}`,
        );

        socket.onopen = () => {
            setConnectedByAgent((prev) => ({
                ...prev,
                [agent.id]: true,
            }));
        };

        socket.onerror = () => {
            setConnectedByAgent((prev) => ({
                ...prev,
                [agent.id]: false,
            }));
        };

        socket.onclose = () => {
            setConnectedByAgent((prev) => ({
                ...prev,
                [agent.id]: false,
            }));
        };

        socket.onmessage = (event) => {
            try {
                const raw = JSON.parse(event.data.toString()) as
                    | IncomingChatMsg
                    | IncomingChatMsgList
                    | any;

                if (raw.type === 'ChatMsg') {
                    handleIncomingChatMsg(agent.id, raw);
                }

                if (
                    raw.type === 'ChatMsgList' &&
                    Array.isArray(raw.messages)
                ) {
                    const last = raw.messages[raw.messages.length - 1];
                    if (last) {
                        handleIncomingChatMsg(agent.id, last);
                    }
                }
            } catch {
                // ignore
            }
        };

        setWs(socket);
    };

    // ====== входящий чанк от агента (дельтовая логика) ======
    const handleIncomingChatMsg = (agentId: string, msg: IncomingChatMsg) => {
        if (msg.sender !== 'Agent') return;

        const id = msg.id || genId();
        const full = msg.text ?? '';
        if (!full) return;

        const map = getBufferMapForAgent(agentId);
        const existing =
            map.get(id) ||
            ({ text: '', shownLength: 0, timerId: null } as AgentBufferItem);

        // backend шлёт полный текст, уже набранный ранее
        const prevLen = existing.text.length;
        const part = full.slice(prevLen);

        if (!part) {
            // ничего нового, только перезапускаем таймер тишины
            scheduleFlushAgentById(agentId, id);
            return;
        }

        const newText = existing.text + part;
        const updated: AgentBufferItem = {
            text: newText,
            shownLength: newText.length,
            timerId: existing.timerId,
        };

        map.set(id, updated);
        scheduleFlushAgentById(agentId, id);
    };

    // при монтировании — сокет для стартового агента (если есть)
    useEffect(() => {
        if (!currentAgentId || !agents.length) return;

        const agent = agents.find((a) => a.id === currentAgentId);
        if (!agent) return;

        // если уже есть ws для другого агента — закрываем
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

        createSocket(agent);

        return () => {
            if (ws) {
                try {
                    ws.close();
                } catch {
                    // ignore
                }
            }
            const buffers = agentBuffersRef.current.get(agent.id);
            if (buffers) {
                buffers.forEach((item) => {
                    if (item.timerId !== null) clearTimeout(item.timerId);
                });
                agentBuffersRef.current.delete(agent.id);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentAgentId, agents.length]);

    const handleReconnect = () => {
        if (!currentAgentId) return;
        const agent = agents.find((a) => a.id === currentAgentId);
        if (!agent) return;

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
        setConnectedByAgent((prev) => ({
            ...prev,
            [agent.id]: false,
        }));

        const buffers = agentBuffersRef.current.get(agent.id);
        if (buffers) {
            buffers.forEach((item) => {
                if (item.timerId !== null) clearTimeout(item.timerId);
            });
            agentBuffersRef.current.delete(agent.id);
        }

        createSocket(agent);
    };

    const handleAgentChange = (newId: string) => {
        if (!newId || newId === currentAgentId) return;
        setCurrentAgentId(newId);
    };

    // ==== отправка сообщения ====
    const sendMessage = (text: string) => {
        if (!currentAgentId || !ws || ws.readyState !== WebSocket.OPEN || !text.trim()) {
            return;
        }

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

        setMessagesByAgent((prev) => {
            const prevMsgs = prev[currentAgentId] ?? [];
            return {
                ...prev,
                [currentAgentId]: [
                    ...prevMsgs,
                    { id: msg.id, text: trimmed, sender: 'User' },
                ],
            };
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;
        sendMessage(input);
        setInput('');
        if (currentAgentId) stopAutoSend(currentAgentId);
    };

    // ==== слайдер ====
    const getCurrentIndex = (agentId: string | null) => {
        if (!agentId) return 0;
        return currentIndexByAgent[agentId] ?? 0;
    };

    const setCurrentIndexForAgent = (agentId: string, index: number) => {
        setCurrentIndexByAgent((prev) => ({
            ...prev,
            [agentId]: index,
        }));
    };

    const getItemOrEmpty = (index: number) => {
        if (index < 0 || index >= questions.length) return '';
        return questions[index];
    };

    const animateToIndex = (nextIndex: number, cb: () => void) => {
        const track = sliderRef.current;
        if (!track) {
            if (currentAgentId) {
                setCurrentIndexForAgent(currentAgentId, nextIndex);
            }
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

            if (currentAgentId) {
                setCurrentIndexForAgent(currentAgentId, nextIndex);
            }

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
    const isAutoRunningFor = (agentId: string | null) => {
        if (!agentId) return false;
        return !!autoRunningByAgent[agentId];
    };

    const stopAutoSend = (agentId: string) => {
        const timers = autoTimerRefByAgent.current;
        const timerId = timers[agentId];
        if (timerId !== null && timerId !== undefined) {
            clearInterval(timerId);
            timers[agentId] = null;
        }
        setAutoRunningByAgent((prev) => ({
            ...prev,
            [agentId]: false,
        }));
    };

    const sendQuestionByIndex = (index: number) => {
        if (index < 0 || index >= questions.length) return;
        const q = questions[index];
        if (!q) return;
        sendMessage(q);
    };

    const startAutoSend = (agentId: string) => {
        if (!questions.length) return;
        const timers = autoTimerRefByAgent.current;
        if (timers[agentId] !== null && timers[agentId] !== undefined) return;

        setAutoRunningByAgent((prev) => ({
            ...prev,
            [agentId]: true,
        }));

        const currentIndex = getCurrentIndex(agentId);
        autoIndexRefByAgent.current[agentId] = currentIndex;
        sendQuestionByIndex(currentIndex);

        const intervalId = window.setInterval(() => {
            if (isSliding) return;

            const current = autoIndexRefByAgent.current[agentId] ?? 0;
            const next = current + 1;

            if (next >= questions.length) {
                stopAutoSend(agentId);
                return;
            }

            animateToIndex(next, () => {
                autoIndexRefByAgent.current[agentId] = next;
                sendQuestionByIndex(next);
            });
        }, AUTO_SEND_INTERVAL_MS);

        timers[agentId] = intervalId;
    };


    const handleReloadQuestions = async () => {
        if (currentAgentId) {
            stopAutoSend(currentAgentId);
        }
        await loadQuestions();
    };

    const [input, setInput] = useState('');

    const currentIndex = getCurrentIndex(currentAgentId);
    const prevIndex = currentIndex - 1;
    const nextIndex = currentIndex + 1;

    const handleCenterClick = () => {
        const q = getItemOrEmpty(currentIndex);
        if (!q) return;
        setInput(q);
        if (currentAgentId) stopAutoSend(currentAgentId);
    };

    const autoRunning = isAutoRunningFor(currentAgentId);

    return (
        <div className="flex-1 p-4 overflow-hidden bg-primary text-[#afafaf] flex gap-4">
            {/* Левая часть: слайдер вопросов + кнопки */}
            <div className="w-[260px] bg-primary flex flex-col items-center justify-center">
                <div className="relative w-full mb-3">
                    <div
                        ref={sliderRef}
                        className="slider-track"
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transition: 'transform 0.5s ease',
                        }}
                    >
                        <div
                            className="slide-item"
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
                                className="slide-text"
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
                            className="slide-item cursor-pointer"
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
                                className="slide-text"
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
                            className="slide-item"
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
                                className="slide-text"
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
                        className="slider-window"
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
                            className="slider-frame"
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

                <div className="flex gap-2 text-xs">
                    <button
                        type="button"
                        className="px-3 py-1 border border-[#444] rounded-md hover:bg-[#222]"
                        onClick={() => currentAgentId && startAutoSend(currentAgentId)}
                        disabled={!questionsLoaded || !currentAgentId || autoRunning}
                    >
                        Start
                    </button>
                    <button
                        type="button"
                        className="px-3 py-1 border border-[#444] rounded-md hover:bg-[#222]"
                        onClick={() => currentAgentId && stopAutoSend(currentAgentId)}
                        disabled={!currentAgentId || !autoRunning}
                    >
                        Stop
                    </button>
                    <button
                        type="button"
                        className="px-3 py-1 border border-[#444] rounded-md hover:bg-[#222]"
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
                    <div className="flex items-center gap-2">
                        <select
                            className="bg-[#101010] border border-[#242426] rounded-md px-2 py-1 text-xs"
                            value={currentAgentId ?? ''}
                            onChange={(e) => handleAgentChange(e.target.value)}
                        >
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name ?? a.id}
                                </option>
                            ))}
                        </select>
                        <span className="font-unbounded">Chatting</span>
                    </div>
                    <div className="flex items-center gap-2">
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
                    className="flex-1 overflow-auto p-3 bg-primary space-y-2 text-sm scroll-thin"
                >
                    {currentMessages.map((m) => (
                        <div
                            key={m.id}
                            className={`max-w-[80%] rounded-lg px-3 py-2 ${
                                m.sender === 'User'
                                    ? 'ml-auto bg-[#333]'
                                    : 'mr-auto bg-[#222222]'
                            }`}
                        >
                            <div className="text-[10px] opacity-60 mb-1">
                                {m.sender === 'User' ? 'You' : 'Mio'}
                            </div>
                            <div>{m.text}</div>
                        </div>
                    ))}
                    {currentMessages.length === 0 && (
                        <div className="text-xs text-neutral-500">
                            use how u like.
                        </div>
                    )}
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="border-t border-primary p-2 flex gap-2"
                >
                    <input
                        className="flex-1 bg-[#101010] text-sm px-3 py-2 rounded-md outline-none border border-[#222] focus:border-[#333] input-placeholder-dark"
                        placeholder="type here..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="px-4 py-2 text-sm rounded-md hover:bg-[#222]"
                        disabled={!connected || !input.trim()}
                    >
                        Send
                    </button>
                </form>
            </div>
        </div>
    );
}
