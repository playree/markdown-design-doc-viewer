/**
 * Translation of the texts shown in the preview. The extension host passes `vscode.l10n.t`;
 * the modules here do not import `vscode`, so they take the function as a parameter.
 */

/** Same signature as `vscode.l10n.t`: `message` is the English text, with `{0}`, `{1}`… for `args`. */
export type Translate = (message: string, ...args: (string | number)[]) => string;

/** Default `Translate` that keeps the English text and only fills in the arguments. */
export const formatMessage: Translate = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (match, index: string) => (Number(index) < args.length ? String(args[Number(index)]) : match));
