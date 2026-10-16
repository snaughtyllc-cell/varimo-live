import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { HqSsoExchange } from "@/components/auth/HqSsoExchange";
import { resetHqSsoForTests } from "@/lib/hqSso";

beforeEach(() => {
  resetHqSsoForTests();
  window.history.replaceState(null, "", "/sso/hq");
});

describe("HqSsoExchange", () => {
  it("does not show a token and asks for a fresh HQ link when the fragment is empty", async () => {
    render(<HqSsoExchange />);
    expect(await screen.findByText(/sign-in link is missing/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Opening Varimo" })).toBeInTheDocument();
  });
});
