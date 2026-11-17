import type { AdfDocument, AdfNode } from './types';

export interface EditorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: EditorNode[];
}

const ADF_TO_EDITOR_NODES: Record<string, string> = {
  doc: 'doc', paragraph: 'paragraph', heading: 'heading', bulletList: 'bulletList', orderedList: 'orderedList',
  listItem: 'listItem', blockquote: 'blockquote', codeBlock: 'codeBlock', hardBreak: 'hardBreak',
  rule: 'horizontalRule', table: 'table', tableRow: 'tableRow', tableHeader: 'tableHeader', tableCell: 'tableCell',
  text: 'text',
};

const ADF_TO_EDITOR_MARKS: Record<string, string> = {
  strong: 'bold', em: 'italic', strike: 'strike', underline: 'underline', code: 'code', link: 'link',
};

function adfMarkToEditor(mark: NonNullable<AdfNode['marks']>[number]): NonNullable<EditorNode['marks']>[number] {
  if (mark.type === 'subsup') {
    const type = mark.attrs?.type;
    if (type !== 'sub' && type !== 'sup') return { type: 'opaqueAdf', attrs: { payload: mark } };
    return { type: type === 'sub' ? 'subscript' : 'superscript', attrs: { adfAttrs: mark.attrs ?? {} } };
  }
  const editorType = ADF_TO_EDITOR_MARKS[mark.type];
  if (!editorType) return { type: 'opaqueAdf', attrs: { payload: mark } };
  const attrs = { adfAttrs: mark.attrs ?? {} };
  if (mark.type === 'link') return { type: editorType, attrs: { ...attrs, href: mark.attrs?.href } };
  return { type: editorType, attrs };
}

function editorMarkToAdf(mark: NonNullable<EditorNode['marks']>[number]): NonNullable<AdfNode['marks']>[number] {
  if (mark.type === 'opaqueAdf') return mark.attrs?.payload as NonNullable<AdfNode['marks']>[number];
  const adfType = Object.keys(ADF_TO_EDITOR_MARKS).find((type) => ADF_TO_EDITOR_MARKS[type] === mark.type);
  if (adfType) {
    const attrs = { ...((mark.attrs?.adfAttrs as Record<string, unknown> | undefined) ?? {}) };
    if (adfType === 'link' && mark.attrs?.href !== undefined) attrs.href = mark.attrs.href;
    return { type: adfType, ...(Object.keys(attrs).length ? { attrs } : {}) };
  }
  if (mark.type === 'subscript' || mark.type === 'superscript') {
    const attrs = { ...((mark.attrs?.adfAttrs as Record<string, unknown> | undefined) ?? {}) };
    attrs.type = mark.type === 'subscript' ? 'sub' : 'sup';
    return { type: 'subsup', attrs };
  }
  return { type: mark.type, ...(mark.attrs ? { attrs: mark.attrs } : {}) };
}

function adfNodeToEditor(node: AdfNode): EditorNode {
  const editorType = ADF_TO_EDITOR_NODES[node.type];
  if (!editorType) {
    const inline = ['mention', 'emoji', 'inlineCard'].includes(node.type);
    return {
      type: inline ? 'preservedAdfInline' : 'preservedAdfBlock',
      attrs: { payload: node },
    };
  }

  const attrs: Record<string, unknown> = { adfAttrs: node.attrs ?? {} };
  if (node.type === 'doc') attrs.adfVersion = (node as AdfDocument).version;
  if (node.type === 'heading') attrs.level = node.attrs?.level ?? 1;
  if (node.type === 'orderedList') attrs.start = node.attrs?.order ?? 1;
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    if (node.attrs?.colspan !== undefined) attrs.colspan = node.attrs.colspan;
    if (node.attrs?.rowspan !== undefined) attrs.rowspan = node.attrs.rowspan;
    if (node.attrs?.colwidth !== undefined) attrs.colwidth = node.attrs.colwidth;
  }

  return {
    type: editorType,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks ? { marks: node.marks.map(adfMarkToEditor) } : {}),
    ...(node.content ? { content: node.content.map(adfNodeToEditor) } : {}),
  };
}

function editorNodeToAdf(node: EditorNode): AdfNode {
  if (node.type === 'preservedAdfInline' || node.type === 'preservedAdfBlock') {
    return node.attrs?.payload as AdfNode;
  }

  const adfType = node.type === 'horizontalRule' ? 'rule' : node.type;
  const attrs = { ...((node.attrs?.adfAttrs as Record<string, unknown> | undefined) ?? {}) };
  if (node.type === 'heading' && node.attrs?.level !== undefined) attrs.level = node.attrs.level;
  if (node.type === 'orderedList' && node.attrs?.start !== undefined) attrs.order = node.attrs.start;
  if (node.type === 'tableCell' || node.type === 'tableHeader') {
    for (const [editorName, adfName] of [['colspan', 'colspan'], ['rowspan', 'rowspan'], ['colwidth', 'colwidth']]) {
      if (node.attrs?.[editorName] !== undefined) attrs[adfName] = node.attrs[editorName];
    }
  }

  return {
    type: adfType,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks ? { marks: node.marks.map(editorMarkToAdf) } : {}),
    ...(node.content ? { content: node.content.map(editorNodeToAdf) } : {}),
  };
}

export function adfToEditorDocument(document: AdfDocument): EditorNode {
  return adfNodeToEditor(document);
}

export function editorToAdfDocument(document: EditorNode): AdfDocument {
  const converted = editorNodeToAdf(document);
  return {
    ...converted,
    type: 'doc',
    version: typeof document.attrs?.adfVersion === 'number' ? document.attrs.adfVersion as 1 : 1,
    content: converted.content ?? [],
  };
}