import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SyncControls } from "../src/app/SyncControls.js";
import type { DriveSyncController } from "../src/hooks/use-drive-sync.js";
import type { SyncMetadataV1 } from "../src/sync/sync-metadata.js";

const DEVICE_A = "00000000-0000-4000-8000-000000000001";

function metadata(connected = false): SyncMetadataV1 {
  return {
    version: 1,
    deviceId: DEVICE_A,
    account: connected ? {
      permissionId: "account-a",
      emailAddress: "viewer@example.test",
      displayName: "Viewer",
      connectedAt: "2024-09-02T12:00:00.000Z",
    } : null,
  };
}

function controller(overrides: Partial<DriveSyncController> = {}): DriveSyncController {
  return {
    status: {
      kind: "local",
      label: "Local only",
      detail: "Seen history is stored only in this browser.",
    },
    googleReady: true,
    googleError: null,
    busy: false,
    pendingAccount: null,
    connect: vi.fn(async () => undefined),
    confirmConnection: vi.fn(async () => undefined),
    cancelConnection: vi.fn(),
    syncNow: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    afterLocalChange: vi.fn(),
    ...overrides,
  };
}

describe("sync controls", () => {
  it("explains local-only operation and offers optional Drive connection", async () => {
    const user = userEvent.setup();
    const sync = controller();
    const onOpenChange = vi.fn();
    render(
      <SyncControls
        metadata={metadata()}
        controller={sync}
        open
        onOpenChange={onOpenChange}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Google Drive sync" })).toBeInTheDocument();
    expect(screen.getByText(/no server/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Connect Google Drive" }));
    expect(sync.connect).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("requires an explicit merge or replacement choice and offers an export first", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    const sync = controller({
      pendingAccount: {
        permissionId: "account-b",
        emailAddress: "other@example.test",
        displayName: "Other",
      },
    });
    render(
      <SyncControls
        metadata={metadata(true)}
        controller={sync}
        open
        onOpenChange={vi.fn()}
        onExport={onExport}
      />,
    );

    expect(screen.getByRole("dialog", { name: "How should this browser connect?" })).toBeInTheDocument();
    expect(screen.getByText(/different from the account/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Merge browser and Drive/ })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /Merge browser and Drive/ })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Export first" }));
    expect(onExport).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /Merge browser and Drive/ }));
    expect(sync.confirmConnection).toHaveBeenCalledWith("merge");
  });

  it("shows the bound account and keeps disconnect explicit", async () => {
    const user = userEvent.setup();
    const sync = controller({
      status: { kind: "synced", label: "Synced at 12:00", detail: "Up to date." },
    });
    render(
      <SyncControls
        metadata={metadata(true)}
        controller={sync}
        open
        onOpenChange={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByText("viewer@example.test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(sync.disconnect).toHaveBeenCalledOnce();
  });
});
