import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';

import { useUiTranslation } from '../hooks/useUiTranslation';
import {
    BugReportForm,
    BugReportReceipt,
    BugReportTradingContext,
    CATEGORY_LABELS,
    MAX_ATTACHMENTS,
    SEVERITY_LABELS,
    captureScreenshot,
    fetchBugReportOptions,
    submitBugReport,
    validateAttachment,
} from '../services/bugReportService';

interface BugReportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    context?: BugReportTradingContext;
}

// Kept low on purpose, and matched by the control plane. The first live test
// reports ("check", "check ing") were blocked by a 10-character minimum the
// form never mentioned; only an empty-ish field is worth refusing.
const MIN_TITLE_LENGTH = 3;
const MIN_DESCRIPTION_LENGTH = 3;
const EMPTY_FORM: BugReportForm = {
    title: '',
    description: '',
    category: 'other',
    severity: 'medium',
    steps: '',
    expected: '',
    actual: '',
};

const inputClass = 'w-full bg-[#191a1e] border border-zinc-700 rounded px-2 py-1.5 text-[13px] text-zinc-200 outline-none focus:border-zinc-500';
const labelClass = 'block text-[11px] font-medium uppercase tracking-wide text-zinc-400 mb-1';

/**
 * Report a Bug, from the trading terminal.
 *
 * The gateway attaches the account's recent journal lines to whatever is filed
 * here, so a short report still arrives with the sequence of events that led to
 * it. That is why this form does not ask a trader to reconstruct timings they
 * have no way of knowing.
 */
