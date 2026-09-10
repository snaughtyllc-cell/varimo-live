import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listBillingPlans } from "@/lib/api";
import { LandingClient } from "@/app/landing/LandingClient";
vi.mock("@/lib/api", () => ({ listBillingPlans: vi.fn() }));
const play = vi.fn().mockResolvedValue(undefined);
const pause = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn()})));
  Object.defineProperty(HTMLMediaElement.prototype, "play", {configurable:true,value:play});
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {configurable:true,value:pause});
  vi.mocked(listBillingPlans).mockResolvedValue({configured:true,plans:[{id:"agency",name:"Agency",price_usd:225,included_fast_hours:95,overage_usd_per_hour:0.8,cogs_fast_usd_per_hour:0,typical_fast20_packs:570,typical_fast20_copies:11400}]});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("uses API amounts in every purchase CTA instead of the mockup price", async () => {
  render(<LandingClient />);
  await waitFor(() => expect(screen.getAllByRole("link",{name:"Start Agency — $225/month"})).toHaveLength(4));
  for (const link of screen.getAllByRole("link",{name:/Start Agency/})) expect(link).toHaveAttribute("href","/pricing");
  expect(screen.getByText("95 Fast hours, then $0.80/hr")).toBeInTheDocument();
  expect(screen.queryByText(/\$200/)).not.toBeInTheDocument();
});
it("keeps videos paused for reduced motion and lets users play both", async () => {
  render(<LandingClient />);
  expect(play).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Play product videos"}));
  await waitFor(() => expect(screen.getByRole("button",{name:"Pause product videos"})).toBeInTheDocument());
  expect(play).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button",{name:"Pause product videos"}));
  expect(pause).toHaveBeenCalledTimes(2);
});
it("shows pricing failure without inventing prices or signup confirmations", async () => {
  vi.mocked(listBillingPlans).mockRejectedValue(new Error("offline"));
  const {container} = render(<LandingClient />);
  expect(await screen.findByRole("status")).toHaveTextContent("Live pricing is temporarily unavailable");
  expect(container.querySelector("form")).toBeNull();
  expect(screen.queryByText(/\$200/)).not.toBeInTheDocument();
});
