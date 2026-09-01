import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePrompt } from "../src/app/UpdatePrompt.js";

const serviceWorkerMocks = vi.hoisted(() => ({
  update: vi.fn(),
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, serviceWorkerMocks.setOfflineReady],
    needRefresh: [true, serviceWorkerMocks.setNeedRefresh],
    updateServiceWorker: serviceWorkerMocks.update,
  }),
}));

describe("UpdatePrompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the user deliberately activate a waiting service worker", async () => {
    const user = userEvent.setup();
    render(<UpdatePrompt />);

    expect(screen.getByRole("alert")).toHaveTextContent("A fresh Flixate is ready");
    await user.click(screen.getByRole("button", { name: "Reload" }));

    expect(serviceWorkerMocks.update).toHaveBeenCalledWith(true);
  });

  it("lets the user postpone an update", async () => {
    const user = userEvent.setup();
    render(<UpdatePrompt />);

    await user.click(screen.getByRole("button", { name: "Later" }));

    expect(serviceWorkerMocks.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(serviceWorkerMocks.setOfflineReady).toHaveBeenCalledWith(false);
  });
});