export function BugReportDialog({ isOpen, onClose, context = {} }: BugReportDialogProps) {
    const tr = useUiTranslation();

    const [form, setForm] = useState<BugReportForm>(EMPTY_FORM);
    const [attachments, setAttachments] = useState<File[]>([]);
    const [showDetails, setShowDetails] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<BugReportReceipt | null>(null);
    const [storageEnabled, setStorageEnabled] = useState(true);

    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        fetchBugReportOptions().then((options) => {
            if (active) setStorageEnabled(options.enabled);
        });
        return () => { active = false; };
    }, [isOpen]);

    // Reset between openings so a previous submission's receipt does not greet
    // somebody filing a second, unrelated report.
    useEffect(() => {
        if (isOpen) return;
        setForm(EMPTY_FORM);
        setAttachments([]);
        setReceipt(null);
        setError('');
        setShowDetails(false);
    }, [isOpen]);

    const addFiles = useCallback((incoming: FileList | File[] | null) => {
        const candidates = Array.from(incoming || []);
        if (!candidates.length) return;
        setError('');
        setAttachments((current) => {
            const next = [...current];
            for (const file of candidates) {
                if (next.length >= MAX_ATTACHMENTS) {
                    setError(`At most ${MAX_ATTACHMENTS} attachments`);
                    break;
                }
                const problem = validateAttachment(file);
                if (problem) { setError(problem); continue; }
                next.push(file);
            }
            return next;
        });
    }, []);

    const handleCapture = async () => {
        setCapturing(true);
        setError('');
        try {
            // The dialog is hidden for the capture so the screenshot shows the
            // terminal the trader is complaining about, not this form.
            const file = await captureScreenshot();
            if (!file) {
                setError('The screen could not be captured. You can attach an image instead.');
                return;
            }
            addFiles([file]);
        } finally {
            setCapturing(false);
        }
    };

    if (!isOpen) return null;

    const titleLength = form.title.trim().length;
    const descriptionLength = form.description.trim().length;
    const canSubmit = titleLength >= MIN_TITLE_LENGTH && descriptionLength >= MIN_DESCRIPTION_LENGTH && !submitting;
    // A disabled button with no reason is what stopped the first reports.
    const submitHint = titleLength < MIN_TITLE_LENGTH
        ? `Add a title (at least ${MIN_TITLE_LENGTH} characters) to send the report.`
        : descriptionLength < MIN_DESCRIPTION_LENGTH
            ? `Describe what happened (at least ${MIN_DESCRIPTION_LENGTH} characters) to send the report.`
            : '';

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');
        try {
            const result = await submitBugReport({ form, attachments, context });
            setReceipt(result);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'The report could not be sent');
        } finally {
            setSubmitting(false);
        }
    };

    const update = (key: keyof BugReportForm) =>
        (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
            setForm((current) => ({ ...current, [key]: event.target.value }));

    return (
        <div data-html2canvas-ignore="true" className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-6" onClick={() => !submitting && onClose()}>
            <div
                className="bg-[#131316] border border-zinc-700 rounded-lg shadow-2xl w-full max-w-[600px] overflow-hidden"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={tr('Report a Bug')}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-[#191a1e]">
                    <h2 className="text-zinc-200 font-medium text-[14px]">{tr('Report a Bug')}</h2>
                    <button type="button" onClick={onClose} aria-label={tr('Close')} className="text-zinc-400 hover:text-white transition-colors">✕</button>
                </div>

                {receipt ? (
                    <div className="px-5 py-8 text-center">
                        <p className="text-[14px] font-medium text-zinc-100">{tr('Bug report sent')}</p>
                        <p className="mt-1 text-[12px] text-zinc-400">
                            {tr('Your broker and the RTX5 team can see this report.')}
                        </p>
                        <code className="mt-4 inline-block rounded border border-zinc-700 bg-[#191a1e] px-3 py-2 font-mono text-[12px] text-zinc-200">
                            {receipt.report_id}
                        </code>
                        {receipt.failed_attachments?.length ? (
                            <p className="mt-3 text-[11px] text-amber-400">
                                {tr('The report was sent, but an attachment could not be uploaded.')}
                            </p>
                        ) : null}
                        <div className="mt-5">
                            <button type="button" onClick={onClose} className="rounded border border-zinc-700 bg-[#191a1e] px-4 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-800">
                                {tr('Close')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto p-4 space-y-3">
                        {!storageEnabled ? (
                            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                                {tr('Bug reporting is not enabled on this server yet.')}
                            </p>
                        ) : null}

                        <div>
                            <label className={labelClass} htmlFor="terminal-bug-title">{tr('Title')}</label>
                            <input id="terminal-bug-title" className={inputClass} value={form.title} onChange={update('title')} maxLength={200} placeholder={tr('Close All does nothing')} required />
                        </div>

                        <div>
                            <label className={labelClass} htmlFor="terminal-bug-description">{tr('What happened?')}</label>
                            <textarea id="terminal-bug-description" className={`${inputClass} min-h-[92px] resize-y`} value={form.description} onChange={update('description')} maxLength={8000} required />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={labelClass} htmlFor="terminal-bug-category">{tr('Area')}</label>
                                <select id="terminal-bug-category" className={inputClass} value={form.category} onChange={update('category')}>
                                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>{tr(label)}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={labelClass} htmlFor="terminal-bug-severity">{tr('Severity')}</label>
                                <select id="terminal-bug-severity" className={inputClass} value={form.severity} onChange={update('severity')}>
                                    {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>{tr(label)}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <span className={labelClass}>{tr('Screenshot')}</span>
                            <div className="flex flex-wrap items-center gap-2">
                                <button type="button" onClick={handleCapture} disabled={capturing} className="rounded border border-zinc-700 bg-[#191a1e] px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
                                    {capturing ? tr('Capturing…') : tr('Capture this screen')}
                                </button>
                                <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded border border-zinc-700 bg-[#191a1e] px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800">
                                    {tr('Attach file')}
                                </button>
                            </div>
                            <input
                                ref={fileInputRef} type="file" multiple hidden
                                accept="image/png,image/jpeg,image/webp,text/plain,.log,.txt"
                                onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
                            />
                            {attachments.length ? (
                                <ul className="mt-2 space-y-1">
                                    {attachments.map((file, index) => (
                                        <li key={`${file.name}-${index}`} className="flex items-center justify-between rounded border border-zinc-700 bg-[#191a1e] px-2 py-1 text-[11px] text-zinc-300">
                                            <span className="truncate">{file.name}</span>
                                            <button type="button" aria-label={`${tr('Remove')} ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="ml-2 text-zinc-500 hover:text-zinc-200">✕</button>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            {/* Said plainly: a terminal screenshot shows balances and open positions. */}
                            <p className="mt-1.5 text-[10px] leading-4 text-zinc-500">
                                {tr('A screenshot of the terminal shows your balance and open positions. It is sent to your broker and the RTX5 team.')}
                            </p>
                        </div>

                        <button type="button" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails} className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200">
                            {showDetails ? tr('Hide details') : tr('Add steps to reproduce')}
                        </button>

                        {showDetails ? (
                            <div className="space-y-3 border-l-2 border-zinc-800 pl-3">
                                <div>
                                    <label className={labelClass} htmlFor="terminal-bug-steps">{tr('Steps (one per line)')}</label>
                                    <textarea id="terminal-bug-steps" className={`${inputClass} min-h-[70px] resize-y`} value={form.steps} onChange={update('steps')} />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={labelClass} htmlFor="terminal-bug-expected">{tr('Expected')}</label>
                                        <textarea id="terminal-bug-expected" className={`${inputClass} min-h-[54px] resize-y`} value={form.expected} onChange={update('expected')} />
                                    </div>
                                    <div>
                                        <label className={labelClass} htmlFor="terminal-bug-actual">{tr('Actual')}</label>
                                        <textarea id="terminal-bug-actual" className={`${inputClass} min-h-[54px] resize-y`} value={form.actual} onChange={update('actual')} />
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <p className="text-[10px] leading-4 text-zinc-500">
                            {tr('Your account, symbol, connection state and recent terminal activity are attached automatically. Your password is never included.')}
                        </p>

                        {submitHint && !submitting ? (
                            <p className="text-[11px] text-amber-300">{submitHint}</p>
                        ) : null}

                        {error ? (
                            <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">{error}</p>
                        ) : null}

                        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
                            <button type="button" onClick={onClose} disabled={submitting} className="rounded border border-zinc-700 px-4 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50">
                                {tr('Cancel')}
                            </button>
                            <button type="submit" disabled={!canSubmit} className="rounded bg-blue-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-blue-500 disabled:opacity-40">
                                {submitting ? tr('Sending…') : tr('Send report')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

export default BugReportDialog;
