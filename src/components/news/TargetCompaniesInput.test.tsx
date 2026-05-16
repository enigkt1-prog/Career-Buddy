/**
 * RTL tests for TargetCompaniesInput (F3 — watch-list editor).
 *
 * Coverage:
 *  - input + Add button render; empty-list hint
 *  - existing companies render as removable chips
 *  - submitting a name calls addTargetCompany + fires telemetry + clears
 *  - removing a chip calls removeTargetCompany
 *  - a failed add surfaces an error message
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

const useTargetCompaniesMock = vi.fn();
const addTargetCompanyMock = vi.fn();
const removeTargetCompanyMock = vi.fn();
vi.mock("@/lib/company-news", () => ({
  useTargetCompanies: () => useTargetCompaniesMock(),
  addTargetCompany: (name: string) => addTargetCompanyMock(name),
  removeTargetCompany: (name: string) => removeTargetCompanyMock(name),
  TARGET_COMPANIES_QUERY_KEY: ["target-companies"],
}));

const trackMock = vi.fn();
vi.mock("@/lib/telemetry", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

import { TargetCompaniesInput } from "./TargetCompaniesInput";

function renderInput() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TargetCompaniesInput />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useTargetCompaniesMock.mockReturnValue({ data: [], isLoading: false });
  addTargetCompanyMock.mockResolvedValue(undefined);
  removeTargetCompanyMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TargetCompaniesInput — render", () => {
  test("renders the input and Add button", () => {
    renderInput();
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
  });

  test("shows the empty-list hint when no companies", () => {
    renderInput();
    expect(screen.getByText(/No companies yet/i)).toBeInTheDocument();
  });

  test("renders existing companies as chips", () => {
    useTargetCompaniesMock.mockReturnValue({
      data: ["Stripe", "Notion"],
      isLoading: false,
    });
    renderInput();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
    expect(screen.getByText("Notion")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Stripe" }),
    ).toBeInTheDocument();
  });
});

describe("TargetCompaniesInput — actions", () => {
  test("submitting a company adds it + fires telemetry + clears input", async () => {
    const user = userEvent.setup();
    renderInput();
    const input = screen.getByLabelText("Company name") as HTMLInputElement;
    await user.type(input, "Figma");
    await user.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => {
      expect(addTargetCompanyMock).toHaveBeenCalledWith("Figma");
    });
    expect(trackMock).toHaveBeenCalledWith("target_company_added", {
      company: "Figma",
    });
    await waitFor(() => expect(input.value).toBe(""));
  });

  test("removing a chip calls removeTargetCompany", async () => {
    const user = userEvent.setup();
    useTargetCompaniesMock.mockReturnValue({
      data: ["Stripe"],
      isLoading: false,
    });
    renderInput();
    await user.click(screen.getByRole("button", { name: "Remove Stripe" }));
    await waitFor(() => {
      expect(removeTargetCompanyMock).toHaveBeenCalledWith("Stripe");
    });
  });

  test("a failed add surfaces an error message", async () => {
    const user = userEvent.setup();
    addTargetCompanyMock.mockRejectedValue(new Error("Sign in required."));
    renderInput();
    await user.type(screen.getByLabelText("Company name"), "Figma");
    await user.click(screen.getByRole("button", { name: /Add/i }));
    expect(await screen.findByText("Sign in required.")).toBeInTheDocument();
  });
});
