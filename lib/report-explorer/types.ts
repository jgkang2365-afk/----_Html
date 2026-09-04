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

export type ReportExplorerIssueKind = "disconnected" | "permission" | "root";

export type ReportExplorerIssue = {
  kind: ReportExplorerIssueKind;
  message: string;
};

export type ReportExplorerHealth = {
  issues: ReportExplorerIssue[];
  message: string | null;
};
