import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

import { ROLE_CATEGORY_OPTIONS } from "@/lib/types";
import type { Education, Position, Profile } from "@/lib/types";

/**
 * Full-screen profile editor. Captures every field the fit-score
 * pipeline reads (name / headline / target / strengths / gaps /
 * categories / location-prefs / work history / education). Parent
 * persists via onSave.
 *
 * Field, BulletEditor, PositionEditor are local helpers — they only
 * make sense within the edit modal so they live in this file.
 */

export function EditProfileModal({
  profile,
  onClose,
  onSave,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (next: Partial<Profile>) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [headline, setHeadline] = useState(profile.headline);
  const [targetRole, setTargetRole] = useState(profile.target_role);
  const [targetGeo, setTargetGeo] = useState(profile.target_geo);
  const [background, setBackground] = useState(profile.background);
  const [strengths, setStrengths] = useState<string[]>(profile.strengths);
  const [gaps, setGaps] = useState<string[]>(profile.gaps);
  const [recommendations, setRecommendations] = useState<string[]>(profile.recommendations);
  const [categories, setCategories] = useState<string[]>(profile.target_role_categories);
  const [locationPrefs, setLocationPrefs] = useState<string[]>(profile.location_preferences);
  const [work, setWork] = useState<Position[]>(profile.work_history);
  const [education, setEducation] = useState<Education[]>(profile.education);

  function save() {
    onSave({
      name: name.trim(),
      headline: headline.trim(),
      target_role: targetRole.trim(),
      target_geo: targetGeo.trim(),
      background: background.trim(),
      strengths: strengths.map((s) => s.trim()).filter(Boolean),
      gaps: gaps.map((g) => g.trim()).filter(Boolean),
      recommendations: recommendations.map((r) => r.trim()).filter(Boolean),
      target_role_categories: categories,
      location_preferences: locationPrefs.map((l) => l.trim()).filter(Boolean),
      work_history: work
        .map((p) => ({
          ...p,
          company: p.company.trim(),
          role: p.role.trim(),
          start_date: p.start_date.trim(),
          end_date: p.end_date.trim(),
          bullets: p.bullets.map((b) => b.trim()).filter(Boolean),
        }))
        .filter((p) => p.company || p.role),
      education: education
        .map((e) => ({
          ...e,
          institution: e.institution.trim(),
          degree: e.degree.trim(),
        }))
        .filter((e) => e.institution || e.degree),
    });
  }

  function addPosition() {
    setWork((w) => [
      ...w,
      { id: `w${Date.now()}`, company: "", role: "", start_date: "", end_date: "Present", bullets: [""] },
    ]);
  }

  function addEducation() {
    setEducation((e) => [...e, { id: `e${Date.now()}`, institution: "", degree: "" }]);
  }

  function toggleCategory(cat: string) {
    setCategories((c) => (c.includes(cat) ? c.filter((x) => x !== cat) : [...c, cat]));
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start md:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b px-6 py-4 sticky top-0 bg-white rounded-t-xl">
          <h3 className="text-lg font-semibold">Edit profile</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </Field>
            <Field label="Headline (one-line pitch)">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Strategy graduate · B2B-sales · operator-in-training" />
            </Field>
            <Field label="Target role">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={targetRole} onChange={(e) => setTargetRole(e.target.value)} />
            </Field>
            <Field label="Target geography">
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={targetGeo} onChange={(e) => setTargetGeo(e.target.value)} />
            </Field>
            <Field label="Background" full>
              <textarea rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" value={background} onChange={(e) => setBackground(e.target.value)} />
            </Field>
          </div>

          <Field label="Target role categories (used for fit-score)">
            <div className="flex flex-wrap gap-2">
              {ROLE_CATEGORY_OPTIONS.map((cat) => {
                const on = categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${on ? "bg-cinema-moss border-cinema-moss text-white" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </Field>

          <BulletEditor label="Location preferences" items={locationPrefs} onChange={setLocationPrefs} placeholder="e.g. Berlin, Remote-DACH" />
          <BulletEditor label="Strengths" items={strengths} onChange={setStrengths} placeholder="One strength per line" />
          <BulletEditor label="Gaps" items={gaps} onChange={setGaps} placeholder="One gap per line" />
          <BulletEditor label="Recommendations" items={recommendations} onChange={setRecommendations} placeholder="One recommendation per line" />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Work history</label>
              <button type="button" onClick={addPosition} className="text-xs text-cinema-pine flex items-center gap-1 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add position
              </button>
            </div>
            <div className="space-y-3">
              {work.length === 0 && (
                <div className="text-xs text-gray-400 italic">No positions yet. Upload a CV or add one manually.</div>
              )}
              {work.map((p, idx) => (
                <PositionEditor
                  key={p.id}
                  position={p}
                  onChange={(np) =>
                    setWork((w) => w.map((x, i) => (i === idx ? np : x)))
                  }
                  onRemove={() => setWork((w) => w.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Education</label>
              <button type="button" onClick={addEducation} className="text-xs text-cinema-pine flex items-center gap-1 hover:underline">
                <Plus className="w-3.5 h-3.5" /> Add education
              </button>
            </div>
            <div className="space-y-3">
              {education.length === 0 && (
                <div className="text-xs text-gray-400 italic">No education yet.</div>
              )}
              {education.map((e, idx) => (
                <div key={e.id} className="border rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="Institution"
                      value={e.institution}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, institution: ev.target.value } : x)))}
                    />
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="Degree"
                      value={e.degree}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, degree: ev.target.value } : x)))}
                    />
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="Start (YYYY-MM)"
                      value={e.start_date ?? ""}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, start_date: ev.target.value } : x)))}
                    />
                    <input
                      className="border rounded-lg px-3 py-2 text-sm"
                      placeholder="End (YYYY-MM or Present)"
                      value={e.end_date ?? ""}
                      onChange={(ev) => setEducation((edu) => edu.map((x, i) => (i === idx ? { ...x, end_date: ev.target.value } : x)))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setEducation((edu) => edu.filter((_, i) => i !== idx))}
                    className="text-xs text-red-600 flex items-center gap-1 hover:underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-end gap-2 bg-white rounded-b-xl sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
          <button onClick={save} className="px-4 py-2 text-sm text-white rounded-lg" style={{ backgroundColor: "#1c2620" }}>
            Save profile
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="text-xs font-medium text-gray-600 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function BulletEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="text-xs text-cinema-pine flex items-center gap-1 hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <div className="text-xs text-gray-400 italic">No items.</div>}
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
              placeholder={placeholder}
              value={it}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="px-2 text-gray-400 hover:text-red-600"
              aria-label="Remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionEditor({
  position,
  onChange,
  onRemove,
}: {
  position: Position;
  onChange: (p: Position) => void;
  onRemove: () => void;
}) {
  function setField<K extends keyof Position>(k: K, v: Position[K]) {
    onChange({ ...position, [k]: v });
  }
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Company" value={position.company} onChange={(e) => setField("company", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Role" value={position.role} onChange={(e) => setField("role", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Start (YYYY-MM)" value={position.start_date} onChange={(e) => setField("start_date", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="End (YYYY-MM or Present)" value={position.end_date} onChange={(e) => setField("end_date", e.target.value)} />
        <input className="border rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="Location (optional)" value={position.location ?? ""} onChange={(e) => setField("location", e.target.value)} />
      </div>
      <div>
        <div className="text-xs text-gray-500 mb-1">Bullets</div>
        <div className="space-y-2">
          {position.bullets.map((b, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                rows={2}
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                placeholder="Achievement, e.g. 'Closed 14 B2B deals worth €450k ARR'"
                value={b}
                onChange={(e) =>
                  onChange({
                    ...position,
                    bullets: position.bullets.map((x, j) => (j === i ? e.target.value : x)),
                  })
                }
              />
              <button
                type="button"
                onClick={() => onChange({ ...position, bullets: position.bullets.filter((_, j) => j !== i) })}
                className="px-2 text-gray-400 hover:text-red-600 self-start mt-1"
                aria-label="Remove bullet"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...position, bullets: [...position.bullets, ""] })}
            className="text-xs text-cinema-pine flex items-center gap-1 hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add bullet
          </button>
        </div>
      </div>
      <button type="button" onClick={onRemove} className="text-xs text-red-600 flex items-center gap-1 hover:underline">
        <Trash2 className="w-3.5 h-3.5" /> Remove position
      </button>
    </div>
  );
}
