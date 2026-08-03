import { useState, useEffect } from "react";
import type { ReactNode } from "react";

const TOAST_TIMEOUT = 5000;

export interface ToastProps {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
}

let memoryState: ToastProps[] = [];
let listeners: Array<(state: ToastProps[]) => void> = [];

export function toast(props: Omit<ToastProps, "id">) {
  const id = Math.random().toString(36).substring(2, 9);
  const newToast = { ...props, id };
  memoryState = [...memoryState, newToast];
  listeners.forEach((l) => l(memoryState));

  setTimeout(() => {
    memoryState = memoryState.filter((t) => t.id !== id);
    listeners.forEach((l) => l(memoryState));
  }, TOAST_TIMEOUT);
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastProps[]>(memoryState);

  useEffect(() => {
    listeners.push(setToasts);
    return () => {
      listeners = listeners.filter((l) => l !== setToasts);
    };
  }, []);

  return { toasts, toast };
}
