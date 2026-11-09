import { Fragment, type ReactNode } from 'react';
import type { AdfDocument, AdfNode } from './types';

export function safeJiraUrl(value: unknown, mailto = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:' || (mailto && url.protocol === 'mailto:')) return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}

export function JiraIssueLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeJiraUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
}

export function JiraDescription({ document, issueUrl }: { document: AdfDocument; issueUrl: string }) {
  const render = (node: AdfNode, depth = 0): ReactNode => {
    if (depth > 40) return <JiraIssueLink url={issueUrl}>View remaining content in Jira</JiraIssueLink>;
    const children = node.content?.map((child, index) => <Fragment key={index}>{render(child, depth + 1)}</Fragment>);
    switch (node.type) {
      case 'text': {
        let text: ReactNode = node.text ?? '';
        for (const mark of node.marks ?? []) {
          switch (mark.type) {
            case 'strong': text = <strong>{text}</strong>; break;
            case 'em': text = <em>{text}</em>; break;
            case 'strike': text = <s>{text}</s>; break;
            case 'underline': text = <u>{text}</u>; break;
            case 'code': text = <code>{text}</code>; break;
            case 'subsup':
              if (mark.attrs?.type === 'sub') text = <sub>{text}</sub>;
              if (mark.attrs?.type === 'sup') text = <sup>{text}</sup>;
              break;
            case 'link': {
              const href = safeJiraUrl(mark.attrs?.href, true);
              if (href) text = <a href={href} target="_blank" rel="noopener noreferrer">{text}</a>;
              break;
            }
          }
        }
        return text;
      }
      case 'doc': return children;
      case 'paragraph': return <p>{children}</p>;
      case 'heading': {
        const level = Number(node.attrs?.level);
        if (level === 1) return <h2>{children}</h2>;
        if (level === 2) return <h3>{children}</h3>;
        if (level === 3) return <h4>{children}</h4>;
        if (level === 4) return <h5>{children}</h5>;
        return <h6>{children}</h6>;
      }
      case 'bulletList': return <ul>{children}</ul>;
      case 'orderedList': return <ol start={typeof node.attrs?.order === 'number' ? node.attrs.order : 1}>{children}</ol>;
      case 'listItem': return <li>{children}</li>;
      case 'blockquote': return <blockquote>{children}</blockquote>;
      case 'codeBlock': return <pre><code>{children}</code></pre>;
      case 'hardBreak': return <br />;
      case 'rule': return <hr />;
      case 'table': return <div className="jira-table-scroll" tabIndex={0} role="region" aria-label="Jira table"><table><tbody>{children}</tbody></table></div>;
      case 'tableRow': return <tr>{children}</tr>;
      case 'tableHeader': return <th scope="col">{children}</th>;
      case 'tableCell': return <td>{children}</td>;
      case 'panel': return <div className="jira-adf-panel">{children}</div>;
      case 'mediaSingle':
      case 'mediaGroup':
        return <div>{children?.length ? children : <JiraIssueLink url={issueUrl}>View attachment in Jira</JiraIssueLink>}</div>;
      case 'media':
        return <p><JiraIssueLink url={issueUrl}>{typeof node.attrs?.alt === 'string' && node.attrs.alt ? node.attrs.alt : 'View attachment in Jira'}</JiraIssueLink></p>;
      case 'mention': return <span>{typeof node.attrs?.text === 'string' ? node.attrs.text : 'Mention in Jira'}{children}</span>;
      case 'emoji': return <span>{typeof node.attrs?.text === 'string' ? node.attrs.text : typeof node.attrs?.shortName === 'string' ? node.attrs.shortName : ''}</span>;
      default:
        return <><JiraIssueLink url={issueUrl}>View attachment or embedded content in Jira</JiraIssueLink>{' '}{node.text}{children}</>;
    }
  };
  return <div className="jira-description">{render(document)}</div>;
}