"use client";
import { useEffect, useState } from "react";
import { CREATOR_BUDGETS, CREATOR_VOLUMES, getCreatorDemand, type CreatorDemand } from "@/lib/creatorWaitlist";

export function CreatorWaitlistAdmin() {
  const [data, setData] = useState<CreatorDemand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      try { const result = await getCreatorDemand(offset); if (active) { setData(result); setError(null); } }
      catch (err) { if (active) setError(err instanceof Error ? err.message : "Failed to load waitlist"); }
    })();
    return () => { active = false; };
  }, [offset, revision]);
  const label = (options: Record<string,string>, value:string) => options[value] ?? (value === "under_25" ? "Under $25 / month (earlier response)" : value);
  return <section className="creator-admin" aria-labelledby="creator-admin-heading">
    <header><div><h2 id="creator-admin-heading">Creator waitlist</h2><p>{data ? `${data.total} unique signups` : "Loading creator demand…"}</p></div><div><button onClick={() => setRevision(v=>v+1)}>Refresh</button> <a href="/api/admin/creator-waitlist/export" download>Export CSV</a></div></header>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <div className="creator-admin-summaries">
        <div><h3>Comfortable monthly budget</h3>{Object.entries({under_25: "Under $25 / month (earlier responses)", ...CREATOR_BUDGETS}).map(([key,text])=><p key={key}><span>{text}</span><strong>{data.budgets[key] ?? 0}</strong></p>)}</div>
        <div><h3>Expected variants per month</h3>{Object.entries(CREATOR_VOLUMES).map(([key,text])=><p key={key}><span>{text}</span><strong>{data.usage[key] ?? 0}</strong></p>)}</div>
      </div>
      {data.total === 0 ? <p>No signups yet. The public waitlist is ready to collect interest.</p> : <><div className="creator-admin-table"><table><thead><tr>{["Joined","Email","Instagram","Monthly variants","Monthly budget","Use case"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.items.map(row=><tr key={row.email}><td>{row.created_at.slice(0,10)}</td><td>{row.email}</td><td>{row.instagram ? `@${row.instagram}` : "—"}</td><td>{label(CREATOR_VOLUMES,row.monthly_variants)}</td><td>{label(CREATOR_BUDGETS,row.monthly_budget)}</td><td>{row.use_case || "—"}</td></tr>)}</tbody></table></div>
      <footer><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button><span>{offset+1}–{Math.min(offset+50,data.total)} of {data.total}</span><button disabled={offset+50>=data.total} onClick={()=>setOffset(offset+50)}>Next</button></footer></>}
    </>}
  </section>;
}
