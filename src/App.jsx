import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  createApi,
  DEFAULT_API_URL,
  normalizePhone,
  pollNotifications,
} from "./api.js";
import { applyNotification } from "./messages.js";

function Logo({ small = false }) {
  return (
    <span className={`logo ${small ? "small" : ""}`}>
      <MessageCircle aria-hidden="true" strokeWidth={3} />
    </span>
  );
}
function ErrorBox({ children }) {
  return children ? (
    <div className="error" role="alert">
      {children}
    </div>
  ) : null;
}
const clock = (time) =>
  new Date(time).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

function Login({ onLogin }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    controller.current = new AbortController();
    try {
      const credentials = Object.fromEntries(
        [...form.entries()].map(([key, value]) => [key, value.trim()]),
      );
      const api = createApi(credentials);
      const state = await api.state(controller.current.signal);
      if (state.stateInstance !== "authorized")
        throw new Error(
          "Авторизуйте инстанс MAX в личном кабинете GREEN-API и повторите вход.",
        );
      const settings = await api.settings(controller.current.signal);
      if (settings.webhookUrl || settings.incomingWebhook !== "yes")
        throw new Error(
          "В настройках инстанса включите входящие уведомления и очистите webhookUrl. Подождите минуту и повторите вход.",
        );
      onLogin({ api, id: credentials.idInstance });
    } catch (err) {
      if (!controller.current.signal.aborted) setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page wallpaper">
      <header className="landing-header">
        <div className="brand">
          <Logo small />
          <strong>MAX</strong>
          <span className="brand-divider" />
          <span>веб-чат</span>
        </div>
        <a
          href="https://green-api.com/v3/docs/"
          target="_blank"
          rel="noreferrer"
        >
          <CircleHelp size={18} /> Помощь
        </a>
      </header>
      <section className="login-card">
        <Logo />
        <h1>Ближе, чем кажется</h1>
        <p className="intro">
          Ваши сообщения в MAX.
          <br />
          Просто, удобно, в одном окне.
        </p>
        <form onSubmit={submit}>
          <label>
            idInstance
            <input
              name="idInstance"
              placeholder="Например, 3100000000"
              inputMode="numeric"
              required
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label>
            apiTokenInstance
            <input
              name="apiTokenInstance"
              type="password"
              placeholder="Токен из личного кабинета"
              required
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <details>
            <summary>Адрес сервера API</summary>
            <label className="api-label">
              apiUrl
              <input
                name="apiUrl"
                type="url"
                defaultValue={DEFAULT_API_URL}
                required
                disabled={busy}
              />
            </label>
            <p className="field-hint">
              Укажите apiUrl вашего инстанса из GREEN-API.
            </p>
          </details>
          <ErrorBox>{error}</ErrorBox>
          <button className="primary login-button" disabled={busy}>
            {busy ? "Подключаемся…" : "Войти в чат"}
            {!busy && <ArrowRight size={19} />}
          </button>
        </form>
        <div className="privacy">
          <ShieldCheck size={17} />
          <span>Токен хранится только в памяти вкладки</span>
        </div>
        <div className="login-bottom">
          Нет учётных данных?{" "}
          <a
            href="https://console.green-api.com/"
            target="_blank"
            rel="noreferrer"
          >
            Открыть GREEN-API ↗
          </a>
        </div>
      </section>
      <footer className="landing-footer">
        На базе GREEN-API <span>•</span> Независимый клиент для MAX
      </footer>
    </main>
  );
}

