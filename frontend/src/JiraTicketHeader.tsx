import type { ReactNode } from 'react';
import { JiraIssueLink } from './JiraDescription';

/** Pairs a Jira issue key (linked, own box) with the ticket title (own box), wrapping on narrow screens. */
export function JiraTicketHeader({ jiraKey, jiraUrl, title }: { jiraKey: string; jiraUrl: string; title: ReactNode }) {
  return (
    <div className="jira-ticket-header">
      <JiraIssueLink url={jiraUrl}>
        <span className="jira-ticket-key">{jiraKey}</span>
      </JiraIssueLink>
      <div className="jira-ticket-title">{title}</div>
    </div>
  );
}
