// Re-export the app's single toast store (the one <Toaster /> in App.tsx renders).
// Having a second store here made toasts from pages importing "@/hooks/use-toast" invisible.
export { toast, useToast, type ToastProps } from "@/components/ui/use-toast";
