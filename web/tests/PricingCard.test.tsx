import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  listBillingPlans: vi.fn(),
  startBillingCheckout: vi.fn(),
}));

import { listBillingPlans, startBillingCheckout } from "@/lib/api";
import { PricingCard } from "@/components/auth/PricingCard";

describe("PricingCard", () => {
  beforeEach(() => {
    vi.mocked(listBillingPlans).mockReset();
    vi.mocked(startBillingCheckout).mockReset();
    vi.mocked(listBillingPlans).mockResolvedValue({
      configured: true,
      plans: [{
        id: "agency",
        name: "Agency",
        price_usd: 200,
        included_fast_hours: 90,
        typical_fast20_minutes: 10,
        typical_fast20_packs: 540,
        typical_fast20_copies: 10800,
        overage_usd_per_hour: 0.75,
        cogs_fast_usd_per_hour: 0.58,
      }],
    });
    vi.mocked(startBillingCheckout).mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_1",
      session_id: "cs_1",
    });
  });

  it("explains included Fast hours then overage, not fake unlimited", async () => {
    render(<PricingCard />);
    await waitFor(() => {
      expect(screen.getByText(/90 Fast worker-hours/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/\$0\.75\/hr/i)).toBeInTheDocument();
    expect(screen.getByText(/not a hard stop/i)).toBeInTheDocument();
    expect(screen.getByText(/10 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/540 packs/i)).toBeInTheDocument();
    expect(screen.getByText(/10,800 copies/i)).toBeInTheDocument();
    expect(screen.queryByText(/we pay about/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Subscribe — \$200\/month/i })).toBeEnabled();
  });

  it("starts Stripe Checkout with the work email", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    render(<PricingCard />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Subscribe/i })).toBeEnabled();
    });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "buyer@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Subscribe/i }));
    await waitFor(() => {
      expect(startBillingCheckout).toHaveBeenCalledWith("buyer@x.com", "agency");
    });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1");
    });
    vi.unstubAllGlobals();
  });
});
