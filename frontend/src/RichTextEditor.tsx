import { Extension, Mark, Node } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { adfToEditorDocument, editorToAdfDocument, type EditorNode } from './adfEditor';
import { JiraDescription, safeJiraUrl } from './JiraDescription';
import type { AdfDocument, AdfNode } from './types';

const NODE_TYPES = [
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule',
  'hardBreak', 'table', 'tableRow', 'tableHeader', 'tableCell',
];
const MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'underline', 'link', 'subscript', 'superscript', 'opaqueAdf'];

const AdfAttributes = Extension.create({
  name: 'adfAttributes',
  addGlobalAttributes() {
    return [
      { types: NODE_TYPES, attributes: { adfAttrs: { default: {}, rendered: false } } },
      { types: ['doc'], attributes: { adfVersion: { default: 1, rendered: false } } },
      { types: MARK_TYPES, attributes: { adfAttrs: { default: {}, rendered: false } } },
    ];
  },
});

const OpaqueAdfMark = Mark.create({
  name: 'opaqueAdf',
  addAttributes: () => ({ payload: { default: null, rendered: false } }),
  parseHTML: () => [],
  renderHTML: ({ HTMLAttributes }) => ['span', { ...HTMLAttributes, 'data-adf-mark': 'opaque' }, 0],
});

const ProtectPreservedAdf = Extension.create({
  name: 'protectPreservedAdf',
  addProseMirrorPlugins() {
    const signature = (document: typeof this.editor.state.doc) => {
      const nodes: string[] = [];
      document.descendants((node) => {
        if (node.type.name.startsWith('preservedAdf')) nodes.push(JSON.stringify({ type: node.type.name, payload: node.attrs.payload }));
      });
      return nodes;
    };
    return [new Plugin({
      filterTransaction: (transaction, state) => {
        if (!transaction.docChanged) return true;
        const previous = signature(state.doc);
        const next = signature(transaction.doc);
        return previous.length === next.length && previous.every((node, index) => node === next[index]);
      },
    })];
  },
});

function preservedLabel(node: AdfNode): string {
  if (node.type === 'mention') return typeof node.attrs?.text === 'string' ? node.attrs.text : 'Mention in Jira';
  if (node.type === 'emoji') return typeof node.attrs?.text === 'string' ? node.attrs.text
    : typeof node.attrs?.shortName === 'string' ? node.attrs.shortName : 'Emoji in Jira';
  if (['media', 'mediaSingle', 'mediaGroup'].includes(node.type)) {
    return typeof node.attrs?.alt === 'string' ? node.attrs.alt : 'Attachment in Jira';
  }
  if (node.type.toLowerCase().includes('card')) return 'Embedded content in Jira';
  return `Preserved Jira content (${node.type})`;
}

function PreservedAdfNodeView({ node, extension }: { node: { attrs: Record<string, unknown>; type: { name: string } }; extension: { options: { issueUrl: string } } }) {
  const payload = node.attrs.payload as AdfNode;
  const inline = node.type.name === 'preservedAdfInline';
  const panel = payload.type === 'panel';
  return (
    <NodeViewWrapper as={inline ? 'span' : 'div'} className={`jira-preserved-adf${inline ? ' is-inline' : ''}`} contentEditable={false}>
      {panel ? <JiraDescription document={{ type: 'doc', version: 1, content: [payload] }} issueUrl={extension.options.issueUrl} />
        : <span>{preservedLabel(payload)}</span>}
    </NodeViewWrapper>
  );
}

function preservedNode(name: string, inline: boolean) {
  return Node.create({
    name,
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: false,
    addOptions: () => ({ issueUrl: '' }),
    addAttributes: () => ({ payload: { default: null, rendered: false } }),
    parseHTML: () => [],
    renderHTML: ({ HTMLAttributes }) => [inline ? 'span' : 'div', { ...HTMLAttributes, 'data-preserved-adf': name }],
    addNodeView() { return ReactNodeViewRenderer(PreservedAdfNodeView); },
  });
}

const preservedInline = preservedNode('preservedAdfInline', true);
const preservedBlock = preservedNode('preservedAdfBlock', false);

function ToolbarButton({ label, pressed, disabled, onClick, children }: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return <button type="button" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children ?? label}</button>;
}

