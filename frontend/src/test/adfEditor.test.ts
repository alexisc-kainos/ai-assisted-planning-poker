import { describe, expect, it } from 'vitest';
import { adfToEditorDocument, editorToAdfDocument } from '../adfEditor';
import type { AdfDocument } from '../types';

describe('ADF editor conversion', () => {
  it('round-trips supported nodes, marks, attributes and opaque content unchanged', () => {
    const document: AdfDocument = { type: 'doc', version: 1, content: [
      { type: 'heading', attrs: { level: 2, localId: 'heading-1' }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Styled', marks: [
        { type: 'strong' }, { type: 'link', attrs: { href: 'https://example.test', title: 'Source' } },
        { type: 'subsup', attrs: { type: 'sup' } }, { type: 'subsup', attrs: { type: 'vendor', key: 'retain' } },
        { type: 'vendorMark', attrs: { key: 'value' } },
      ] }] },
      { type: 'orderedList', attrs: { order: 4, localId: 'list-1' }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fourth' }] }] },
      ] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableHeader', attrs: { colspan: 2, localId: 'cell-1' }, content: [{ type: 'text', text: 'Header' }] },
        { type: 'tableCell', attrs: { rowspan: 2, colwidth: [120] }, content: [{ type: 'text', text: 'Cell' }] },
      ] }] },
      { type: 'panel', attrs: { panelType: 'info', extension: { id: 'keep' } }, content: [
        { type: 'mention', attrs: { id: 'account-1', text: '@Alex' } },
      ] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'attachment-1', type: 'file' } }] },
    ] };

    expect(editorToAdfDocument(adfToEditorDocument(document))).toEqual(document);
  });
});