import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import Modal from './Modal';

// App-wide replacement for the browser's native confirm()/alert(), styled to
// match the "Mark as followed up?" popup (the Modal component). Promise-based so
// callers can `await confirm(...)` / `await alert(...)` inside event handlers.

type ConfirmOpts = { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string };
type AlertOpts = { title: string; message?: ReactNode; okLabel?: string };

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOpts; resolve: () => void }
  | null;

type DialogApi = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  alert: (opts: AlertOpts) => Promise<void>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used within a DialogProvider');
  return ctx;
}

const bodyStyle: React.CSSProperties = { fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-line' };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const close = useCallback(() => setState(null), []);

  const confirm = useCallback(
    (opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ kind: 'confirm', opts, resolve })),
    [],
  );
  const alert = useCallback(
    (opts: AlertOpts) => new Promise<void>((resolve) => setState({ kind: 'alert', opts, resolve })),
    [],
  );
  const api = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {state?.kind === 'confirm' && (
        <Modal
          title={state.opts.title}
          onClose={() => { state.resolve(false); close(); }}
          footer={<>
            <button className="btn" onClick={() => { state.resolve(false); close(); }}>
              {state.opts.cancelLabel ?? 'Cancel'}
            </button>
            <button className="btn btn-primary" onClick={() => { state.resolve(true); close(); }}>
              {state.opts.confirmLabel ?? 'Confirm'}
            </button>
          </>}
        >
          <div style={bodyStyle}>{state.opts.message}</div>
        </Modal>
      )}
      {state?.kind === 'alert' && (
        <Modal
          title={state.opts.title}
          onClose={() => { state.resolve(); close(); }}
          footer={
            <button className="btn btn-primary" onClick={() => { state.resolve(); close(); }}>
              {state.opts.okLabel ?? 'OK'}
            </button>
          }
        >
          <div style={bodyStyle}>{state.opts.message}</div>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}