export function RichTextEditor({ id, label, document, issueUrl, disabled, invalid, describedBy, onChange }: {
  id?: string;
  label: string;
  document: AdfDocument;
  issueUrl: string;
  disabled: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: AdfDocument) => void;
}) {
  const [linkHref, setLinkHref] = useState('');
  const generatedId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const editorId = id ?? `jira-editor-${generatedId}`;
  const lastEmitted = useRef(JSON.stringify(document));
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
      Subscript,
      Superscript,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      AdfAttributes,
      OpaqueAdfMark,
      ProtectPreservedAdf,
      preservedInline.configure({ issueUrl }),
      preservedBlock.configure({ issueUrl }),
    ],
    content: adfToEditorDocument(document) as EditorNode,
    editable: !disabled,
    editorProps: { attributes: {
      id: editorId,
      'aria-label': label,
      'aria-multiline': 'true',
      ...(invalid ? { 'aria-invalid': 'true' } : {}),
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    } },
    onCreate: ({ editor: current }) => {
      lastEmitted.current = JSON.stringify(editorToAdfDocument(current.getJSON() as EditorNode));
    },
    onUpdate: ({ editor: current }) => {
      const value = editorToAdfDocument(current.getJSON() as EditorNode);
      const serialized = JSON.stringify(value);
      if (serialized === lastEmitted.current) return;
      lastEmitted.current = serialized;
      onChange(value);
    },
  }, [issueUrl]);

  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);

  const applyLink = () => {
    const href = safeJiraUrl(linkHref, true);
    if (href && editor) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="jira-rich-text-editor" aria-label={`${label} rich-text editor`}>
      <div className="jira-editor-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <ToolbarButton label="Bold" pressed={editor?.isActive('bold')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton label="Italic" pressed={editor?.isActive('italic')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <ToolbarButton label="Strikethrough" pressed={editor?.isActive('strike')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleStrike().run()}>S</ToolbarButton>
        <ToolbarButton label="Underline" pressed={editor?.isActive('underline')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></ToolbarButton>
        <ToolbarButton label="Inline code" pressed={editor?.isActive('code')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleCode().run()}>{'<> '}</ToolbarButton>
        <ToolbarButton label="Subscript" pressed={editor?.isActive('subscript')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleSubscript().run()}>x₂</ToolbarButton>
        <ToolbarButton label="Superscript" pressed={editor?.isActive('superscript')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleSuperscript().run()}>x²</ToolbarButton>
        <label className="visually-hidden" htmlFor={`${editorId}-heading-level`}>Heading level</label>
        <select id={`${editorId}-heading-level`} value={String([1, 2, 3, 4, 5, 6].find((level) => editor?.isActive('heading', { level }) ) ?? 0)}
          disabled={!editor || disabled} onChange={(event) => {
            const level = Number(event.target.value);
            if (level) editor?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
            else editor?.chain().focus().setParagraph().run();
          }}>
          <option value="0">Paragraph</option>
          {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>Heading {level}</option>)}
        </select>
        <ToolbarButton label="Bulleted list" pressed={editor?.isActive('bulletList')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}>Bullets</ToolbarButton>
        <ToolbarButton label="Numbered list" pressed={editor?.isActive('orderedList')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>Numbered</ToolbarButton>
        <ToolbarButton label="Blockquote" pressed={editor?.isActive('blockquote')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>Quote</ToolbarButton>
        <ToolbarButton label="Code block" pressed={editor?.isActive('codeBlock')} disabled={!editor || disabled} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>Code block</ToolbarButton>
        <ToolbarButton label="Horizontal rule" disabled={!editor || disabled} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>Rule</ToolbarButton>
        <label className="visually-hidden" htmlFor={`${editorId}-link`}>Link URL</label>
        <input id={`${editorId}-link`} type="url" value={linkHref} disabled={!editor || disabled} onChange={(event) => setLinkHref(event.target.value)} />
        <ToolbarButton label="Apply link" disabled={!editor || disabled || !linkHref} onClick={applyLink}>Link</ToolbarButton>
        <ToolbarButton label="Remove link" disabled={!editor || disabled || !editor?.isActive('link')} onClick={() => editor?.chain().focus().unsetLink().run()}>Unlink</ToolbarButton>
        <ToolbarButton label="Insert table" disabled={!editor || disabled} onClick={() => editor?.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>Table</ToolbarButton>
        <ToolbarButton label="Add row" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().addRowAfter().run()}>+ Row</ToolbarButton>
        <ToolbarButton label="Add column" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().addColumnAfter().run()}>+ Column</ToolbarButton>
        <ToolbarButton label="Toggle header row" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().toggleHeaderRow().run()}>Header row</ToolbarButton>
        <ToolbarButton label="Toggle header cell" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().toggleHeaderCell().run()}>Header cell</ToolbarButton>
        <ToolbarButton label="Remove row" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteRow().run()}>− Row</ToolbarButton>
        <ToolbarButton label="Remove column" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteColumn().run()}>− Column</ToolbarButton>
        <ToolbarButton label="Remove table" disabled={!editor || disabled || !editor?.isActive('table')} onClick={() => editor?.chain().focus().deleteTable().run()}>Remove table</ToolbarButton>
      </div>
      <EditorContent editor={editor} className="jira-editor-content" />
    </div>
  );
}