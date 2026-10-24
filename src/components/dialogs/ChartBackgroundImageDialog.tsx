import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Image as ImageIcon, X } from 'lucide-react';
import { useUiTranslation } from '../../hooks/useUiTranslation';
import {
  useChartSettingsStore,
  type ChartBackgroundLogoArea,
  type ChartBackgroundLogoMode,
  type ChartProperties,
} from '../../store/useChartSettingsStore';
import { RTX5_DEFAULT_CHART_WATERMARK_SRC } from '../../utils/squareChartGridPrimitive';

export interface ChartBackgroundImageDialogProps {
  isOpen: boolean;
  symbol: string;
  timeframe: string;
  onClose: () => void;
}

interface SnapshotState {
  showBackgroundLogo: boolean;
  backgroundLogoMode: ChartBackgroundLogoMode;
  backgroundLogoOpacity: number;
  backgroundLogoArea: ChartBackgroundLogoArea;
  backgroundLogoUrl: string;
  backgroundLogoFileName: string;
  backgroundLogoFileDataUrl: string;
}

function readSnapshot(props: ChartProperties): SnapshotState {
  const showLogo = props.showBackgroundLogo !== false;
  const mode: ChartBackgroundLogoMode = !showLogo
    ? 'none'
    : props.backgroundLogoMode && props.backgroundLogoMode !== 'none'
      ? props.backgroundLogoMode
      : 'default';

  return {
    showBackgroundLogo: showLogo,
    backgroundLogoMode: mode,
    backgroundLogoOpacity:
      typeof props.backgroundLogoOpacity === 'number' && Number.isFinite(props.backgroundLogoOpacity)
        ? Math.min(100, Math.max(1, Math.round(props.backgroundLogoOpacity)))
        : 18,
    backgroundLogoArea: props.backgroundLogoArea ?? 'chart',
    backgroundLogoUrl: props.backgroundLogoUrl ?? '',
    backgroundLogoFileName: props.backgroundLogoFileName ?? '',
    backgroundLogoFileDataUrl: props.backgroundLogoFileDataUrl ?? '',
  };
}

