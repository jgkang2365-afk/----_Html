export type ReportExplorerPeriod = "상반기" | "하반기";

export type ReportExplorerMatch = {
  resultId: string;
  folderName: string;
  path: string;
};

export type ReportExplorerQueryStatus = "FOUND" | "MULTIPLE" | "NOT_FOUND";

export type ReportExplorerQueryResult = {
  query: string;
  status: ReportExplorerQueryStatus;
  matches: ReportExplorerMatch[];
};

export type ReportExplorerSearchRequest = {
  year: number;
  period: ReportExplorerPeriod;
  businessNames: string[];
};

export type ReportExplorerBusinessRecord = {
  code: string;
  year: number;
  period: string;
  business_name: string | null | undefined;
};

export type ReportExplorerIssueKind = "disconnected" | "permission" | "root";

export type ReportExplorerConnectionStatus =
  | "unchecked"
  | "connected"
  | "disconnected"
  | "storage-error";

export type ReportExplorerIssue = {
  kind: ReportExplorerIssueKind;
  message: string;
};

export type ReportExplorerHealth = {
  status: string | null;
  version: string | null;
  storage: Record<string, unknown> | null;
  issues: ReportExplorerIssue[];
  message: string | null;
};
