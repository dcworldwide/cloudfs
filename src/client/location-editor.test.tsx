/** @vitest-environment happy-dom */
import { ThemeProvider } from "@emotion/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaneLocator } from "../../electron/preload";
import type { PaneState } from "../core/store";
import { buildTheme } from "../core/theme";
import { LocationEditor } from "./breadcrumb";

afterEach(() => cleanup());

function pane(patch: Partial<PaneState>): PaneState {
  return {
    storeId: "local",
    provider: "local",
    container: "",
    prefix: "C:\\projects\\agsadmin",
    ...patch,
  };
}

function renderEditor(current: PaneState, platform: string, probe: (locator: PaneLocator) => Promise<unknown>) {
  const onSelect = vi.fn();
  render(
    <ThemeProvider theme={buildTheme()}>
      <LocationEditor pane={current} platform={platform} onSelect={onSelect} probe={probe} />
    </ThemeProvider>,
  );
  return onSelect;
}

async function editPath(): Promise<HTMLInputElement> {
  fireEvent.doubleClick(screen.getByTestId("breadcrumb"));
  return screen.getByRole("textbox", { name: "Location" }) as HTMLInputElement;
}

describe("LocationEditor", () => {
  it("opens the full path selected, and Enter navigates for Windows, S3, and FTP", async () => {
    const probe = vi.fn(async () => []);
    const onSelect = renderEditor(pane({}), "win32", probe);
    const input = await editPath();
    expect(input.value).toBe("C:\\projects\\agsadmin");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    fireEvent.change(input, { target: { value: "D:\\Games\\" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "agsadmin" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "local", container: "", prefix: "D:\\Games" }),
    );
    expect(onSelect).toHaveBeenCalledWith({ container: "", prefix: "D:\\Games" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the field open and shows an inline error when the path cannot be listed", async () => {
    const probe = vi.fn(async () => {
      throw new Error("ENOENT: no such file or directory, scandir 'C:\\missing'");
    });
    const onSelect = renderEditor(pane({}), "win32", probe);
    const input = await editPath();
    fireEvent.change(input, { target: { value: "C:\\missing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain("That location doesn't exist.");
    expect(screen.getByRole("textbox", { name: "Location" })).toHaveProperty("value", "C:\\missing");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("cancels Escape, and cancels a blur that did not change the location", async () => {
    const probe = vi.fn(async () => []);
    const onSelect = renderEditor(pane({}), "win32", probe);
    const input = await editPath();
    fireEvent.change(input, { target: { value: "C:\\projects\\agsadmin\\" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Location" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "agsadmin" })).toBeTruthy();
    expect(probe).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();

    const again = await editPath();
    fireEvent.change(again, { target: { value: "C:\\other" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "agsadmin" })).toBeTruthy();
    expect(probe).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens an S3 prefix and an FTP directory with that source's path text", async () => {
    const s3Probe = vi.fn(async () => []);
    const onS3 = renderEditor(
      pane({ storeId: "photos", provider: "s3", container: "photos", prefix: "2024/" }),
      "darwin",
      s3Probe,
    );
    const s3 = await editPath();
    expect(s3.value).toBe("photos/2024/");
    fireEvent.change(s3, { target: { value: "photos/2024/trips" } });
    fireEvent.keyDown(s3, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "2024" })).toBeTruthy();
    expect(onS3).toHaveBeenCalledWith({ container: "photos", prefix: "2024/trips/" });

    cleanup();
    const ftpProbe = vi.fn(async () => []);
    const onFtp = renderEditor(pane({ storeId: "ftp", provider: "ftp", prefix: "/incoming" }), "linux", ftpProbe);
    const ftp = await editPath();
    expect(ftp.value).toBe("/incoming");
    fireEvent.change(ftp, { target: { value: "/incoming/drop/" } });
    fireEvent.keyDown(ftp, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "incoming" })).toBeTruthy();
    expect(onFtp).toHaveBeenCalledWith({ container: "", prefix: "/incoming/drop" });
  });
});
