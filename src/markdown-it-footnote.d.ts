// @types/markdown-it-footnote depends on @types/markdown-it, whose types differ from those markdown-it 15 ships.
declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';

  export default function footnote(md: MarkdownIt): void;
}
