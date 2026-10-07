import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { Bug, CheckCircle2, ChevronDown, FileText, LoaderCircle, Paperclip, Send, X } from 'lucide-react';
import '../styles/bug-report-dialog.css';

import { useUiTranslation } from '../hooks/useUiTranslation';
import {
    BugReportForm,
    BugReportReceipt,
    BugReportTradingContext,
    CATEGORY_LABELS,
    MAX_ATTACHMENTS,
    SEVERITY_LABELS,
    fetchBugReportOptions,
    submitBugReport,
    validateAttachment,
} from '../services/bugReportService';

interface BugReportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    context?: BugReportTradingContext;
}

// Text-only reports need enough information to send. Attachment reports can
// use a basic title and description while preserving any text the user enters.
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

const inputClass = 'rtx-bug-report-control rtx-bug-report-input';
const labelClass = 'rtx-bug-report-label';

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
    const [error, setError] = useState('');
    const [receipt, setReceipt] = useState<BugReportReceipt | null>(null);
    const [storageEnabled, setStorageEnabled] = useState(true);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(frame);
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [isOpen]);

    useEffect(() => {
        if (receipt) dialogRef.current?.focus();
    }, [receipt]);

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

    if (!isOpen) return null;

    const titleLength = form.title.trim().length;
    const descriptionLength = form.description.trim().length;
    const hasAttachments = attachments.length > 0;
    const canSubmit = (hasAttachments || (titleLength >= MIN_TITLE_LENGTH && descriptionLength >= MIN_DESCRIPTION_LENGTH)) && !submitting;
    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');
        try {
            const reportForm = hasAttachments ? {
                ...form,
                title: titleLength >= MIN_TITLE_LENGTH
                    ? form.title
                    : `${tr('Bug report with attachments')}${titleLength ? `: ${form.title.trim()}` : ''}`,
                description: descriptionLength >= MIN_DESCRIPTION_LENGTH
                    ? form.description
                    : `${descriptionLength ? `${form.description.trim()}\n\n` : ''}${tr('Please review the attached files for the reported issue.')}`,
            } : form;
            const result = await submitBugReport({ form: reportForm, attachments, context });
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
        <div data-html2canvas-ignore="true" className="rtx-bug-report-overlay" onClick={() => !submitting && onClose()}>
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="rtx-bug-report-dialog"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!submitting) onClose();
                    }
                    if (event.key !== 'Tab') return;
                    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
                        'button, input:not([type="file"]), textarea, select',
                    ) ?? []).filter((control) => !control.disabled);
                    const first = controls[0];
                    const last = controls[controls.length - 1];
                    if (!first) { event.preventDefault(); return; }
                    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
                        event.preventDefault(); last.focus();
                    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
                        event.preventDefault(); first.focus();
                    }
                }}
                role="dialog"
                aria-modal="true"
                aria-label={tr('Report a Bug')}
                aria-describedby="terminal-bug-introduction"
            >
                <div className="rtx-bug-report-header">
                    <span className="rtx-bug-report-emblem" aria-hidden="true"><Bug size={20} strokeWidth={1.5} /></span>
                    <div className="rtx-bug-report-heading">
                        <h2>{tr('Report a Bug')}</h2>
                        <p id="terminal-bug-introduction" className="rtx-bug-report-subtitle">{tr('Tell us what happened.')}</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={submitting} aria-label={tr('Close')} className="rtx-bug-report-icon-button"><X size={18} strokeWidth={1.5} aria-hidden="true" /></button>
                </div>

                {receipt ? (
                    <div className="rtx-bug-report-success">
                        <CheckCircle2 size={36} strokeWidth={1.5} aria-hidden="true" />
                        <h3>{tr('Bug report sent')}</h3>
                        <p className="rtx-bug-report-subtitle">
                            {tr('Your broker and the RTX5 team can see this report.')}
                        </p>
                        <code className="rtx-bug-report-receipt">
                            {receipt.report_id}
                        </code>
                        {receipt.failed_attachments?.length ? (
                            <p className="rtx-bug-report-notice">
                                {tr('The report was sent, but an attachment could not be uploaded.')}
                            </p>
                        ) : null}
                        <div>
                            <button type="button" onClick={onClose} className="rtx-bug-report-control rtx-bug-report-button">
                                {tr('Close')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="rtx-bug-report-form">
                        <div className="rtx-bug-report-body">
                            <div className="rtx-bug-report-fields">
                                {!storageEnabled ? (
                                    <p className="rtx-bug-report-notice">
                                        {tr('Bug reporting is not enabled on this server yet.')}
                                    </p>
                                ) : null}

                                <div>
                                    <label className={labelClass} htmlFor="terminal-bug-title">{tr('Title')}</label>
                                    <input ref={titleInputRef} id="terminal-bug-title" className={inputClass} value={form.title} onChange={update('title')} maxLength={200} placeholder={tr('Briefly describe the issue')} required={!hasAttachments} />
                                </div>

                                <div>
                                    <label className={labelClass} htmlFor="terminal-bug-description">{tr('What happened?')}</label>
                                    <textarea id="terminal-bug-description" className={`${inputClass} rtx-bug-report-description`} value={form.description} onChange={update('description')} maxLength={8000} placeholder={tr('What were you doing, and what went wrong?')} required={!hasAttachments} />
                                </div>

                                <div className="rtx-bug-report-field-pair">
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

                                <button type="button" onClick={() => setShowDetails((value) => !value)} aria-expanded={showDetails} aria-controls="terminal-bug-details" className="rtx-bug-report-details-toggle">
                                    {showDetails ? tr('Hide details') : tr('Add steps to reproduce')}
                                    <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                                </button>

                                {showDetails ? (
                                    <div id="terminal-bug-details" className="rtx-bug-report-details">
                                        <div>
                                            <label className={labelClass} htmlFor="terminal-bug-steps">{tr('Steps (one per line)')}</label>
                                            <textarea id="terminal-bug-steps" className={inputClass} value={form.steps} onChange={update('steps')} />
                                        </div>
                                        <div className="rtx-bug-report-field-pair">
                                            <div>
                                                <label className={labelClass} htmlFor="terminal-bug-expected">{tr('Expected')}</label>
                                                <textarea id="terminal-bug-expected" className={inputClass} value={form.expected} onChange={update('expected')} />
                                            </div>
                                            <div>
                                                <label className={labelClass} htmlFor="terminal-bug-actual">{tr('Actual')}</label>
                                                <textarea id="terminal-bug-actual" className={inputClass} value={form.actual} onChange={update('actual')} />
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                {error ? (
                                    <p role="alert" className="rtx-bug-report-error">{error}</p>
                                ) : null}
                            </div>

                            <aside className="rtx-bug-report-evidence" aria-label={tr('Screenshot')}>
                                <div className="rtx-bug-report-evidence-title"><h3>{tr('Attachments')}</h3><span className="rtx-bug-report-file-count">{attachments.length} / {MAX_ATTACHMENTS}</span></div>
                                {attachments.length ? (
                                    <ul className="rtx-bug-report-files">
                                        {attachments.map((file, index) => (
                                            <li key={`${file.name}-${index}`}>
                                                <FileText size={18} strokeWidth={1.5} aria-hidden="true" />
                                                <div className="rtx-bug-report-file-info"><span title={file.name}>{file.name}</span><small>{file.size < 1024 * 1024 ? `${Math.max(1, Math.ceil(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</small></div>
                                                <button type="button" disabled={submitting} aria-label={`${tr('Remove')} ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="rtx-bug-report-icon-button"><X size={16} strokeWidth={1.5} aria-hidden="true" /></button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                                <div className="rtx-bug-report-evidence-actions">
                                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={submitting || attachments.length >= MAX_ATTACHMENTS} className="rtx-bug-report-control rtx-bug-report-button"><Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />{tr('Attach file')}</button>
                                </div>
                                <input ref={fileInputRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,text/plain,.log,.txt" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                                <p className="rtx-bug-report-fine-print">{tr('Optional. Up to 5 files, 8 MB each.')}</p>
                                {hasAttachments ? <p className="rtx-bug-report-fine-print">{tr('Title and description are optional when a file is attached.')}</p> : null}
                            </aside>
                        </div>

                        <div className="rtx-bug-report-footer">
                            <div className="rtx-bug-report-footer-actions">
                                <button type="button" onClick={onClose} disabled={submitting} className="rtx-bug-report-control rtx-bug-report-button">
                                    {tr('Cancel')}
                                </button>
                                <button type="submit" disabled={!canSubmit} className="rtx-bug-report-button rtx-bug-report-send">
                                    {submitting ? <LoaderCircle className="rtx-bug-report-spinner" size={16} aria-hidden="true" /> : <Send size={16} strokeWidth={1.5} aria-hidden="true" />}
                                    {submitting ? tr('Sending…') : tr('Send report')}
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

export default BugReportDialog;
