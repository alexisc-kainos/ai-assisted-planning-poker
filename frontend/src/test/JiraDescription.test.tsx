import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JiraDescription } from '../JiraDescription';
import type { AdfDocument } from '../types';

const issueUrl = 'https://team.atlassian.net/browse/PPK-1';

describe('JiraDescription', () => {
  it('renders rich text, lists, quotes, code, tables, panels, mentions and safe links', () => {
    const document: AdfDocument = { type: 'doc', version: 1, content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Important', marks: [{ type: 'strong' }, { type: 'em' }, { type: 'underline' }, { type: 'strike' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'Reference', marks: [{ type: 'link', attrs: { href: issueUrl } }] },
        { type: 'text', text: 'Email', marks: [{ type: 'link', attrs: { href: 'mailto:team@example.com' } }] },
      ] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] }] },
      { type: 'orderedList', attrs: { order: 3 }, content: [{ type: 'listItem', content: [{ type: 'text', text: 'Third' }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: '<script>literal()</script>' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableHeader', content: [{ type: 'text', text: 'Column' }] },
        { type: 'tableCell', content: [{ type: 'text', text: 'Value' }] },
      ] }] },
      { type: 'panel', content: [{ type: 'mention', attrs: { text: '@Alex' } }] },
    ] };
    const { container } = render(<JiraDescription document={document} issueUrl={issueUrl} />);
    expect(screen.getByRole('region', { name: 'Jira description' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('heading', { name: 'Acceptance' })).toBeInTheDocument();
    expect(screen.getByText('Important').closest('strong')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Reference' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:team@example.com');
    expect(screen.getByText('Third').closest('ol')).toHaveAttribute('start', '3');
    expect(screen.getByText('Quoted').closest('blockquote')).not.toBeNull();
    expect(screen.getByRole('columnheader')).toHaveTextContent('Column');
    expect(screen.getByRole('cell')).toHaveTextContent('Value');
    expect(screen.getByText('@Alex')).toBeInTheDocument();
    expect(container.querySelector('pre code')).toHaveTextContent('<script>literal()</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('br')).not.toBeNull();
  });

  it('rejects unsafe URLs and renders unknown/media descendants with canonical fallback links', () => {
    const document: AdfDocument = { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: ['javascript:alert(1)', 'data:text/html,test', '//evil.test'].map((href) => ({
        type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }],
      })) },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { url: 'https://evil.test/image' } }] },
      { type: 'unknownEmbed', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Readable fallback' }] }] },
    ] };
    const { container } = render(<JiraDescription document={document} issueUrl={issueUrl} />);
    expect(screen.getByText('Readable fallback')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View attachment in Jira' })).toHaveLength(1);
    expect(screen.getAllByRole('link')).toHaveLength(2);
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('href', issueUrl);
    expect(container.querySelector('img,iframe,script')).toBeNull();
  });

  it('renders inline embeds without block markup inside paragraphs and supports subscript/superscript', () => {
    const document: AdfDocument = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [
      { type: 'inlineCard', attrs: { url: 'https://external.test' }, content: [{ type: 'text', text: 'Readable embed' }] },
      { type: 'text', text: 'Subscript', marks: [{ type: 'subsup', attrs: { type: 'sub' } }] },
      { type: 'text', text: 'Superscript', marks: [{ type: 'subsup', attrs: { type: 'sup' } }] },
    ] }] };
    const { container } = render(<JiraDescription document={document} issueUrl={issueUrl} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', issueUrl);
    expect(screen.getByText('Subscript').tagName).toBe('SUB');
    expect(screen.getByText('Superscript').tagName).toBe('SUP');
    expect(container.querySelector('p div')).toBeNull();
    expect(container.querySelector('p')).toHaveTextContent('Readable embed');
  });
});