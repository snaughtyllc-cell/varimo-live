import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryFloatingToolbar } from "@/components/gallery/GalleryFloatingToolbar";

describe("GalleryFloatingToolbar", () => {
  it("shows the selection count and fires each action", () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <GalleryFloatingToolbar
        count={3}
        onSend={onSend}
        sendDisabled={false}
        onSave={onSave}
        saveLabel="Save to phone"
        saveDisabled={false}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("3 variants selected")).toBeInTheDocument();
    expect(document.querySelector(".gallery-floating-toolbar__actions")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /send to drive/i }));
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Save to phone" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses singular copy for exactly one selected variant", () => {
    render(
      <GalleryFloatingToolbar
        count={1}
        onSend={() => undefined}
        sendDisabled={false}
        onSave={() => undefined}
        saveLabel="Save to phone"
        saveDisabled={false}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("1 variant selected")).toBeInTheDocument();
  });

  it("disables Send/Save and blocks their handlers when the disabled flags are set", () => {
    const onSend = vi.fn();
    const onSave = vi.fn();
    render(
      <GalleryFloatingToolbar
        count={1}
        onSend={onSend}
        sendDisabled
        sendTitle="Nothing ready to send"
        onSave={onSave}
        saveLabel="Save to phone"
        saveDisabled
        saveTitle="Select clips first"
        onClose={() => undefined}
      />,
    );

    const sendBtn = screen.getByRole("button", { name: /send to drive/i });
    const saveBtn = screen.getByRole("button", { name: "Save to phone" });
    expect(sendBtn).toBeDisabled();
    expect(saveBtn).toBeDisabled();

    fireEvent.click(sendBtn);
    fireEvent.click(saveBtn);
    expect(onSend).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
