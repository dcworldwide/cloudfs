import styled from "@emotion/styled";
import { Button as BaseButton } from "@base-ui/react/button";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import { Collapsible } from "@base-ui/react/collapsible";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { Progress } from "@base-ui/react/progress";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { Switch } from "@base-ui/react/switch";
import { Tabs } from "@base-ui/react/tabs";
import { Toast } from "@base-ui/react/toast";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toolbar } from "@base-ui/react/toolbar";

export type ButtonVariant = "normal" | "action" | "danger";

const variantBorder = (variant: ButtonVariant | undefined, color: { border: string; danger: string; primary: string }) =>
  variant === "danger" ? color.danger : variant === "action" ? color.primary : color.border;

const variantBackground = (variant: ButtonVariant | undefined, color: { danger: string; primary: string }) =>
  variant === "danger" ? color.danger : variant === "action" ? color.primary : "transparent";

export const Button = styled(BaseButton)<{ variant?: ButtonVariant }>`
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border-radius: ${({ theme }) => theme.radius}px;
  border: 1px solid ${({ theme, variant }) => variantBorder(variant, theme.color)};
  background: ${({ theme, variant }) => variantBackground(variant, theme.color)};
  color: ${({ theme, variant }) =>
    variant === "action" ? theme.color.primaryText : variant === "danger" ? "#fff" : theme.color.text};
  font: 500 14px ${({ theme }) => theme.font};
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, transform 140ms ease, filter 140ms ease;
  &:hover:not(:disabled) {
    background: ${({ theme, variant }) =>
      variant === "action" || variant === "danger" ? variantBackground(variant, theme.color) : theme.color.surfaceRaised};
    filter: ${({ variant }) => (variant === "action" || variant === "danger" ? "brightness(1.08)" : "none")};
    border-color: ${({ theme, variant }) => (variant ? variantBorder(variant, theme.color) : theme.color.primary)};
  }
  &:active:not(:disabled) {
    transform: translateY(1px);
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 2px;
  }
`;

export const IconButton = styled(Button)`
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
`;

export const CrumbButton = styled(Button)`
  min-height: 28px;
  padding: 0 2px;
  border-color: transparent;
  color: ${({ theme }) => theme.color.muted};
  font: 500 13px ${({ theme }) => theme.font};
  cursor: pointer;
  &:hover,
  &[aria-current="page"] {
    color: ${({ theme }) => theme.color.text};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 2px;
  }
`;

export const MenuTrigger = styled(Menu.Trigger)`
  min-height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.bg};
  color: ${({ theme }) => theme.color.text};
  font: 600 13px ${({ theme }) => theme.font};
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 2px;
  }
`;

export const MenuPopup = styled(Menu.Popup)`
  z-index: 40;
  min-width: 200px;
  padding: ${({ theme }) => theme.space.xs}px;
  border-radius: ${({ theme }) => theme.radius}px;
  background: ${({ theme }) => theme.color.surfaceRaised};
  border: 1px solid ${({ theme }) => theme.color.border};
  color: ${({ theme }) => theme.color.text};
`;

export const MenuItem = styled(Menu.Item)`
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border-radius: 6px;
  font: 400 14px ${({ theme }) => theme.font};
  cursor: pointer;
  &[data-highlighted] {
    background: ${({ theme }) => theme.color.primary};
    color: ${({ theme }) => theme.color.primaryText};
  }
`;

export const TextInput = styled(BaseInput, {
  shouldForwardProp: (prop) => prop !== "as",
})`
  min-height: 40px;
  width: 100%;
  box-sizing: border-box;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border-radius: ${({ theme }) => theme.radius}px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.bg};
  color: ${({ theme }) => theme.color.text};
  font: 400 14px ${({ theme }) => theme.font};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 1px;
  }
`;

export const FieldRoot = styled(Field.Root)`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs}px;
`;

export const FieldLabel = styled(Field.Label)`
  color: ${({ theme }) => theme.color.muted};
  font: 500 12px ${({ theme }) => theme.font};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const DialogBackdrop = styled(Dialog.Backdrop)`
  position: fixed;
  z-index: 40;
  inset: 0;
  background: rgba(8, 12, 22, 0.28);
  backdrop-filter: blur(10px);
  transition: opacity 180ms ease;
  &[data-starting-style],
  &[data-ending-style] {
    opacity: 0;
  }
`;

export const DialogPopup = styled(Dialog.Popup)`
  position: fixed;
  z-index: 40;
  top: 50%;
  left: 50%;
  right: auto;
  bottom: auto;
  height: auto;
  max-height: calc(100vh - 48px);
  overflow: auto;
  width: min(520px, calc(100vw - 32px));
  padding: ${({ theme }) => theme.space.xl}px;
  border-radius: 16px;
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  color: ${({ theme }) => theme.color.text};
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
  transition: transform 200ms ease, opacity 200ms ease;
  &[data-starting-style],
  &[data-ending-style] {
    opacity: 0;
    transform: translate(-50%, -46%) scale(0.98);
  }
`;

export const DialogTitle = styled(Dialog.Title)`
  margin: 0 0 ${({ theme }) => theme.space.sm}px;
  font: 600 18px ${({ theme }) => theme.font};
`;

export const DialogDescription = styled(Dialog.Description)`
  margin: 0 0 ${({ theme }) => theme.space.lg}px;
  color: ${({ theme }) => theme.color.muted};
  font: 400 14px/1.5 ${({ theme }) => theme.font};
