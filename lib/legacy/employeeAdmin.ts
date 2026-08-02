import { legacyFetch } from "./http.ts";
import type { LegacyResult } from "./envelope";

export interface HrEmployee {
  hrId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  biometricId: string;
  phone: string;
  hasCoworkAccount: boolean;
}

export interface HrEmployeeList {
  employees: HrEmployee[];
  departments: string[];
  total: number;
  withAccount: number;
}

export interface ProvisionResult {
  employeeId: string;
  tempPassword: string;
  role: string;
}

/** HR employees from MongoDB, tagged with whether they already have a CoWork account. */
export async function listHrEmployees(input: {
  token: string;
  search?: string;
  department?: string;
}): Promise<LegacyResult<HrEmployeeList>> {
  const query: Record<string, string> = {};
  if (input.search) query.search = input.search;
  if (input.department && input.department !== "all") query.department = input.department;
  return legacyFetch({
    path: "/cowork/admin/hr-employees",
    token: input.token,
    query,
  });
}

/** Create a CoWork account for an HR employee. */
export async function provisionCoworkAccount(input: {
  token: string;
  name: string;
  email: string;
  phone?: string;
  department: string;
  role?: "employee" | "tl";
  biometricId?: string;
}): Promise<LegacyResult<ProvisionResult>> {
  return legacyFetch({
    path: "/cowork/employee/create",
    method: "POST",
    token: input.token,
    body: {
      name: input.name,
      email: input.email,
      mobile: input.phone ?? "",
      city: "",
      department: input.department,
      role: input.role ?? "employee",
      employeeId: input.biometricId || undefined,
    },
  });
}
