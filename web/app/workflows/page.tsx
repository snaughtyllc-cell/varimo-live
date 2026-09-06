import { WorkflowsPanel } from "@/components/workflows/WorkflowsPanel";
import { RequireAgency } from "@/components/nav/RequireAgency";

export default function WorkflowsPage() {
  return (
    <RequireAgency>
      <main className="workflow-page">
        <WorkflowsPanel />
      </main>
    </RequireAgency>
  );
}
