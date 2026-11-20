/** @vitest-environment happy-dom */
import { ThemeProvider } from "@emotion/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pathSegments, type PathSegment } from "../core/paths";
import { buildTheme } from "../core/theme";
import { abbreviateMiddle, Breadcrumb } from "./breadcrumb";

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

describe("Breadcrumb", () => {
  const bucket = "dnrmmrrd-k8s-poc-dept-transfer-994770696818-ap-southeast-2-an";
  const segments = pathSegments("s3", "file-transfer/", bucket);

  it("abbreviates a long segment, shows the full label on hover, and still navigates", () => {
    const { onNavigate, onBeginEdit } = renderCrumbs(segments, "/");
    const button = screen.getByRole("button", { name: bucket });
    expect(button.textContent).toBe(abbreviateMiddle(bucket));
    expect(button.getAttribute("title")).toBe(bucket);
    fireEvent.click(button);
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ label: bucket, container: bucket, prefix: "" }));
    expect(onBeginEdit).not.toHaveBeenCalled();
  });

  it("edits when the current segment is clicked and navigates from an earlier one", () => {
    const { onBeginEdit, onNavigate } = renderCrumbs(segments, "/");
    fireEvent.click(screen.getByRole("button", { name: "file-transfer" }));
    expect(onBeginEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Buckets" }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ label: "Buckets", container: "", prefix: "" }));
  });

  it("does not double the slash already shown by the filesystem root", () => {
    const home = pathSegments("local", "/Users/preview", "", "linux");
    renderCrumbs(home, "/");
    const root = screen.getByRole("button", { name: "/" });
    expect(root.nextElementSibling?.textContent).toBe("Users");
    expect(screen.getByRole("button", { name: "preview" }).previousElementSibling?.textContent).toBe("/");
  });

  it("uses the platform separator and keeps the tail scrolled into view", () => {
    const windows = pathSegments("local", "C:\\Users\\Public\\Documents", "", "win32");
    const { rerender, onNavigate } = renderCrumbs(windows, "\\");
    expect(screen.getAllByText("\\")).toHaveLength(windows.length - 1);
    fireEvent.click(screen.getByRole("button", { name: "Users" }));
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
});
