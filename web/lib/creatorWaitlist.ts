export const CREATOR_BUDGETS = {
  under_25: "Under $25 / month", "25_50": "$25–$50 / month",
  "50_100": "$50–$100 / month", "100_plus": "$100+ / month", unsure: "Not sure yet",
} as const;
export const CREATOR_VOLUMES = {
  under_100: "Under 100 variants", "100_500": "100–500 variants",
  "500_2000": "500–2,000 variants", "2000_plus": "2,000+ variants", unsure: "Not sure yet",
} as const;
export type CreatorSignup = {
  email: string; instagram: string; monthly_budget: keyof typeof CREATOR_BUDGETS;
  monthly_variants: keyof typeof CREATOR_VOLUMES; use_case: string; consent: true; website: string;
};
export type CreatorEntry = Omit<CreatorSignup, "consent" | "website"> & {created_at:string; updated_at:string};
export type CreatorDemand = {total:number; items:CreatorEntry[]; budgets:Record<string,number>; usage:Record<string,number>};
export async function joinCreatorWaitlist(signup: CreatorSignup) {
  const response = await fetch("/api/waitlist/creator", {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(signup),
  });
  if (!response.ok) throw new Error(response.status === 422
    ? "Please check your email and Instagram handle, then try again."
    : "We couldn’t save your signup. Please try again.");
  const result = await response.json();
  if (result.accepted !== true) throw new Error("We couldn’t confirm your signup. Please try again.");
}
export async function getCreatorDemand(offset = 0): Promise<CreatorDemand> {
  const response = await fetch(`/api/admin/creator-waitlist?offset=${offset}`, {cache:"no-store"});
  if (!response.ok) throw new Error("Couldn’t load the creator waitlist.");
  return response.json();
}
