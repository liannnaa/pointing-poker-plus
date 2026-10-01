/**
 * Jira user info returned by /rest/api/3/myself and /rest/api/3/user/search.
 * `emailAddress` is optional because GDPR-strict Jira sites omit it entirely —
 * `accountId` is the only field guaranteed to be present and stable.
 */
export type JiraUser = {
  accountId: string;
  emailAddress?: string;
  displayName: string;
  active: boolean;
  avatarUrls?: Record<string, string>;
};

/** Jira board (from agile API) */
export type JiraBoard = {
  id: number;
  name: string;
  type: string;
};

/** Jira sprint */
export type JiraSprint = {
  id: number;
  name: string;
  state: "active" | "future" | "closed";
  startDate?: string;
  endDate?: string;
};

/** Jira issue attachment metadata */
export type JiraAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  created?: string;
  author?: { displayName: string };
  content?: string;
  thumbnail?: string;
};

/** Jira issue fields subset relevant to estimation */
export type JiraIssueFields = {
  summary: string;
  description?: AdfNode | null;
  attachment?: JiraAttachment[];
  status: {
    name: string;
    statusCategory: { key: string };
  };
  issuetype: {
    name: string;
    iconUrl?: string;
  };
  priority?: {
    name: string;
    iconUrl?: string;
  };
  assignee?: JiraIssueAssignee | null;
  [key: string]: unknown; // story points live on dynamic custom field
};

/**
 * The assignee as Jira embeds it on an issue. `accountId` is optional because
 * Jira omits the whole object for unassigned issues and can return a partial
 * one for deleted accounts; `emailAddress` is absent on GDPR-strict sites.
 */
export type JiraIssueAssignee = {
  accountId?: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
};

/** Jira issue */
export type JiraIssue = {
  id: string;
  key: string;
  fields: JiraIssueFields;
};

/** Paginated response from Jira agile search */
export type JiraSearchResponse = {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
};

/** Paginated sprints response */
export type JiraSprintsResponse = {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraSprint[];
};

/** Paginated boards response */
export type JiraBoardsResponse = {
  maxResults: number;
  startAt: number;
  isLast: boolean;
  values: JiraBoard[];
};

/** ADF inline mark (bold, italic, link, code, etc.) */
export type AdfMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

/**
 * Atlassian Document Format node.
 * Full ADF spec is large; we only process what we render.
 */
export type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
};

/** A quick filter from Jira board configuration */
export type JiraQuickFilter = {
  id: number;
  name: string;
  query: string;
};

/** Jira board configuration (subset we use) */
export type JiraBoardConfig = {
  quickFilters?: JiraQuickFilter[];
};

/** Credentials stored in our DB (decrypted token not included in client-facing types) */
export type JiraCredentials = {
  email: string;
  baseUrl: string;
  storyPointsField: string;
  acField?: string;
};
