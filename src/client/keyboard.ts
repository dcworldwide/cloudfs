/** Copy, paste, cut, and select-all belong to a focused field. The file pane must leave them alone. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { tagName?: string; isContentEditable?: boolean };
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable === true;
}