export const ChartBackgroundImageDialog: React.FC<ChartBackgroundImageDialogProps> = ({
  isOpen,
  symbol,
  timeframe,
  onClose,
}) => {
  const tr = useUiTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initialSnapshotRef = useRef<SnapshotState | null>(null);

  const [mode, setMode] = useState<ChartBackgroundLogoMode>('default');
  const [opacity, setOpacity] = useState<number>(18);
  const [area, setArea] = useState<ChartBackgroundLogoArea>('chart');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [fileDataUrl, setFileDataUrl] = useState<string>('');
  const [applyToDefaultTemplate, setApplyToDefaultTemplate] = useState<boolean>(false);
  const [applyToAllOpenCharts, setApplyToAllOpenCharts] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    const store = useChartSettingsStore.getState();
    const currentProps = store.symbolProperties[symbol] || store.globalProperties;
    const snap = readSnapshot(currentProps);
    initialSnapshotRef.current = snap;
    setMode(snap.backgroundLogoMode);
    setOpacity(snap.backgroundLogoOpacity);
    setArea(snap.backgroundLogoArea);
    setImageUrl(snap.backgroundLogoUrl);
    setFileName(snap.backgroundLogoFileName);
    setFileDataUrl(snap.backgroundLogoFileDataUrl);
    setApplyToDefaultTemplate(false);
    setApplyToAllOpenCharts(false);
  }, [isOpen, symbol]);

  const applyPatchToSymbol = (patch: Partial<ChartProperties>, applyAll: boolean, applyGlobal: boolean) => {
    const store = useChartSettingsStore.getState();
    (Object.keys(patch) as Array<keyof ChartProperties>).forEach((key) => {
      const val = patch[key];
      if (val !== undefined) {
        store.updateSymbolProperty(symbol, key, val as never);
      }
    });

    if (applyGlobal) {
      (Object.keys(patch) as Array<keyof ChartProperties>).forEach((key) => {
        const val = patch[key];
        if (val !== undefined) {
          store.updateGlobalProperty(key, val as never);
        }
      });
    }

    if (applyAll) {
      const allSymbols = Object.keys(store.symbolProperties);
      for (const sym of allSymbols) {
        if (sym === symbol) continue;
        (Object.keys(patch) as Array<keyof ChartProperties>).forEach((key) => {
          const val = patch[key];
          if (val !== undefined) {
            store.updateSymbolProperty(sym, key, val as never);
          }
        });
      }
    }
  };

  // Live preview on active chart while adjusting inside the dialog
  useEffect(() => {
    if (!isOpen) return;
    const showLogo = mode !== 'none';
    applyPatchToSymbol(
      {
        showBackgroundLogo: showLogo,
        backgroundLogoMode: mode,
        backgroundLogoOpacity: opacity,
        backgroundLogoArea: area,
        backgroundLogoUrl: imageUrl,
        backgroundLogoFileName: fileName,
        backgroundLogoFileDataUrl: fileDataUrl,
      },
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, opacity, area, imageUrl, fileName, fileDataUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const isLightTheme =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('rtx-skin-untitled-light');

  const palette = isLightTheme
    ? {
        backdrop: 'rgba(15, 23, 42, 0.28)',
        surface: '#ffffff',
        surfaceBorder: '#cfd8e3',
        shadow: '0 20px 50px rgba(15, 23, 42, 0.18)',
        titleBarBg: '#f8fafc',
        titleBarBorder: '1px solid #e2e8f0',
        titleBarText: '#0f172a',
        closeButtonText: '#475569',
        headingText: '#0f172a',
        bodyText: '#1e293b',
        mutedText: '#64748b',
        divider: '#e2e8f0',
        inputBg: '#f8fafc',
        inputBorder: '#cbd5e1',
        inputText: '#0f172a',
        radioBg: '#ffffff',
        radioBorderChecked: '#009245',
        radioBorderUnchecked: '#94a3b8',
        radioDot: '#009245',
        checkboxBgUnchecked: '#ffffff',
        checkboxBorderUnchecked: '#94a3b8',
        secondaryBtnBg: '#f1f5f9',
        secondaryBtnBorder: '1px solid #cbd5e1',
        secondaryBtnText: '#1e293b',
      }
    : {
        backdrop: 'rgba(0, 0, 0, 0.25)',
        surface: '#2d2e32',
        surfaceBorder: '#45474d',
        shadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
        titleBarBg: '#ffffff',
        titleBarBorder: 'none',
        titleBarText: '#18181b',
        closeButtonText: '#3f3f46',
        headingText: '#ffffff',
        bodyText: '#e4e4e7',
        mutedText: '#9ca3af',
        divider: '#3a3c42',
        inputBg: '#1b1c1f',
        inputBorder: '#222327',
        inputText: '#f4f4f5',
        radioBg: '#1b1c1f',
        radioBorderChecked: '#9ca3af',
        radioBorderUnchecked: '#4b5563',
        radioDot: '#d4d4d8',
        checkboxBgUnchecked: '#1b1c1f',
        checkboxBorderUnchecked: '#1b1c1f',
        secondaryBtnBg: '#52555c',
        secondaryBtnBorder: 'none',
        secondaryBtnText: '#ffffff',
      };

  const defaultWatermarkDisplayUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}${RTX5_DEFAULT_CHART_WATERMARK_SRC}`
      : RTX5_DEFAULT_CHART_WATERMARK_SRC;

  const handleCancel = () => {
    const snap = initialSnapshotRef.current;
    if (snap) {
      applyPatchToSymbol(
        {
          showBackgroundLogo: snap.showBackgroundLogo,
          backgroundLogoMode: snap.backgroundLogoMode,
          backgroundLogoOpacity: snap.backgroundLogoOpacity,
          backgroundLogoArea: snap.backgroundLogoArea,
          backgroundLogoUrl: snap.backgroundLogoUrl,
          backgroundLogoFileName: snap.backgroundLogoFileName,
          backgroundLogoFileDataUrl: snap.backgroundLogoFileDataUrl,
        },
        false,
        false,
      );
    }
    onClose();
  };

  const handleSave = () => {
    const showLogo = mode !== 'none';
    applyPatchToSymbol(
      {
        showBackgroundLogo: showLogo,
        backgroundLogoMode: mode,
        backgroundLogoOpacity: opacity,
        backgroundLogoArea: area,
        backgroundLogoUrl: imageUrl,
        backgroundLogoFileName: fileName,
        backgroundLogoFileDataUrl: fileDataUrl,
      },
      applyToAllOpenCharts,
      applyToDefaultTemplate || applyToAllOpenCharts,
    );
    onClose();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFileDataUrl(reader.result);
        setMode('file');
      }
    };
    reader.readAsDataURL(file);
  };

  const renderRadioCircle = (checked: boolean) => (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: palette.radioBg,
        border: checked ? `1.5px solid ${palette.radioBorderChecked}` : `1.5px solid ${palette.radioBorderUnchecked}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {checked && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: palette.radioDot,
          }}
        />
      )}
    </span>
  );

  const renderCheckbox = (checked: boolean) => (
    <span
      style={{
        width: 13,
        height: 13,
        borderRadius: 2,
        background: checked ? '#009245' : palette.checkboxBgUnchecked,
        border: checked ? '1px solid #009245' : `1px solid ${palette.checkboxBorderUnchecked}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="2 6.5 4.5 9 10 3" />
        </svg>
      )}
    </span>
  );

  return ReactDOM.createPortal(
    <div
      className="rtx-background-image-dialog-backdrop"
      data-testid="chart-background-image-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        background: palette.backdrop,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${tr('Background image')} - ${symbol}, ${timeframe}`}
        data-theme={isLightTheme ? 'light' : 'dark'}
        style={{
          width: 356,
          background: palette.surface,
          border: `1px solid ${palette.surfaceBorder}`,
          borderRadius: 2,
          boxShadow: palette.shadow,
          color: palette.bodyText,
          overflow: 'hidden',
          userSelect: 'none',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Native-style Window Title Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 28,
            padding: '0 10px',
            background: palette.titleBarBg,
            borderBottom: palette.titleBarBorder,
            color: palette.titleBarText,
            fontSize: 12,
            fontWeight: 400,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <img
              src={RTX5_DEFAULT_CHART_WATERMARK_SRC}
              alt=""
              style={{ width: 14, height: 14, objectFit: 'contain', background: '#18181b', borderRadius: 2, padding: 1 }}
            />
            <span>{tr('Background image')} - RTX5</span>
          </div>
          <button
            type="button"
            className="rtx-bg-image-dialog__close"
            aria-label={tr('Close')}
            onClick={handleCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: palette.closeButtonText,
              cursor: 'pointer',
              padding: 2,
              borderRadius: 3,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Dialog Body */}
        <div style={{ padding: '14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Large Header matching cTrader */}
          <div
            style={{
              fontSize: 19,
              fontWeight: 700,
              color: palette.headingText,
              lineHeight: '24px',
              marginBottom: 4,
            }}
          >
            {tr('Background image')} - {symbol}, {timeframe.toLowerCase()}
          </div>

          {/* Row 1: None */}
          <div style={{ display: 'flex', alignItems: 'center', minHeight: 22 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                width: 74,
                fontSize: 12,
                cursor: 'pointer',
                color: palette.bodyText,
              }}
              onClick={() => setMode('none')}
            >
              {renderRadioCircle(mode === 'none')}
              <span>{tr('None')}</span>
            </label>
          </div>

          {/* Row 2: Default */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                width: 74,
                flexShrink: 0,
                fontSize: 12,
                cursor: 'pointer',
                color: palette.bodyText,
              }}
              onClick={() => setMode('default')}
            >
              {renderRadioCircle(mode === 'default')}
              <span>{tr('Default')}</span>
            </label>
            <input
              type="text"
              readOnly
              value={defaultWatermarkDisplayUrl}
              onClick={() => setMode('default')}
              style={{
                flex: 1,
                height: 22,
                padding: '0 8px',
                fontSize: 11.5,
                color: palette.inputText,
                background: palette.inputBg,
                border: `1px solid ${palette.inputBorder}`,
                borderRadius: 3,
                outline: 'none',
                cursor: 'pointer',
              }}
            />
          </div>

          {/* Row 3: URL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                width: 74,
                flexShrink: 0,
                fontSize: 12,
                cursor: 'pointer',
                color: palette.bodyText,
              }}
              onClick={() => setMode('url')}
            >
              {renderRadioCircle(mode === 'url')}
              <span>{tr('URL')}</span>
            </label>
            <input
              type="url"
              value={imageUrl}
              onFocus={() => setMode('url')}
              onChange={(e) => {
                setMode('url');
                setImageUrl(e.target.value);
              }}
              placeholder="none"
              style={{
                flex: 1,
                height: 22,
                padding: '0 8px',
                fontSize: 11.5,
                color: palette.inputText,
                background: palette.inputBg,
                border: `1px solid ${palette.inputBorder}`,
                borderRadius: 3,
                outline: 'none',
              }}
            />
            <button
              type="button"
              className="rtx-bg-image-dialog__secondary"
              title={tr('Use default image URL')}
              onClick={() => {
                setMode('url');
                if (!imageUrl) setImageUrl(defaultWatermarkDisplayUrl);
              }}
              style={{
                width: 24,
                height: 22,
                background: palette.secondaryBtnBg,
                border: palette.secondaryBtnBorder,
                borderRadius: 3,
                color: palette.secondaryBtnText,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <ImageIcon size={13} />
            </button>
          </div>

          {/* Row 4: Local file */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                width: 74,
                flexShrink: 0,
                fontSize: 12,
                cursor: 'pointer',
                color: palette.bodyText,
              }}
              onClick={() => setMode('file')}
            >
              {renderRadioCircle(mode === 'file')}
              <span>{tr('Local file')}</span>
            </label>
            <input
              type="text"
              readOnly
              value={fileName}
              onClick={() => {
                setMode('file');
                fileInputRef.current?.click();
              }}
              style={{
                flex: 1,
                height: 22,
                padding: '0 8px',
                fontSize: 11.5,
                color: palette.inputText,
                background: palette.inputBg,
                border: `1px solid ${palette.inputBorder}`,
                borderRadius: 3,
                outline: 'none',
                cursor: 'pointer',
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="rtx-bg-image-dialog__secondary"
              onClick={() => {
                setMode('file');
                fileInputRef.current?.click();
              }}
              style={{
                height: 22,
                padding: '0 10px',
                fontSize: 11.5,
                color: palette.secondaryBtnText,
                background: palette.secondaryBtnBg,
                border: palette.secondaryBtnBorder,
                borderRadius: 3,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {tr('Choose file')}
            </button>
          </div>

          <div style={{ height: 1, background: palette.divider, margin: '2px 0' }} />

          {/* Opacity Slider Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
            <span style={{ width: 74, flexShrink: 0, fontSize: 12, color: palette.mutedText }}>
              {tr('Opacity')}
            </span>
            <input
              type="range"
              min={1}
              max={100}
              value={opacity}
              disabled={mode === 'none'}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{
                flex: 1,
                accentColor: '#009245',
                cursor: mode === 'none' ? 'default' : 'pointer',
                opacity: mode === 'none' ? 0.45 : 1,
              }}
            />
          </div>

          {/* Area Row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ width: 74, flexShrink: 0, fontSize: 12, color: palette.bodyText, lineHeight: '18px' }}>
              {tr('Area')}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 12,
                  cursor: mode === 'none' ? 'default' : 'pointer',
                  color: palette.bodyText,
                  opacity: mode === 'none' ? 0.45 : 1,
                }}
                onClick={() => {
                  if (mode !== 'none') setArea('chart');
                }}
              >
                {renderRadioCircle(area === 'chart')}
                <span>{tr('Chart')}</span>
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 12,
                  cursor: mode === 'none' ? 'default' : 'pointer',
                  color: palette.bodyText,
                  opacity: mode === 'none' ? 0.45 : 1,
                }}
                onClick={() => {
                  if (mode !== 'none') setArea('chart_and_axes');
                }}
              >
                {renderRadioCircle(area === 'chart_and_axes')}
                <span>{tr('Chart and axes')}</span>
              </label>
            </div>
          </div>

          <div style={{ height: 1, background: palette.divider, margin: '2px 0' }} />

          {/* Template & Open Charts Checkboxes */}
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer', color: palette.bodyText }}
            onClick={() => setApplyToDefaultTemplate((prev) => !prev)}
          >
            {renderCheckbox(applyToDefaultTemplate)}
            <span>{tr('Apply changes to the default template')}</span>
          </label>

          <label
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer', color: palette.bodyText }}
            onClick={() => setApplyToAllOpenCharts((prev) => !prev)}
          >
            {renderCheckbox(applyToAllOpenCharts)}
            <span>{tr('Apply changes to all open charts')}</span>
          </label>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="rtx-bg-image-dialog__save"
              data-testid="chart-background-image-save"
              onClick={handleSave}
              style={{
                flex: 1,
                height: 24,
                background: '#009245',
                border: '1px solid #009245',
                borderRadius: 3,
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {tr('Save')}
            </button>
            <button
              type="button"
              className="rtx-bg-image-dialog__secondary"
              data-testid="chart-background-image-cancel"
              onClick={handleCancel}
              style={{
                flex: 1,
                height: 24,
                background: palette.secondaryBtnBg,
                border: palette.secondaryBtnBorder,
                borderRadius: 3,
                color: palette.secondaryBtnText,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {tr('Cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
