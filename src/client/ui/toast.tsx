import { Toast, ToastRoot, ToastViewport } from "./primitives";

export type ToastTone = "info" | "warning" | "error";

export function Toaster() {
  const { toasts } = Toast.useToastManager<ToastData>();
  return (
    <Toast.Portal>
      <ToastViewport>
        {toasts.map((toast) => (
          <ToastRoot key={toast.id} toast={toast} tone={toast.data?.tone ?? "info"}>
            <Toast.Title>{toast.title}</Toast.Title>
          </ToastRoot>
        ))}
      </ToastViewport>
    </Toast.Portal>
  );
}

interface ToastData {
  tone: ToastTone;
}

export function notify(toastManager: ReturnType<typeof Toast.useToastManager>, tone: ToastTone, title: string): void {
  toastManager.add({ title, type: tone, data: { tone }, timeout: 4000 });
}
