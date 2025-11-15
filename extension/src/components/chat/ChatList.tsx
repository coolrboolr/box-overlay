import type { Chat } from "../../types/chat";

interface ChatListProps {
  chats: Chat[];
  selectedChatId?: string;
  onSelect(chatId: string): void;
}

function renderChatButton(chat: Chat, isSelected: boolean, onSelect: (id: string) => void): JSX.Element {
  return (
    <button
      key={chat.chatId}
      type="button"
      className={`llm-chat-list__row${isSelected ? " llm-chat-list__row--active" : ""}`}
      onClick={() => onSelect(chat.chatId)}
      aria-pressed={isSelected}
      aria-label={chat.pinned ? `${chat.title}, pinned chat` : chat.title}
    >
      <span className="llm-chat-list__title">{chat.title}</span>
      {chat.pinned ? <span className="llm-chat-list__pin" aria-hidden="true">★</span> : null}
    </button>
  );
}

export function ChatList({ chats, selectedChatId, onSelect }: ChatListProps): JSX.Element {
  const pinned = chats.filter((chat) => chat.pinned);
  const recent = chats.filter((chat) => !chat.pinned);

  return (
    <div className="llm-chat-list" aria-label="Chats">
      <div className="llm-chat-list__section" aria-label="Pinned chats">
        <div className="llm-chat-list__section-header">
          <h3 className="llm-chat-list__heading">Pinned</h3>
        </div>
        {pinned.length === 0 ? (
          <p className="llm-chat-list__empty">No pinned chats yet.</p>
        ) : (
          <div role="list" className="llm-chat-list__rows">
            {pinned.map((chat) => renderChatButton(chat, chat.chatId === selectedChatId, onSelect))}
          </div>
        )}
      </div>

      <div className="llm-chat-list__section" aria-label="Recent chats">
        <div className="llm-chat-list__section-header">
          <h3 className="llm-chat-list__heading">Recent</h3>
        </div>
        {recent.length === 0 ? (
          <p className="llm-chat-list__empty">No recent chats.</p>
        ) : (
          <div role="list" className="llm-chat-list__rows">
            {recent.map((chat) => renderChatButton(chat, chat.chatId === selectedChatId, onSelect))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatList;
