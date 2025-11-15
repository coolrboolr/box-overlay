import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "../components/chat/ChatPanel";
import { toggleChatPanel, useOverlayState } from "../state/overlayStore";
import { OVERLAY_Z_INDEX } from "./overlay";

function OverlayChrome(): JSX.Element {
  const { chatPanelOpen } = useOverlayState();
  const launcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.body.dataset.llmChatOpen = chatPanelOpen ? "true" : "false";
    return () => {
      delete document.body.dataset.llmChatOpen;
    };
  }, [chatPanelOpen]);

  return (
    <>
      <div className="llm-overlay-toolbar" role="toolbar" aria-label="Overlay controls">
        <div className="llm-overlay-toolbar__spacer" />
        <button
          ref={launcherRef}
          type="button"
          className={`llm-chat-launcher${chatPanelOpen ? " llm-chat-launcher--active" : ""}`}
          aria-pressed={chatPanelOpen}
          aria-expanded={chatPanelOpen}
          aria-controls="llm-chat-panel"
          onClick={() => toggleChatPanel()}
        >
          Chat
        </button>
      </div>
      <ChatPanel launcherRef={launcherRef} />
    </>
  );
}

export function mountChatShell(): void {
  const existing = document.getElementById("llm-overlay-chat-root");
  if (existing) {
    return;
  }

  const container = document.createElement("div");
  container.id = "llm-overlay-chat-root";
  container.className = "llm-overlay-shell";
  container.style.zIndex = `${OVERLAY_Z_INDEX + 5}`;
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(<OverlayChrome />);
}
