import { useRef } from 'react';
import { useDialogs } from './Dialog';

export type ImportResult = { imported: number; skipped: number; errors: string[] };

type Props = {
  resource: string;
  data: () => unknown[];
  onImport: (rows: unknown[]) => Promise<ImportResult>;
  onAfterImport: () => void;
  disabled?: boolean;
};

export default function ImportExportButtons({ resource, data, onImport, onAfterImport, disabled }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, alert } = useDialogs();

  const exportNow = () => {
    const rows = data();
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resource}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Top-level JSON must be an array');
      if (!(await confirm({
        title: `Import ${resource}?`,
        message: `Import ${parsed.length} ${resource} record(s)? Existing ${resource} are NOT removed; imported rows are appended.`,
        confirmLabel: 'Import',
      }))) {
        return;
      }
      const result = await onImport(parsed);
      const lines = [
        `${result.imported} imported`,
        `${result.skipped} skipped`,
      ];
      if (result.errors.length) {
        lines.push('', 'Errors:', ...result.errors.slice(0, 20));
        if (result.errors.length > 20) lines.push(`…and ${result.errors.length - 20} more`);
      }
      await alert({ title: 'Import complete', message: lines.join('\n') });
      onAfterImport();
    } catch (e) {
      await alert({ title: 'Import failed', message: String(e) });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <button type="button" className="btn" onClick={exportNow} disabled={disabled} title={`Export all ${resource} as JSON`}>
        ↓ Export
      </button>
      <button type="button" className="btn" onClick={() => fileInputRef.current?.click()} disabled={disabled} title={`Import ${resource} from JSON`}>
        ↑ Import
      </button>
      <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />
    </>
  );
}
