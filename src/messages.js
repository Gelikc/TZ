export function applyNotification(chats, body, activeId) {
  if (body.typeWebhook === "outgoingMessageStatus") {
    return chats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.id === body.idMessage
          ? { ...message, status: body.status }
          : message,
      ),
    }));
  }
  if (body.typeWebhook !== "incomingMessageReceived") return chats;
  const data = body.messageData;
  const text =
    data?.typeMessage === "textMessage"
      ? data.textMessageData?.textMessage
      : data?.typeMessage === "extendedTextMessage"
        ? data.extendedTextMessageData?.text
        : undefined;
  const sender = body.senderData;
  if (
    typeof text !== "string" ||
    !body.idMessage ||
    !sender?.chatId ||
    sender.chatType === "group"
  )
    return chats;
  const id = String(sender.chatId);
  const found = chats.find((chat) => chat.id === id);
  if (found?.messages.some((message) => message.id === body.idMessage))
    return chats;
  const chat = found || {
    id,
    name:
      sender.senderContactName || sender.senderName || sender.chatName || id,
    phone: sender.senderPhoneNumber ? String(sender.senderPhoneNumber) : "",
    messages: [],
    unread: 0,
  };
  const updated = {
    ...chat,
    unread: activeId === id ? 0 : chat.unread + 1,
    messages: [
      ...chat.messages,
      {
        id: body.idMessage,
        text,
        direction: "in",
        time: body.timestamp ? body.timestamp * 1000 : Date.now(),
      },
    ],
  };
  return found
    ? chats.map((item) => (item.id === id ? updated : item))
    : [updated, ...chats];
}