`;

export const ProgressTrack = styled(Progress.Track)`
  height: 6px;
  border-radius: 99px;
  background: ${({ theme }) => theme.color.bg};
  overflow: hidden;
`;

export const ProgressIndicator = styled(Progress.Indicator)`
  height: 100%;
  background: ${({ theme }) => theme.color.primary};
  width: var(--progress-percent, 0%);
`;

export const ScrollViewport = styled(ScrollArea.Viewport)`
  height: 100%;
  width: 100%;
  overflow-anchor: none;
  scrollbar-gutter: stable;
`;

export const RowButton = styled(BaseButton, {
  shouldForwardProp: (prop) => prop !== "selected",
})<{ selected?: boolean }>`
  min-height: 40px;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 90px 140px;
  gap: 8px;
  align-items: center;
  text-align: left;
  border: 0;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  padding: 0 ${({ theme }) => theme.space.md}px;
  background: ${({ theme, selected }) => (selected ? theme.color.primary : "transparent")};
  color: ${({ theme, selected }) => (selected ? theme.color.primaryText : theme.color.text)};
  font: 400 13px ${({ theme }) => theme.font};
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: -2px;
  }
  @media (max-width: 900px) {
    grid-template-columns: 1fr 72px;
  }
`;

export const CollapseTrigger = styled(Collapsible.Trigger)`
  width: 100%;
  min-height: 44px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border: 0;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  font: 500 13px ${({ theme }) => theme.font};
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: -2px;
  }
  &[data-panel-open] [data-closed] {
    display: none;
  }
  &:not([data-panel-open]) [data-open] {
    display: none;
  }
`;

export const SwitchRoot = styled(Switch.Root)`
  width: 42px;
  height: 24px;
  padding: 2px;
  border: 0;
  border-radius: 99px;
  background: ${({ theme }) => theme.color.border};
  &[data-checked] {
    background: ${({ theme }) => theme.color.primary};
  }
`;

export const SwitchThumb = styled(Switch.Thumb)`
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 99px;
  background: white;
  transition: transform 120ms ease;
  &[data-checked] {
    transform: translateX(18px);
  }
`;

export const TabList = styled(Tabs.List)`
  position: relative;
  display: flex;
  gap: 4px;
  align-items: center;
  width: auto;
  background: transparent;
`;

export const TabIndicator = styled(Tabs.Indicator)`
  position: absolute;
  z-index: 0;
  left: var(--active-tab-left);
  top: var(--active-tab-top);
  width: var(--active-tab-width);
  height: var(--active-tab-height);
  border-radius: 999px;
  background: ${({ theme }) => theme.color.primary};
  transition: left 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1);
`;

export const Tab = styled(Tabs.Tab)`
  position: relative;
  z-index: 1;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: ${({ theme }) => theme.color.muted};
  font: 500 13px ${({ theme }) => theme.font};
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: color 180ms ease;
  &[data-active] {
    color: ${({ theme }) => theme.color.primaryText};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 2px;
  }
`;

export const ModeGroup = styled(ToggleGroup)`
  display: flex;
  gap: ${({ theme }) => theme.space.sm}px;
`;

export const ModeButton = styled(Toggle)`
  min-height: 40px;
  min-width: 88px;
  padding: 0 ${({ theme }) => theme.space.md}px;
  border-radius: ${({ theme }) => theme.radius}px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  font: 500 14px ${({ theme }) => theme.font};
  cursor: pointer;
  &[data-pressed] {
    background: ${({ theme }) => theme.color.primary};
    border-color: ${({ theme }) => theme.color.primary};
    color: ${({ theme }) => theme.color.primaryText};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.color.primary};
    outline-offset: 2px;
  }
`;

export const ToolbarRoot = styled(Toolbar.Root)`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space.sm}px;
  align-items: center;
`;

export const ToastViewport = styled(Toast.Viewport)`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 28px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
`;

export const ToastRoot = styled(Toast.Root)<{ tone?: "info" | "warning" | "error" }>`
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: min(440px, calc(100vw - 32px));
  padding: 11px 16px;
  border-radius: 999px;
  border: 1px solid ${({ theme, tone }) =>
    tone === "error" ? "rgba(240,113,120,0.45)" : tone === "warning" ? "rgba(224,177,90,0.5)" : theme.color.border};
  background: ${({ theme, tone }) =>
    tone === "error"
      ? theme.mode === "light" ? "rgba(255,236,236,0.86)" : "rgba(62,24,28,0.78)"
      : tone === "warning"
        ? theme.mode === "light" ? "rgba(255,246,226,0.88)" : "rgba(62,46,18,0.78)"
        : theme.mode === "light" ? "rgba(255,255,255,0.78)" : "rgba(22,28,44,0.78)"};
  color: ${({ theme }) => theme.color.text};
  box-shadow: 0 14px 40px rgba(16, 20, 40, 0.18);
  backdrop-filter: blur(18px) saturate(1.3);
  font: 500 13.5px ${({ theme }) => theme.font};
  letter-spacing: -0.01em;
  transform: translateY(0);
  opacity: 1;
  transition: transform 240ms ease, opacity 240ms ease;
  &::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 99px;
    flex: none;
    background: ${({ theme, tone }) => (tone === "error" ? theme.color.danger : tone === "warning" ? "#e0b15a" : theme.color.primary)};
  }
  &[data-starting-style],
  &[data-ending-style] {
    opacity: 0;
    transform: translateY(18px);
  }
`;

export { Collapsible, ContextMenu, Dialog, Menu, Progress, ScrollArea, Switch, Tabs, Toast, Toolbar };
