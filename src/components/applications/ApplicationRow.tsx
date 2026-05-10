import { useState } from "react";
import { Trash2 } from "lucide-react";

import { fitColor, statusBadge, todayISO } from "@/lib/format";
import type { Application, Status } from "@/lib/types";

const STATUS_OPTIONS: Status[] = [
  "applied",
  "interview-1",
  "interview-2",
  "follow-up-needed",
  "offer",
  "rejected",
  "confirmation",
];

/**
 * One row in the applications table. Self-contained inline editors
 * for next_action + notes; status flips on select change.
 */

export function ApplicationRow({
  app,
  onUpdate,
  onDelete,
}: {
  app: Application;
  onUpdate: (id: string, patch: Partial<Application>) => void;
  onDelete: (id: string) => void;
}) {
  const [editingNext, setEditingNext] = useState(false);
  const [draftNext, setDraftNext] = useState(app.next_action);
  const [notesOpen, setNotesOpen] = useState(false);
  const [draftNotes, setDraftNotes] = useState(app.notes ?? "");

  function saveNext() {
    setEditingNext(false);
    if (draftNext.trim() !== app.next_action) {
      onUpdate(app.id, { next_action: draftNext.trim() });
    }
  }

  function saveNotes() {
    if (draftNotes.trim() !== (app.notes ?? "").trim()) {
      onUpdate(app.id, { notes: draftNotes.trim() || undefined });
    }
    setNotesOpen(false);
  }

  return (
    <>
      <tr
        className={`border-b transition-colors ease-out group ${app.flash ? "bg-cinema-mint/60" : ""}`}
        style={{ transitionDuration: "400ms" }}
      >
        <td className="py-2 px-2 font-medium">
          {app.url ? (
            <a href={app.url} target="_blank" rel="noopener noreferrer" className="hover:underline decoration-cinema-sage">
              {app.company}
            </a>
          ) : (
            app.company
          )}
        </td>
        <td className="py-2 px-2">{app.role}</td>
        <td className="py-2 px-2">
          <select
            value={app.status}
            onChange={(e) => onUpdate(app.id, { status: e.target.value as Status, last_event: todayISO() })}
            className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:ring-1 focus:ring-cinema-sage outline-none ${statusBadge(app.status)}`}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </td>
        <td className="py-2 px-2 text-gray-600">{app.last_event}</td>
        <td className="py-2 px-2 max-w-xs">
          {editingNext ? (
            <input
              autoFocus
              value={draftNext}
              onChange={(e) => setDraftNext(e.target.value)}
              onBlur={saveNext}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNext();
                if (e.key === "Escape") {
                  setDraftNext(app.next_action);
                  setEditingNext(false);
                }
              }}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          ) : (
            <button
              onClick={() => {
                setDraftNext(app.next_action);
                setEditingNext(true);
              }}
              className="text-left w-full hover:bg-gray-50 px-1 py-0.5 rounded"
              title="Click to edit"
            >
              {app.next_action}
            </button>
          )}
        </td>
        <td className={`py-2 px-2 font-semibold ${fitColor(app.fit)}`}>{app.fit.toFixed(1)}</td>
        <td className="py-2 px-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setDraftNotes(app.notes ?? "");
                setNotesOpen((o) => !o);
              }}
              className={`text-xs px-1.5 py-0.5 rounded ${app.notes ? "text-cinema-pine" : "text-gray-300 opacity-0 group-hover:opacity-100"} hover:bg-gray-100 transition`}
              title={app.notes ? "Edit notes" : "Add notes"}
            >
              {app.notes ? "📝" : "+"}
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Remove ${app.company} from tracker?`)) onDelete(app.id);
              }}
              className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition"
              aria-label="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {notesOpen && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="py-2 px-2">
            <textarea
              autoFocus
              rows={3}
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              onBlur={saveNotes}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraftNotes(app.notes ?? "");
                  setNotesOpen(false);
                }
              }}
              placeholder="Notes — e.g. 'Spoke with Anna on Thu, follow up Monday with B2B deal example.'"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
            />
            <div className="text-[10px] text-gray-400 mt-1">Click outside to save · Esc to cancel</div>
          </td>
        </tr>
      )}
    </>
  );
}
