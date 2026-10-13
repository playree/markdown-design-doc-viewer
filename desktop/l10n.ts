import ja from '../l10n/bundle.l10n.ja.json';
import { formatMessage, translatorFor, type Translate } from '../src/l10n';

/** The language of the system (that of the webview), with the translations of the extension (l10n/). */
export const lang = navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';

export const t: Translate = lang === 'ja' ? translatorFor(ja) : formatMessage;
