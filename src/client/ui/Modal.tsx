import type { ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogDescription, DialogPopup, DialogTitle, IconButton } from "./primitives";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop />
        <DialogPopup>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
            <DialogTitle>{title}</DialogTitle>
            <IconButton title="Close" aria-label="Close" onClick={onClose}>
              ×
            </IconButton>
          </div>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
          {children}
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
