import { ApplicationRow } from "./ApplicationRow";
import type { Application } from "@/lib/types";

/**
 * Applications tracker — table of every role the user has applied to
 * with inline status / next-action / notes editing. Pure
 * presentational: state lives in the monolith.
 */

export function ApplicationsTracker({
  applications,
  onAdd,
  onUpdate,
  onDelete,
}: {
  applications: Application[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Application>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Applications</h2>
        <div className="flex gap-2">
          <button
            onClick={onAdd}
            className="px-4 py-2 text-sm rounded-lg text-white font-medium hover:shadow-md"
            style={{ backgroundColor: "#1c2620" }}
          >
            + Add Application
          </button>
        </div>
      </div>

      {applications.length === 0 && (
        <div className="text-sm text-gray-500 italic py-6 text-center border border-dashed rounded-lg">
          No applications yet. Click <span className="font-medium text-gray-700">"Add to tracker"</span> on a role card below, or{" "}
          <button onClick={onAdd} className="text-cinema-pine underline">add one manually</button>.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 border-b">
            <tr>
              <th className="text-left py-2 px-2">Company</th>
              <th className="text-left py-2 px-2">Role</th>
              <th className="text-left py-2 px-2">Status</th>
              <th className="text-left py-2 px-2">Last Event</th>
              <th className="text-left py-2 px-2">Next Action</th>
              <th className="text-left py-2 px-2">Fit</th>
              <th className="text-left py-2 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <ApplicationRow key={a.id} app={a} onUpdate={onUpdate} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
