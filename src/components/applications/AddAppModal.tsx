import { useState } from "react";
import { Loader2 } from "lucide-react";

import { todayISO } from "@/lib/format";

/**
 * Add-application modal. Captures company / role / url / date (date is
 * UI-only at the moment — the monolith timestamps via todayISO when it
 * persists). Parent owns the actual write.
 */

export function AddAppModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (company: string, role: string, opts?: { url?: string; fit?: number }) => void;
}) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim() || !role.trim()) return;
    setLoading(true);
    setTimeout(() => {
      onAdd(company.trim(), role.trim(), { url: url.trim() || undefined });
      setLoading(false);
      onClose();
    }, 300);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Add Application</h3>
        <div className="space-y-3">
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Role" value={role} onChange={(e) => setRole(e.target.value)} />
          <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="URL (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">Cancel</button>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 text-sm text-white rounded-lg flex items-center gap-2"
            style={{ backgroundColor: "#1c2620" }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
