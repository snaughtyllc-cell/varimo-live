"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createInvite,
  deleteInvite,
  listAdminWorkspaces,
  listInvites,
  removeAdminUser,
  setAdminView,
  setWorkspaceExperience,
} from "@/lib/api";
import { useAuthMe } from "@/lib/useAuthMe";
import type { AdminWorkspace, Invite, InviteKind } from "@/lib/types";
import { ShieldCheck } from "lucide-react";
import { memberWeekCopy } from "@/lib/usage";

export default function AdminPage() {
  const router = useRouter();
  const { data: me, isLoading: meLoading, mutate } = useAuthMe();
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<InviteKind>("join");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  const isAdmin = Boolean(me?.is_admin);

  useEffect(() => {
    if (meLoading) return;
    if (!isAdmin) {
      router.replace("/");
    }
  }, [meLoading, isAdmin, router]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ws, inv] = await Promise.all([listAdminWorkspaces(), listInvites()]);
        if (!cancelled) {
          setWorkspaces(ws);
          setInvites(inv);
        }
      } catch (err) {
        if (!cancelled) {
          setFormError(err instanceof Error ? err.message : "Failed to load admin data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function handleOpen(workspaceId: string) {
    setOpeningId(workspaceId);
    try {
      await setAdminView(workspaceId);
      await mutate();
      router.push("/");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to open workspace");
      setOpeningId(null);
    }
  }

  async function handleExperience(workspaceId: string, experience: "solo" | "agency") {
    setFormError(null);
    try {
      await setWorkspaceExperience(workspaceId, experience);
      setWorkspaces((prev) =>
        prev.map((ws) => (ws.id === workspaceId ? { ...ws, experience } : ws)),
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update experience");
    }
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await createInvite(email.trim(), kind);
      setInvites((prev) => [created, ...prev]);
      setEmail("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveUser(email: string) {
    if (removingEmail) return;
    const ok = window.confirm(
      `Remove ${email}? They will not be able to sign in until you invite them again.`,
    );
    if (!ok) return;
    setRemovingEmail(email);
    setFormError(null);
    try {
      await removeAdminUser(email);
      const ws = await listAdminWorkspaces();
      setWorkspaces(ws);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingEmail(null);
    }
  }

  async function handleDeleteInvite(id: string) {
    try {
      await deleteInvite(id);
      setInvites((prev) => prev.filter((inv) => inv.id !== id));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to delete invite");
    }
  }

  if (meLoading || !isAdmin) {
    return (
      <main className="admin-page">
        <div style={{ color: "var(--color-muted)", fontSize: 13 }}>
          {meLoading ? "Loading…" : "Admin only"}
        </div>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <div className="workspace-heading">
        <span className="workspace-heading__icon"><ShieldCheck size={19} /></span>
        <div>
          <p className="workspace-heading__eyebrow">Site administration</p>
          <h1>Admin</h1>
          <p className="workspace-heading__copy">
          Open another studio with the same UI. Members are listed on each
          workspace — Remove drops their login until you invite them again.
          Outside operators add their own VAs on <strong>Team</strong>; this
          page is the only place that can mint a new empty studio.
          </p>
        </div>
      </div>

      <div>
        {formError && (
          <div className="vf-alert" role="alert">
            {formError}
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 10 }}>
          Workspaces
        </div>
        <div
          style={{
            overflowX: "auto",
            background: "var(--color-panel)",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
            marginBottom: 28,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: "var(--color-muted)", textAlign: "left" }}>
                {["Name", "Owner", "Members", "Experience", "Running", "Fast", "HQ", "Week Fast", "Week HQ", "Last job", "Last error", ""].map((h) => (
                  <th key={h || "open"} style={{ padding: "10px 12px", fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && workspaces.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: "14px 12px", color: "var(--color-muted)" }}>
                    Loading…
                  </td>
                </tr>
              ) : (
                workspaces.map((ws) => (
                  <tr key={ws.id} style={{ borderTop: "1px solid var(--color-line)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700 }}>{ws.name}</td>
                    <td style={{ padding: "10px 12px", color: "var(--color-muted)" }}>{ws.owner_email ?? "—"}</td>
                    <td style={{ padding: "10px 12px", verticalAlign: "top", minWidth: 220 }}>
                      {(ws.members ?? []).length === 0 ? (
                        <span style={{ color: "var(--color-muted)" }}>—</span>
                      ) : (
                        (ws.members ?? []).map((m) => {
                          const isYou = m.email === me?.email;
                          return (
                            <div
                              key={m.email}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 600 }}>{m.email}</div>
                                <div style={{ color: "var(--color-muted)", fontSize: 11 }}>
                                  {m.role}
                                  {isYou ? " · you" : ""}
                                </div>
                                <div style={{ color: "var(--color-muted2)", fontSize: 11 }}>
                                  {memberWeekCopy(m)}
                                </div>
                              </div>
                              {!isYou && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveUser(m.email)}
                                  disabled={removingEmail === m.email}
                                  aria-label={`Remove ${m.email}`}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: "var(--color-red)",
                                    background: "var(--color-panel2)",
                                    border: "1px solid var(--color-line)",
                                    padding: "4px 8px",
                                    borderRadius: 8,
                                    cursor: removingEmail === m.email ? "wait" : "pointer",
                                  }}
                                >
                                  {removingEmail === m.email ? "Removing…" : "Remove"}
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <select
                        aria-label={`Experience for ${ws.name}`}
                        value={ws.experience ?? "agency"}
                        onChange={(e) =>
                          handleExperience(ws.id, e.target.value as "solo" | "agency")
                        }
                        style={{
                          background: "var(--color-panel2)",
                          border: "1px solid var(--color-line)",
                          borderRadius: 8,
                          padding: "6px 8px",
                          fontSize: 12,
                          color: "var(--color-text)",
                        }}
                      >
                        <option value="solo">Solo</option>
                        <option value="agency">Agency</option>
                      </select>
                    </td>
                    <td style={{ padding: "10px 12px" }}>{ws.running}</td>
                    <td style={{ padding: "10px 12px" }}>{ws.fast}</td>
                    <td style={{ padding: "10px 12px" }}>{ws.hq}</td>
                    <td style={{ padding: "10px 12px" }}>{ws.week_fast ?? 0}</td>
                    <td style={{ padding: "10px 12px" }}>{ws.week_hq ?? 0}</td>
                    <td style={{ padding: "10px 12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                      {ws.last_job_utc ? ws.last_job_utc.replace("T", " ").replace("Z", "") : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: ws.last_error ? "var(--color-red)" : "var(--color-muted)" }}>
                      {ws.last_error ?? "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        type="button"
                        onClick={() => handleOpen(ws.id)}
                        disabled={openingId === ws.id}
                        className="vf-primary-button"
                        style={{ cursor: openingId === ws.id ? "wait" : "pointer" }}
                      >
                        {openingId === ws.id ? "Opening…" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", marginBottom: 10 }}>
          Invites
        </div>
        <form
          onSubmit={handleInvite}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="operator@example.com"
            aria-label="Invite email"
            style={{
              background: "var(--color-panel2)",
              border: "1px solid var(--color-line)",
              borderRadius: 9,
              padding: "8px 12px",
              fontSize: 13,
              color: "var(--color-text)",
              minWidth: 220,
              flex: 1,
            }}
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as InviteKind)}
            aria-label="Invite kind"
            style={{
              background: "var(--color-panel2)",
              border: "1px solid var(--color-line)",
              borderRadius: 9,
              padding: "8px 12px",
              fontSize: 13,
              color: "var(--color-text)",
            }}
          >
            <option value="join">Join my workspace</option>
            <option value="new_workspace">New workspace</option>
          </select>
          <button
            type="submit"
            disabled={submitting}
            className="vf-primary-button"
            style={{ cursor: submitting ? "wait" : "pointer" }}
          >
            {submitting ? "Sending…" : "Invite"}
          </button>
        </form>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12, lineHeight: 1.45 }}>
          Join adds them to your home workspace. New workspace gives them an empty studio of their own.
          They sign in with that email plus a password they choose, or with Google.
        </div>

        <div
          style={{
            background: "var(--color-panel)",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {invites.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12.5, color: "var(--color-muted)" }}>No pending invites.</div>
          ) : (
            invites.map((inv) => (
              <div
                key={inv.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--color-line)",
                  fontSize: 12.5,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{inv.email}</div>
                  <div style={{ color: "var(--color-muted)", marginTop: 2 }}>
                    {inv.kind === "join" ? "Join my workspace" : "New workspace"}
                    {inv.created_utc ? ` · ${inv.created_utc.replace("T", " ").replace("Z", "")}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteInvite(inv.id)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--color-red)",
                    background: "var(--color-panel2)",
                    border: "1px solid var(--color-line)",
                    padding: "7px 12px",
                    borderRadius: 9,
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
