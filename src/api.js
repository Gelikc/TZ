export const DEFAULT_API_URL = "https://3100.api.green-api.com";

export function normalizePhone(value) {
  if (/[^\d+\s()\-]/.test(value))
    throw new Error("Введите номер телефона без букв.");
  let phone = value.replace(/\D/g, "");
  if (phone.length === 11 && phone.startsWith("8"))
    phone = `7${phone.slice(1)}`;
  if (!/^(7\d{10}|375\d{9})$/.test(phone)) {
    throw new Error(
      "Введите номер РФ (+7) или Беларуси (+375) в международном формате.",
    );
  }
  return phone;
}

export function createApi({ idInstance, apiTokenInstance, apiUrl }) {
  let base;
  try {
    base = new URL(apiUrl);
  } catch {
    throw new Error("Проверьте apiUrl из личного кабинета GREEN-API.");
  }
  if (
    base.protocol !== "https:" ||
    !/^(?:\d+\.api|api)\.green-api\.com$/.test(base.hostname) ||
    base.port ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  ) {
    throw new Error(
      "Используйте HTTPS-адрес API на домене green-api.com из личного кабинета.",
    );
  }
  if (!/^\d+$/.test(idInstance) || !/^[a-zA-Z0-9_-]+$/.test(apiTokenInstance)) {
    throw new Error("Проверьте idInstance и apiTokenInstance.");
  }
  async function request(
    method,
    { body, signal, suffix = "", query = "" } = {},
  ) {
    const timeout = AbortSignal.timeout(45_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(
        `${base.origin}/waInstance${idInstance}/${method}/${apiTokenInstance}${suffix}${query}`,
        {
          method:
            method === "deleteNotification" ? "DELETE" : body ? "POST" : "GET",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: combined,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("Нет ответа от GREEN-API. Проверьте интернет и apiUrl.");
    }
    if (!response.ok) {
      const messages = {
        400: "Проверьте параметры запроса и настройки HTTP API в GREEN-API.",
        401: "Неверные учётные данные.",
        403: "Доступ запрещён. Проверьте токен, тариф и состояние инстанса.",
        429: "Слишком много запросов. Подождите немного.",
        469: "MAX временно ограничил поиск по номеру телефона.",
      };
      throw new Error(
        messages[response.status] ||
          `Ошибка GREEN-API (${response.status}). Попробуйте позже.`,
      );
    }
    return response.json();
  }
  return {
    state: (signal) => request("getStateInstance", { signal }),
    settings: (signal) => request("getSettings", { signal }),
    check: (phone, signal) =>
      request("checkAccount", { body: { phoneNumber: Number(phone) }, signal }),
    send: (chatId, message, signal) =>
      request("sendMessage", { body: { chatId, message }, signal }),
    receive: (signal) =>
      request("receiveNotification", { signal, query: "?receiveTimeout=25" }),
    remove: (receiptId, signal) =>
      request("deleteNotification", {
        signal,
        suffix: `/${encodeURIComponent(receiptId)}`,
      }),
  };
}

export function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

// One consumer: apply first, acknowledge second. Re-delivery is deduplicated by idMessage.
export async function pollNotifications(api, signal, onNotification, onStatus) {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const notification = await api.receive(signal);
      if (signal.aborted) return;
      if (notification) {
        if (notification.receiptId == null || !notification.body)
          throw new Error("Некорректное уведомление GREEN-API.");
        onNotification(notification.body);
        const result = await api.remove(notification.receiptId, signal);
        if (!result?.result)
          throw new Error("Не удалось подтвердить получение сообщения.");
      }
      failures = 0;
      onStatus("");
      await wait(notification ? 150 : 500, signal);
    } catch (error) {
      if (signal.aborted) return;
      onStatus(`${error.message} Повторяем подключение…`);
      await wait(Math.min(2000 * 2 ** failures++, 30000), signal);
    }
  }
}
