import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { HqTargetReview } from "@/components/studio/HqTargetReview";
const start = vi.hoisted(() => vi.fn());
vi.mock("@/lib/runStore", () => ({ useRun: () => ({ start, complete: false, jobId: null }) }));
const id = "a".repeat(64);
const preview = { target: {model:"GG",page:"p",winner:"trial",source_file_id:"source"},source_name:"source.mp4",folder_id:"folder" };
beforeEach(() => { vi.restoreAllMocks(); start.mockClear(); window.history.replaceState(null,"",`/studio?handoff=${id}`); });
it("previews without starting work and generates only on an explicit click", async () => {
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>preview});
  vi.stubGlobal("fetch",fetcher);
  render(<HqTargetReview />);
  const button=await screen.findByRole("button",{name:"Generate and send to Postdesk"});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(start).not.toHaveBeenCalled();
  fetcher.mockResolvedValueOnce({ok:true,json:async()=>({job_id:"job",sources:[]})});
  fireEvent.click(button);
  await waitFor(()=>expect(start).toHaveBeenCalledWith({job_id:"job",sources:[]},"fast"));
  expect(fetcher).toHaveBeenCalledWith(`/api/hq/targets/${id}/generate?count=20`,{method:"POST"});
});
it("does not send another render when a handoff already has a job", async () => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({...preview,job_id:"job",state:"done",exported:20})}));
  render(<HqTargetReview />);
  await screen.findByText(/20 files delivered/);
  expect(screen.queryByRole("button",{name:"Generate and send to Postdesk"})).toBeNull();
});
