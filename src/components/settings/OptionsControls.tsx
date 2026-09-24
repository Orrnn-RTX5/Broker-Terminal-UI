import { useId, type ReactNode } from 'react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import { Icon, type IconName } from '../ui/Icon';

export function SettingsSection({ title, description, children, action }: {
    title: string; description?: string; children: ReactNode; action?: ReactNode;
}) {
    const tr = useUiTranslation();
    const id = useId();
    return <section className="options-section" aria-labelledby={id}>
        <div className="options-section-heading">
            <div><h3 id={id}>{tr(title)}</h3>{description && <p>{tr(description)}</p>}</div>
            {action}
        </div>
        <div className="options-section-body">{children}</div>
    </section>;
}

export function SettingsToggle({ label, description, checked, onChange, disabled = false }: {
    label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
    const tr = useUiTranslation();
    const id = useId();
    return <label className="options-setting-row" data-disabled={disabled || undefined}>
        <span className="options-setting-copy">
            <span className="options-setting-label">{tr(label)}</span>
            {description && <span className="options-setting-description" id={id}>{tr(description)}</span>}
        </span>
        <span className="options-toggle">
            <input type="checkbox" aria-label={tr(label)} aria-describedby={description ? id : undefined}
                checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
            <span className="options-toggle-track" aria-hidden="true" />
        </span>
    </label>;
}

export function SettingsField({ label, htmlFor, hint, children }: {
    label: string; htmlFor: string; hint?: string; children: ReactNode;
}) {
    const tr = useUiTranslation();
    return <div className="options-field">
        <label htmlFor={htmlFor}>{tr(label)}</label>
        {children}
        {hint && <p className="options-field-hint">{tr(hint)}</p>}
    </div>;
}

export function SettingsNotice({ children, icon = 'info' }: { children: ReactNode; icon?: IconName }) {
    return <div className="options-notice"><Icon name={icon} size={16} /><div>{children}</div></div>;
}
