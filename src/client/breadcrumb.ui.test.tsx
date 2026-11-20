/** @vitest-environment happy-dom */
import { ThemeProvider } from "@emotion/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pathSegments, type PathSegment } from "../core/paths";
import { buildTheme } from "../core/theme";
import { abbreviateMiddle, Breadcrumb, CRUMB_NAV_DELAY_MS } from "./breadcrumb";

afterEach(() => cleanup());

function renderCrumbs(
  segments: PathSegment[],
  separator: string,
  handlers: {
    onBeginEdit?: () => void;
    onNavigate?: (segment: PathSegment) => void;
  } = {},
) {
  const onBeginEdit = handlers.onBeginEdit ?? vi.fn();
  const onNavigate = handlers.onNavigate ?? vi.fn();
  const view = render(
    <ThemeProvider theme={buildTheme()}>
      <Breadcrumb
        segments={segments}
        separator={separator}
        editing={false}
        draft=""
        onDraft={() => undefined}
        onBeginEdit={onBeginEdit}
        onCommit={() => undefined}
        onCancel={() => undefined}
        onNavigate={onNavigate}
      />
    </ThemeProvider>,
  );
  return { ...view, onBeginEdit, onNavigate };
}

function settleClick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, CRUMB_NAV_DELAY_MS + 30));
}

describe("Breadcrumb", () => {
  const bucket = "dnrmmrrd-k8s-poc-dept-transfer-994770696818-ap-southeast-2-an";
  const segments = pathSegments("s3", "file-transfer/", bucket);

  it("abbreviates a long segment, shows the full label on hover, and still navigates", async () => {
    const { onNavigate, onBeginEdit } = renderCrumbs(segments, "/");
    const button = screen.getByRole("button", { name: bucket });
    expect(button.textContent).toBe(abbreviateMiddle(bucket));
    expect(button.getAttribute("title")).toBe(bucket);
    fireEvent.click(button);
    expect(onNavigate).not.toHaveBeenCalled();
    await settleClick();
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ label: bucket, container: bucket, prefix: "" }));
    expect(onBeginEdit).not.toHaveBeenCalled();
  });

  it("edits on double-click and navigates from an earlier segment on a single click", async () => {
    const { onBeginEdit, onNavigate } = renderCrumbs(segments, "/");
    const current = screen.getByRole("button", { name: "file-transfer" });
    fireEvent.click(current);
    expect(onBeginEdit).not.toHaveBeenCalled();
    fireEvent.doubleClick(current);
    expect(onBeginEdit).toHaveBeenCalledOnce();

    const parent = screen.getByRole("button", { name: "Buckets" });
    fireEvent.click(parent);
    fireEvent.doubleClick(parent);
    await settleClick();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onBeginEdit).toHaveBeenCalledTimes(2);

    fireEvent.click(parent);
    await settleClick();
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ label: "Buckets", container: "", prefix: "" }));
  });

  it("does not double the slash already shown by the filesystem root", () => {
    const home = pathSegments("local", "/Users/preview", "", "linux");
    renderCrumbs(home, "/");
    const root = screen.getByRole("button", { name: "/" });
    expect(root.nextElementSibling?.textContent).toBe("Users");
    expect(screen.getByRole("button", { name: "preview" }).previousElementSibling?.textContent).toBe("/");
  });

  it("uses the platform separator and keeps the tail scrolled into view", async () => {
    const windows = pathSegments("local", "C:\\Users\\Public\\Documents", "", "win32");
    const { rerender, onNavigate } = renderCrumbs(windows, "\\");
    expect(screen.getAllByText("\\")).toHaveLength(windows.length - 1);
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    await settleClick();
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ label: "Users", prefix: "C:\\Users" }));

    const track = screen.getByTestId("breadcrumb");
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 640 });
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 180 });
    rerender(
      <ThemeProvider theme={buildTheme()}>
        <Breadcrumb
          segments={[...windows, { label: "nested", prefix: "C:\\Users\\Public\\Documents\\nested" }]}
          separator="\\"
          editing={false}
          draft=""
          onDraft={() => undefined}
          onBeginEdit={() => undefined}
          onCommit={() => undefined}
          onCancel={() => undefined}
          onNavigate={onNavigate}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("breadcrumb").scrollLeft).toBe(460);
  });

  it("selects the path for editing and lets copy, paste, and select-all through", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <ThemeProvider theme={buildTheme()}>
        <Breadcrumb
          segments={pathSegments("local", "C:\\projects\\agsadmin", "", "win32")}
          separator="\\"
          editing
          draft={"C:\\projects\\agsadmin"}
          onDraft={() => undefined}
          onBeginEdit={() => undefined}
          onCommit={onCommit}
          onCancel={onCancel}
          onNavigate={() => undefined}
          isUnchanged={(text) => text === "C:\\projects\\agsadmin"}
        />
      </ThemeProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Location" }) as HTMLInputElement;
    expect(input.value).toBe("C:\\projects\\agsadmin");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    for (const key of ["c", "v", "a"]) {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels a blur that did not change the path and commits one that did", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <ThemeProvider theme={buildTheme()}>
        <Breadcrumb
          segments={[]}
          separator="\\"
          editing
          draft={"C:\\projects"}
          onDraft={() => undefined}
          onBeginEdit={() => undefined}
          onCommit={onCommit}
          onCancel={onCancel}
          onNavigate={() => undefined}
          isUnchanged={(text) => text.replace(/\\+$/, "") === "C:\\projects"}
        />
      </ThemeProvider>,
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Location" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();

    view.rerender(
      <ThemeProvider theme={buildTheme()}>
        <Breadcrumb
          segments={[]}
          separator="\\"
          editing
          draft={"D:\\Games"}
          onDraft={() => undefined}
          onBeginEdit={() => undefined}
          onCommit={onCommit}
          onCancel={onCancel}
          onNavigate={() => undefined}
          isUnchanged={(text) => text.replace(/\\+$/, "") === "C:\\projects"}
        />
      </ThemeProvider>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Location" }), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("D:\\Games");
  });
});
