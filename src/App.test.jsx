import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

it("connects, resolves a phone to MAX id, sends text, receives reply in the same chat and logs out", async () => {
  let deliver;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, options) => {
      const response = (value) => ({ ok: true, json: async () => value });
      if (url.includes("/getStateInstance/"))
        return response({ stateInstance: "authorized" });
      if (url.includes("/getSettings/"))
        return response({ incomingWebhook: "yes", webhookUrl: "" });
      if (url.includes("/checkAccount/"))
        return response({ exist: true, chatId: "123" });
      if (url.includes("/sendMessage/"))
        return response({ idMessage: "out-1" });
      if (url.includes("/deleteNotification/"))
        return response({ result: true });
      if (url.includes("/receiveNotification/"))
        return new Promise((resolve, reject) => {
          deliver = (body) => resolve(response({ receiptId: 42, body }));
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      throw new Error("Unexpected request");
    });
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText("idInstance"), "3100000000");
  await user.type(screen.getByLabelText("apiTokenInstance"), "test-token");
  await user.click(screen.getByRole("button", { name: "Войти в чат" }));
  await screen.findByText("Сообщения");
  await user.click(screen.getAllByRole("button", { name: "Новый чат" })[0]);
  await user.type(screen.getByLabelText("Номер телефона"), "+7 999 123-45-67");
  await user.click(screen.getByRole("button", { name: "Создать чат" }));
  await user.type(await screen.findByLabelText("Сообщение"), "Привет, MAX!");
  await user.click(screen.getByRole("button", { name: "Отправить сообщение" }));
  await screen.findByText("В очереди");
  const send = fetch.mock.calls.find(([url]) => url.includes("/sendMessage/"));
  expect(JSON.parse(send[1].body)).toEqual({
    chatId: "123",
    message: "Привет, MAX!",
  });
  deliver({
    typeWebhook: "incomingMessageReceived",
    idMessage: "reply-1",
    senderData: { chatId: "123", chatType: "user" },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: "Привет в ответ!" },
    },
  });
  await screen.findByText("Привет в ответ!", { selector: ".bubble > div" });
  expect(document.querySelectorAll(".chat-row")).toHaveLength(1);
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([url]) =>
        url.includes("/deleteNotification/test-token/42"),
      ),
    ).toBe(true),
  );
  await user.click(screen.getByRole("button", { name: "Выйти" }));
  expect(screen.getByLabelText("apiTokenInstance")).toHaveValue("");
});

it("keeps the user on login when HTTP API settings are incompatible", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => ({
    ok: true,
    json: async () =>
      url.includes("getStateInstance")
        ? { stateInstance: "authorized" }
        : { incomingWebhook: "no", webhookUrl: "https://example.com" },
  }));
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText("idInstance"), "3100000000");
  await user.type(screen.getByLabelText("apiTokenInstance"), "test-token");
  await user.click(screen.getByRole("button", { name: "Войти в чат" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "включите входящие уведомления",
  );
});