function Chat({ session, onLogout }) {
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const activeRef = useRef(null);
  const [query, setQuery] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [phone, setPhone] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const lifecycle = useRef(null);
  const bottom = useRef(null);
  const dialog = useRef(null);
  const chat = chats.find((item) => item.id === activeId);
  const draft = drafts[activeId] || "";

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    void pollNotifications(
      session.api,
      controller.signal,
      (body) =>
        setChats((current) =>
          applyNotification(current, body, activeRef.current),
        ),
      setConnectionError,
    );
    return () => controller.abort();
  }, [session]);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [activeId, chat?.messages.length]);
  useEffect(() => {
    if (newChat) dialog.current?.showModal();
    else dialog.current?.close();
  }, [newChat]);

  function select(id) {
    activeRef.current = id;
    setActiveId(id);
    setSendError("");
    setChats((current) =>
      current.map((item) => (item.id === id ? { ...item, unread: 0 } : item)),
    );
  }
  async function createChat(event) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError("");
    const signal = lifecycle.current.signal;
    try {
      const normalized = normalizePhone(phone);
      const existing = chats.find((item) => item.phone === normalized);
      if (existing) {
        select(existing.id);
        setNewChat(false);
        return;
      }
      const result = await session.api.check(normalized, signal);
      if (signal.aborted) return;
      if (result.exist === false)
        throw new Error(
          "Пользователь не найден в MAX. Проверьте номер и настройки поиска получателя.",
        );
      if (!result.exist || !result.chatId)
        throw new Error(
          "Не удалось проверить номер. Проверьте состояние инстанса и повторите позже.",
        );
      const id = String(result.chatId);
      setChats((current) =>
        current.some((item) => item.id === id)
          ? current.map((item) =>
              item.id === id ? { ...item, phone: normalized } : item,
            )
          : [
              {
                id,
                phone: normalized,
                name: `+${normalized}`,
                unread: 0,
                messages: [],
              },
              ...current,
            ],
      );
      select(id);
      setNewChat(false);
      setPhone("");
    } catch (err) {
      if (!signal.aborted) setCreateError(err.message);
    } finally {
      if (!signal.aborted) setCreating(false);
    }
  }
  async function send(event) {
    event?.preventDefault();
    if (!draft.trim() || sendingRef.current || !chat || draft.length > 4000)
      return;
    const id = chat.id,
      text = draft;
    const signal = lifecycle.current.signal;
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    try {
      const result = await session.api.send(id, text, signal);
      if (signal.aborted) return;
      if (!result?.idMessage)
        throw new Error("GREEN-API не подтвердил отправку.");
      setChats((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: result.idMessage,
                    text,
                    direction: "out",
                    time: Date.now(),
                    status: "queued",
                  },
                ],
              }
            : item,
        ),
      );
      setDrafts((current) => ({
        ...current,
        [id]: current[id] === text ? "" : current[id],
      }));
    } catch (err) {
      if (!signal.aborted)
        setSendError(
          `${err.message} Текст сохранён. Если запрос прервался, проверьте MAX перед повторной отправкой.`,
        );
    } finally {
      sendingRef.current = false;
      if (!signal.aborted) setSending(false);
    }
  }
  const visibleChats = chats.filter((item) =>
    `${item.name} ${item.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <main className={`messenger ${activeId ? "chat-selected" : ""}`}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand">
            <Logo small />
            <strong>MAX</strong>
          </div>
          <button
            className="icon-button"
            title="Выйти"
            aria-label="Выйти"
            onClick={onLogout}
          >
            <LogOut size={20} />
          </button>
        </header>
        <div className="sidebar-title">
          <h1>Сообщения</h1>
          <button
            className="icon-button add"
            aria-label="Новый чат"
            onClick={() => {
              setCreateError("");
              setNewChat(true);
            }}
          >
            <Plus size={23} />
          </button>
        </div>
        <div className="search">
          <Search size={18} />
          <input
            aria-label="Поиск чатов"
            placeholder="Поиск"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="chat-list">
          {visibleChats.length ? (
            visibleChats.map((item) => {
              const last = item.messages.at(-1);
              return (
                <button
                  className={`chat-row ${activeId === item.id ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => select(item.id)}
                >
                  <span className="avatar">
                    {item.name.startsWith("+") ? (
                      <MessageCircle size={24} />
                    ) : (
                      item.name.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="chat-row-text">
                    <span className="chat-row-top">
                      <strong>{item.name}</strong>
                      {last && <time>{clock(last.time)}</time>}
                    </span>
                    <span className="chat-row-bottom">
                      <span>
                        {last
                          ? `${last.direction === "out" ? "Вы: " : ""}${last.text}`
                          : "Начните общение"}
                      </span>
                      {item.unread > 0 && (
                        <b className="unread">{item.unread}</b>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="list-empty">
              <MessageCircle size={29} />
              <strong>
                {query ? "Ничего не найдено" : "Здесь будут ваши чаты"}
              </strong>
              <p>
                {query
                  ? "Попробуйте другой запрос"
                  : "Нажмите +, чтобы написать первым"}
              </p>
            </div>
          )}
        </div>
        <footer className="account">
          <span className={`status-dot ${connectionError ? "offline" : ""}`} />
          <div>
            <strong>
              {connectionError
                ? "Восстанавливаем связь"
                : "Подключено к GREEN-API"}
            </strong>
            <span>Инстанс {session.id}</span>
          </div>
        </footer>
      </aside>
      <section className="conversation wallpaper" aria-label="Переписка">
        {chat ? (
          <>
            <header className="conversation-header">
              <button
                className="icon-button mobile-back"
                aria-label="Назад к чатам"
                onClick={() => select(null)}
              >
                <ArrowLeft />
              </button>
              <span className="avatar compact">
                <MessageCircle size={22} />
              </span>
              <div>
                <h2>{chat.name}</h2>
                <p>
                  {chat.phone && chat.name !== `+${chat.phone}`
                    ? `+${chat.phone} · `
                    : ""}
                  MAX · текстовые сообщения
                </p>
              </div>
            </header>
            {connectionError && (
              <div className="connection-error" role="status">
                {connectionError}
              </div>
            )}
            <div
              className="messages"
              role="log"
              aria-label="Сообщения чата"
              aria-live="polite"
            >
              {chat.messages.length === 0 ? (
                <div className="chat-start">
                  <span>Начало переписки</span>
                  <p>Напишите первое сообщение 👋</p>
                </div>
              ) : (
                chat.messages.map((message, index) => (
                  <div key={message.id}>
                    {(index === 0 ||
                      new Date(message.time).toDateString() !==
                        new Date(
                          chat.messages[index - 1].time,
                        ).toDateString()) && (
                      <div className="date-divider">
                        {new Date(message.time).toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "long",
                        })}
                      </div>
                    )}
                    <article className={`bubble ${message.direction}`}>
                      <div>{message.text}</div>
                      <footer>
                        <time>{clock(message.time)}</time>
                        {message.direction === "out" && (
                          <span
                            title={
                              message.status === "queued"
                                ? "Принято API в очередь"
                                : message.status
                            }
                          >
                            {message.status === "failed" ? (
                              "Не доставлено"
                            ) : message.status === "queued" ? (
                              "В очереди"
                            ) : (
                              <Check size={14} />
                            )}
                          </span>
                        )}
                      </footer>
                    </article>
                  </div>
                ))
              )}
              <div ref={bottom} />
            </div>
            <div className="composer-area">
              <ErrorBox>{sendError}</ErrorBox>
              <form className="composer" onSubmit={send}>
                <textarea
                  aria-label="Сообщение"
                  placeholder="Напишите сообщение…"
                  rows={1}
                  maxLength={4000}
                  value={draft}
                  onChange={(e) =>
                    setDrafts((current) => ({
                      ...current,
                      [activeId]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  className="send-button"
                  aria-label="Отправить сообщение"
                  disabled={sending || !draft.trim()}
                >
                  <Send size={21} />
                </button>
              </form>
              <div className="composer-hint">
                <span>
                  {sending
                    ? "Отправляем…"
                    : "Enter — отправить · Shift + Enter — новая строка"}
                </span>
                <span>{draft.length} / 4000</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="empty-conversation">
              <div className="empty-icon">
                <MessageCircle size={44} strokeWidth={1.6} />
              </div>
              <h2>
                Хороший разговор
                <br />
                начинается с «Привет»
              </h2>
              <p>
                Создайте чат по номеру телефона
                <br />и общайтесь в MAX прямо здесь.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setCreateError("");
                  setNewChat(true);
                }}
              >
                <Plus size={19} /> Новый чат
              </button>
              <span className="empty-note">
                Только вы, собеседник и ваши сообщения
              </span>
            </div>
            {connectionError && (
              <div className="empty-warning">
                <ErrorBox>{connectionError}</ErrorBox>
              </div>
            )}
          </>
        )}
      </section>
      <dialog
        ref={dialog}
        onCancel={() => {
          if (!creating) setNewChat(false);
        }}
        onClose={() => setNewChat(false)}
      >
        <form onSubmit={createChat}>
          <div className="dialog-heading">
            <h2>Новый чат</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Закрыть"
              disabled={creating}
              onClick={() => setNewChat(false)}
            >
              <X size={20} />
            </button>
          </div>
          <p>Введите номер телефона получателя в MAX.</p>
          <label>
            Номер телефона
            <input
              autoFocus
              type="tel"
              placeholder="+7 999 123-45-67"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              disabled={creating}
            />
          </label>
          <p className="field-hint">Поддерживаются номера России и Беларуси.</p>
          <ErrorBox>{createError}</ErrorBox>
          <button className="primary" disabled={creating}>
            {creating ? "Ищем пользователя…" : "Создать чат"}
            <ArrowRight size={18} />
          </button>
        </form>
      </dialog>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  return session ? (
    <Chat session={session} onLogout={() => setSession(null)} />
  ) : (
    <Login onLogin={setSession} />
  );
}
