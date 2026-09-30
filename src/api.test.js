import { describe, it, expect, vi } from "vitest";
import { createApi, normalizePhone, pollNotifications } from "./api.js";
import { applyNotification } from "./messages.js";

const credentials = {
  idInstance: "3100000000",
  apiTokenInstance: "test-token",
  apiUrl: "https://3100.api.green-api.com",
};
const incoming = {
  typeWebhook: "incomingMessageReceived",
  idMessage: "in-1",
  timestamp: 1700000000,
  senderData: { chatId: "123", chatType: "user", senderName: "Анна" },
  messageData: {
    typeMessage: "textMessage",
    textMessageData: { textMessage: "Привет!" },
  },
};

describe("GREEN-API integration", () => {
  it("normalizes Russian and Belarusian numbers and rejects invalid input", () => {
    expect(normalizePhone("8 (999) 123-45-67")).toBe("79991234567");
    expect(normalizePhone("+375 29 123-45-67")).toBe("375291234567");
    expect(() => normalizePhone("123")).toThrow();
    expect(() => normalizePhone("abc79991234567")).toThrow();
  });
  it("does not send tokens to arbitrary hosts", () => {
    expect(() =>
      createApi({
        ...credentials,
        apiUrl: "https://green-api.com.attacker.test",
      }),
    ).toThrow();
    expect(() =>
      createApi({ ...credentials, apiUrl: "http://3100.api.green-api.com" }),
    ).toThrow();
  });
  it("uses documented HTTP methods, payloads and receipt URL", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => ({ result: true }) });
    const api = createApi(credentials);
    await api.check("79991234567");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      phoneNumber: 79991234567,
    });
    await api.send("123", "Привет");
    expect(fetch.mock.calls[1][0]).toContain("/sendMessage/test-token");
    expect(fetch.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      chatId: "123",
      message: "Привет",
    });
    await api.receive();
    expect(fetch.mock.calls[2][0]).toContain(
      "/receiveNotification/test-token?receiveTimeout=25",
    );
    await api.remove(42);
    expect(fetch.mock.calls[3][0]).toContain(
      "/deleteNotification/test-token/42",
    );
    expect(fetch.mock.calls[3][1].method).toBe("DELETE");
  });
  it("applies notifications before acknowledgement and stops on logout", async () => {
    const controller = new AbortController();
    const order = [];
    const api = {
      receive: vi.fn(async () => ({ receiptId: 42, body: incoming })),
      remove: vi.fn(async () => {
        order.push("delete");
        controller.abort();
        return { result: true };
      }),
    };
    await pollNotifications(
      api,
      controller.signal,
      () => order.push("apply"),
      vi.fn(),
    );
    expect(order).toEqual(["apply", "delete"]);
    expect(api.receive).toHaveBeenCalledTimes(1);
  });
  it("retries failed acknowledgements without duplicating messages", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let chats = [],
        attempts = 0;
      const api = {
        receive: vi.fn(async () => ({ receiptId: 1, body: incoming })),
        remove: vi.fn(async () => {
          if (++attempts === 1) throw new Error("network");
          controller.abort();
          return { result: true };
        }),
      };
      const task = pollNotifications(
        api,
        controller.signal,
        (body) => {
          chats = applyNotification(chats, body, null);
        },
        vi.fn(),
      );
      await vi.advanceTimersByTimeAsync(2000);
      await task;
      expect(api.remove).toHaveBeenCalledTimes(2);
      expect(chats[0].messages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores non-text messages and routes incoming text to the existing MAX id", () => {
    const chat = {
      id: "123",
      phone: "79991234567",
      name: "+79991234567",
      messages: [],
      unread: 0,
    };
    const result = applyNotification([chat], incoming, "123");
    expect(result).toHaveLength(1);
    expect(result[0].messages[0].text).toBe("Привет!");
    expect(result[0].unread).toBe(0);
    expect(
      applyNotification(
        result,
        {
          ...incoming,
          idMessage: "file",
          messageData: { typeMessage: "imageMessage" },
        },
        null,
      ),
    ).toBe(result);
  });
});
