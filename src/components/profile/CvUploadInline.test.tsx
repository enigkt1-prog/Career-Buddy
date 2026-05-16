/**
 * RTL tests for CvUploadInline (UI session owns the component, this
 * session writes the tests per CLAUDE_COORDINATION.md round-7).
 *
 * Round-10 update: component now persists via the round-8
 * `setProfileFromAnalysis` helper from `@/lib/profile-store` rather
 * than the direct `mergeAnalysisIntoState` + `saveCareerBuddyState`
 * pair. Tests mock the profile-store surface so we assert the new
 * call shape AND the `onAnalysed` callback prop.
 *
 * Mocks:
 *  - `@/lib/cv-parser`.extractCvText             — fake PDF/DOCX→string
 *  - `@/integrations/supabase/client`.supabase   — `.functions.invoke`
 *  - `@/lib/profile-store`.setProfileFromAnalysis — assert dual-write wiring
 *
 * Paths covered:
 *  - happy-path file → extract → analyse → persist → onAnalysed → done
 *  - paste-then-analyse via "Analyse pasted text" button
 *  - short-text error from extractCvText (<50 chars)
 *  - supabase.functions.invoke returns error → user-visible error
 *  - payload missing analysis → error message
 *  - extractCvText throws → user sees error
 *  - Analyse-pasted-text button disabled when textarea empty
 *  - setProfileFromAnalysis rejects → user sees error, onAnalysed NOT fired
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExtract = vi.fn();
vi.mock("@/lib/cv-parser", () => ({
  extractCvText: (file: File) => mockExtract(file),
}));

const mockInvoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (fn: string, opts: unknown) => mockInvoke(fn, opts),
    },
  },
}));

const mockSetProfileFromAnalysis = vi.fn();
vi.mock("@/lib/profile-store", () => ({
  setProfileFromAnalysis: (analysis: unknown, filename: string) =>
    mockSetProfileFromAnalysis(analysis, filename),
  loadSelectedTracks: () => [],
}));

// Import AFTER mocks so the module picks up the stubs.
import { CvUploadInline } from "./CvUploadInline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const longCv = "a".repeat(200);

function makeFile(name = "cv.pdf", body = longCv): File {
  return new File([body], name, { type: "application/pdf" });
}

beforeEach(() => {
  mockExtract.mockReset();
  mockInvoke.mockReset();
  mockSetProfileFromAnalysis.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CvUploadInline — happy path", () => {
  test("file upload → extract → analyse → persist → done summary", async () => {
    mockExtract.mockResolvedValue(longCv);
    mockInvoke.mockResolvedValue({
      data: {
        analysis: {
          summary: "Strong B2B sales background.",
          name: "Alex Candidate",
          strengths: ["B2B sales"],
          skills: [{ name: "Python", level: "advanced" }],
        },
      },
      error: null,
    });

    const user = userEvent.setup();
    render(<CvUploadInline />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, makeFile());

    await waitFor(() => {
      expect(screen.getByText(/Strong B2B sales background\./)).toBeInTheDocument();
    });

    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      "analyze-cv",
      expect.objectContaining({ body: expect.objectContaining({ cvText: longCv }) }),
    );
    expect(mockSetProfileFromAnalysis).toHaveBeenCalledTimes(1);
    // The file name is passed explicitly through `analyse(content,
    // file.name)`, so persistence sees the real name — not the
    // "cv.txt" fallback — despite `setFilename` not having committed.
    const [analysisArg, filenameArg] = mockSetProfileFromAnalysis.mock.calls[0];
    expect(analysisArg).toEqual(
      expect.objectContaining({
        summary: "Strong B2B sales background.",
        skills: [{ name: "Python", level: "advanced" }],
      }),
    );
    expect(filenameArg).toBe("cv.pdf");
    expect(screen.getByText(/Open Overview to review/)).toBeInTheDocument();
    expect(screen.getByText("cv.pdf")).toBeInTheDocument();
  });

  test("onAnalysed callback fires after successful analysis", async () => {
    mockExtract.mockResolvedValue(longCv);
    mockInvoke.mockResolvedValue({
      data: { analysis: { summary: "ok" } },
      error: null,
    });

    const onAnalysed = vi.fn();
    const user = userEvent.setup();
    render(<CvUploadInline onAnalysed={onAnalysed} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile());

    await waitFor(() => {
      expect(onAnalysed).toHaveBeenCalledTimes(1);
    });
    expect(mockSetProfileFromAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe("CvUploadInline — paste path", () => {
  test("paste text + click Analyse → analyse + persist + onAnalysed", async () => {
    mockInvoke.mockResolvedValue({
      data: { analysis: { summary: "Pasted-CV insight." } },
      error: null,
    });

    const onAnalysed = vi.fn();
    const user = userEvent.setup();
    render(<CvUploadInline onAnalysed={onAnalysed} />);

    const textarea = screen.getByPlaceholderText(/paste CV text here/i);
    await user.type(textarea, "I am a 5-year operator with B2B sales chops.");

    const analyseBtn = screen.getByRole("button", { name: /Analyse pasted text/i });
    await user.click(analyseBtn);

    await waitFor(() => {
      expect(screen.getByText(/Pasted-CV insight/)).toBeInTheDocument();
    });

    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockSetProfileFromAnalysis).toHaveBeenCalledTimes(1);
    expect(onAnalysed).toHaveBeenCalledTimes(1);
    // No file picker used → filename falls back to the "cv.txt" default.
    expect(mockSetProfileFromAnalysis.mock.calls[0][1]).toBe("cv.txt");
  });
});

describe("CvUploadInline — error paths", () => {
  test("extractCvText returns short text → error message, no Supabase call", async () => {
    mockExtract.mockResolvedValue("too short");

    const user = userEvent.setup();
    render(<CvUploadInline />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("tiny.pdf", "x"));

    await waitFor(() => {
      expect(screen.getByText(/Could not extract enough text/i)).toBeInTheDocument();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockSetProfileFromAnalysis).not.toHaveBeenCalled();
  });

  test("supabase.functions.invoke returns error → user sees error, no persist", async () => {
    mockExtract.mockResolvedValue(longCv);
    mockInvoke.mockResolvedValue({
      data: null,
      error: new Error("rate-limited"),
    });

    const user = userEvent.setup();
    render(<CvUploadInline />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile());

    await waitFor(() => {
      expect(screen.getByText(/rate-limited/i)).toBeInTheDocument();
    });

    expect(mockSetProfileFromAnalysis).not.toHaveBeenCalled();
  });

  test("payload missing analysis → error fallback", async () => {
    mockExtract.mockResolvedValue(longCv);
    mockInvoke.mockResolvedValue({
      data: { error: "Gemini quota exhausted" },
      error: null,
    });

    const user = userEvent.setup();
    render(<CvUploadInline />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile());

    await waitFor(() => {
      expect(screen.getByText(/Gemini quota exhausted/i)).toBeInTheDocument();
    });

    expect(mockSetProfileFromAnalysis).not.toHaveBeenCalled();
  });

  test("extractCvText throws → user sees error message", async () => {
    mockExtract.mockRejectedValue(new Error("Unsupported file"));

    const user = userEvent.setup();
    render(<CvUploadInline />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("weird.bin"));

    await waitFor(() => {
      expect(screen.getByText(/Unsupported file/i)).toBeInTheDocument();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("Analyse-pasted-text button disabled when textarea empty", () => {
    render(<CvUploadInline />);
    const btn = screen.getByRole("button", { name: /Analyse pasted text/i });
    expect(btn).toBeDisabled();
  });

  test("setProfileFromAnalysis rejects → user sees error, onAnalysed NOT fired", async () => {
    mockExtract.mockResolvedValue(longCv);
    mockInvoke.mockResolvedValue({
      data: { analysis: { summary: "ok" } },
      error: null,
    });
    mockSetProfileFromAnalysis.mockRejectedValueOnce(new Error("dual-write blew up"));

    const onAnalysed = vi.fn();
    const user = userEvent.setup();
    render(<CvUploadInline onAnalysed={onAnalysed} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile());

    await waitFor(() => {
      expect(screen.getByText(/dual-write blew up/i)).toBeInTheDocument();
    });

    expect(onAnalysed).not.toHaveBeenCalled();
  });
});
