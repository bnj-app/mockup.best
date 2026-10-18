'use client';

import { useState } from 'react';
import { BRAND } from '@/config/brand';
import { Select } from '@/components/panel/Controls';
import { useEditor } from '@/store/editor';
import { parseTable, toCsv } from '@/lib/csv';
import { toast } from '@/components/shell/Toast';

/**
 * Languages and localized variants. Set up once, translate text per language: base + additional
 * languages, preview language for scene text, and CSV round trips ("Copy CSV" → fill the table →
 * "Paste CSV"). Store-set and "All languages" exports write a separate folder for each language.
 */
export function LanguagesPanel() {
  const baseLang = useEditor((s) => s.baseLang);
  const languages = useEditor((s) => s.languages);
  const previewLang = useEditor((s) => s.previewLang);
  const [draft, setDraft] = useState('');
  const [paste, setPaste] = useState<string | null>(null);

  const add = () => {
    const code = useEditor.getState().addLanguage(draft);
    if (!code) {
      toast('Use a language code like tr, de or pt-BR');
      return;
    }
    setDraft('');
  };

  /** Base text + existing translations; deduplicate identical text across all scenes. */
  const copyCsv = async () => {
    const st = useEditor.getState();
    const seen = new Map<string, Record<string, string>>();
    for (const sh of st.shots) {
      for (const t of sh.texts) {
        if (t.kind === 'logo' || !t.text.trim()) continue;
        const key = t.text.trim();
        seen.set(key, { ...(seen.get(key) ?? {}), ...(t.i18n ?? {}) });
      }
    }
    const rows = [[st.baseLang, ...st.languages], ...[...seen].map(([k, tr]) => [k, ...st.languages.map((l) => tr[l] ?? '')])];
    const csv = toCsv(rows);
    try {
      await navigator.clipboard.writeText(csv);
      toast(`Copied ${seen.size} text${seen.size === 1 ? '' : 's'} as CSV — fill in the columns, then Paste CSV`);
    } catch {
      // Download a file if clipboard permission is unavailable.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `${BRAND.fileSlug}-texts.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  };

  const importCsv = () => {
    const table = parseTable(paste ?? '');
    if (table.length < 2) {
      toast('Paste a table: first row language codes, then one row per text');
      return;
    }
    const r = useEditor.getState().importTranslations(table);
    toast(
      `Translated ${r.texts} text${r.texts === 1 ? '' : 's'}` +
        (r.unmatched ? ` · ${r.unmatched} row${r.unmatched === 1 ? '' : 's'} matched no text` : '') +
        (r.langs.length ? ` · languages: ${r.langs.join(', ')}` : ''),
    );
    setPaste(null);
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="languages">
      <span className="mp-label mt-1" style={{ color: 'var(--mp-text-tertiary)', fontSize: 9 }}>
        LANGUAGES
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <span
          className="mp-label px-2 py-1"
          title="Language of the texts as typed"
          style={{ background: 'var(--mp-surface-active)', borderRadius: 6 }}
        >
          {baseLang} · base
        </span>
        {languages.map((l) => (
          <span
            key={l}
            className="mp-label flex items-center gap-1 px-2 py-1"
            style={{ background: 'var(--mp-surface)', borderRadius: 6 }}
          >
            {l}
            <button
              onClick={() => useEditor.getState().removeLanguage(l)}
              aria-label={`Remove ${l}`}
              title="Remove language (translations are kept)"
              style={{ color: 'var(--mp-text-tertiary)' }}
            >
              ✕
            </button>
          </span>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="+ tr"
            aria-label="Add language code"
            data-testid="add-language"
            maxLength={8}
            className="mp-label w-14 px-2 py-1 outline-none"
            style={{ background: 'var(--mp-surface)', borderRadius: 6, color: 'var(--mp-text-primary)', textTransform: 'none' }}
          />
        </form>
      </div>
      {languages.length ? (
        <>
          <Select
            label="Preview"
            value={previewLang ?? '__base'}
            options={[{ value: '__base', label: `${baseLang} (base)` }, ...languages.map((l) => ({ value: l, label: l }))]}
            onChange={(v) => useEditor.getState().setPreviewLang(v === '__base' ? null : v)}
          />
        </>
      ) : null}
      <div className="flex gap-1">
        <button
          onClick={() => void copyCsv()}
          className="mp-label flex-1 py-1.5"
          style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
          title="Every text with its translations, one row each"
        >
          Copy CSV
        </button>
        <button
          onClick={() => setPaste((p) => (p === null ? '' : null))}
          className="mp-label flex-1 py-1.5"
          style={{ background: 'var(--mp-surface-active)', borderRadius: 'var(--mp-radius)' }}
          data-testid="paste-csv"
        >
          Paste CSV
        </button>
      </div>
      {paste !== null ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder={'en,tr,de\nFind your flow,Akışını bul,Finde deinen Flow'}
            data-testid="csv-input"
            className="mp-label w-full resize-y p-2 outline-none"
            style={{
              background: 'var(--mp-surface)',
              borderRadius: 'var(--mp-radius)',
              color: 'var(--mp-text-primary)',
              textTransform: 'none',
              fontSize: 11,
              lineHeight: 1.4,
            }}
          />
          <button
            onClick={importCsv}
            className="mp-label py-1.5"
            data-testid="import-csv"
            style={{ background: 'var(--mp-accent)', color: '#fff', borderRadius: 'var(--mp-radius)' }}
          >
            Import translations
          </button>
        </div>
      ) : null}
    </div>
  );
}
