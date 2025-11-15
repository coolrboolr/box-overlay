import { useSyncExternalStore } from "react";

export interface OverlayUiState {
  chatPanelOpen: boolean;
}

type OverlayListener = () => void;

let state: OverlayUiState = {
  chatPanelOpen: false
};

const listeners = new Set<OverlayListener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function setState(partial: Partial<OverlayUiState>): void {
  const next = { ...state, ...partial };
  if (Object.is(next.chatPanelOpen, state.chatPanelOpen)) {
    return;
  }
  state = next;
  emit();
}

export function subscribeOverlay(listener: OverlayListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOverlayState(): OverlayUiState {
  return state;
}

export function openChatPanel(): void {
  setState({ chatPanelOpen: true });
}

export function closeChatPanel(): void {
  setState({ chatPanelOpen: false });
}

export function toggleChatPanel(): void {
  setState({ chatPanelOpen: !state.chatPanelOpen });
}

export function resetOverlayUi(): void {
  setState({ chatPanelOpen: false });
}

export function useOverlayState(): OverlayUiState {
  return useSyncExternalStore(subscribeOverlay, getOverlayState);
}
