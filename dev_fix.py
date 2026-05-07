import re

with open('src/components/dock/DockContainer.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. CompassRose
compass_regex = re.compile(r'const CompassRose: React\.FC<\{.*?\n  \);\n};\n', re.DOTALL)
new_compass = """const CompassRose: React.FC<{
  targetPanelId: string;
  hoveredDir: string | null;
}> = ({ targetPanelId, hoveredDir }) => {
  const centerDirs = [
    { key: 'top', icon: '▲', pos: 'top-0 left-1/2 -translate-x-1/2' },
    { key: 'bottom', icon: '▼', pos: 'bottom-0 left-1/2 -translate-x-1/2' },
    { key: 'left', icon: '◄', pos: 'left-0 top-1/2 -translate-y-1/2' },
    { key: 'right', icon: '►', pos: 'right-0 top-1/2 -translate-y-1/2' },
    { key: 'center', icon: '■', pos: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' },
  ];

  const edgeDirs = [
    { key: 'edge-top', icon: '▲', pos: 'top-1 left-1/2 -translate-x-1/2' },
    { key: 'edge-bottom', icon: '▼', pos: 'bottom-1 left-1/2 -translate-x-1/2' },
    { key: 'edge-left', icon: '◄', pos: 'left-1 top-1/2 -translate-y-1/2' },
    { key: 'edge-right', icon: '►', pos: 'right-1 top-1/2 -translate-y-1/2' },
  ];

  const renderBtn = ({ key, icon, pos }: any, isCenter: boolean) => (
    <div
      key={key}
      data-dir={key}
      className={cn(
        'compass-dir-btn absolute flex items-center justify-center',
        'border border-zinc-400 rounded-[3px] text-[13px] leading-none',
        'transition-all duration-75 pointer-events-auto select-none',
        isCenter ? 'w-[30px] h-[30px]' : 'w-[28px] h-[28px]',
        hoveredDir === key
          ? 'bg-zinc-800 text-white border-blue-400 shadow-lg scale-110 z-10'
          : isCenter ? 'bg-zinc-100 text-zinc-600 shadow-md' : 'bg-zinc-300 text-zinc-700 shadow-sm opacity-80',
        pos
      )}
    >
      {icon}
    </div>
  );

  return (
    <div className="absolute inset-0 z-[200] pointer-events-none">
      {edgeDirs.map(d => renderBtn(d, false))}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[100px] h-[100px] pointer-events-none">
        {centerDirs.map(d => renderBtn(d, true))}
      </div>
    </div>
  );
};
"""
code = compass_regex.sub(new_compass, code)

# 2. DockPreview
preview_regex = re.compile(r'const DockPreview: React\.FC<\{ direction: string \| null \}> = \(\{ direction \}\) => \{.*?^\};\n', re.MULTILINE | re.DOTALL)
new_preview = """const DockPreview: React.FC<{ direction: string | null; isGlobal?: boolean }> = ({ direction, isGlobal }) => {
  if (!direction) return null;

  const classes: Record<string, string> = {
    top: 'top-0 left-0 right-0 h-1/2',
    bottom: 'bottom-0 left-0 right-0 h-1/2',
    left: 'left-0 top-0 bottom-0 w-1/2',
    right: 'right-0 top-0 bottom-0 w-1/2',
    center: 'inset-0',
    'edge-top': 'top-0 left-0 right-0 h-1/3',
    'edge-bottom': 'bottom-0 left-0 right-0 h-1/3',
    'edge-left': 'left-0 top-0 bottom-0 w-1/3',
    'edge-right': 'right-0 top-0 bottom-0 w-1/3',
  };

  return (
    <div
      className={cn(
        isGlobal ? 'fixed' : 'absolute',
        'pointer-events-none z-[9999] transition-all duration-100',
        'bg-zinc-500/25 border-2 border-blue-400/50',
        classes[direction] || ''
      )}
    />
  );
};
"""
code = preview_regex.sub(new_preview, code)

# 3. Local State variables
code = code.replace(
    "const [dropTargetId, setDropTargetId] = useState<string | null>(null);\n  const [compassDir, setCompassDir] = useState<string | null>(null);",
    ""
)

# 4. Global State variables
store_regex = re.compile(r'const \{\s+layout,\s+dragState,\s+dragInfo,\s+startDrag,')
new_store = """const {
    layout,
    dragState,
    dragInfo,
    dropTargetId,
    compassDir,
    setDropIntent,
    startDrag,"""
code = store_regex.sub(new_store, code)

# 5. handleMouseMove
mm_regex = re.compile(r'const handleMouseMove = \(e: MouseEvent\) => \{.*?^\s+setDropTargetId\(null\);\n\s+dockIntent\.targetPanelId = null;\n\s+dockIntent\.direction = null;\n\s+\}\n\s+\};\n', re.MULTILINE | re.DOTALL)
new_mm = """const handleMouseMove = (e: MouseEvent) => {
      const { dragInfo, updateDrag, setDropIntent } = useDockLayoutStore.getState();
      if (!dragInfo) return;

      updateDrag(e.clientX, e.clientY);

      const panels = document.querySelectorAll('[data-dock-panel]');
      let foundTarget: string | null = null;
      let foundDir: string | null = null;

      const compassBtns = document.querySelectorAll('.compass-dir-btn');
      compassBtns.forEach((btn) => {
        const rect = btn.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          foundDir = btn.getAttribute('data-dir');
        }
      });

      panels.forEach((panelEl) => {
        const rect = panelEl.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const panelId = panelEl.getAttribute('data-dock-panel');
          if (panelId && panelId !== dragInfo.panelId) {
            foundTarget = panelId;
          }
        }
      });

      if (foundTarget) {
        setDropIntent(foundTarget, foundDir);
        dockIntent.targetPanelId = foundTarget;
        dockIntent.direction = foundDir;
      } else {
        setDropIntent(null, null);
        dockIntent.targetPanelId = null;
        dockIntent.direction = null;
      }
    };
"""
code = mm_regex.sub(new_mm, code)

# 6. handleMouseUp
mu_regex = re.compile(r'const handleMouseUp = \(e: MouseEvent\) => \{.*?setCompassDir\(null\);\n\s+\};\n', re.MULTILINE | re.DOTALL)
new_mu = """const handleMouseUp = (e: MouseEvent) => {
      const { dragInfo } = useDockLayoutStore.getState();
      if (!dragInfo) return;

      const dx = dragInfo.currentX - dragInfo.startX;
      const dy = dragInfo.currentY - dragInfo.startY;
      const dragDistance = Math.sqrt(dx * dx + dy * dy);

      if (dragDistance < 5) {
        cancelDrag();
      } else if (dockIntent.targetPanelId && dockIntent.direction) {
        endDrag(dockIntent.targetPanelId, dockIntent.direction as any);
      } else if (dragInfo.isFloating) {
        let newX = Math.max(20, Math.min(e.clientX - 200, window.innerWidth - 200));
        let newY = Math.max(20, Math.min(e.clientY - 50, window.innerHeight - 200));
        updateFloatingPosition(dragInfo.panelId, { x: newX, y: newY });
        endDrag();
      } else {
        let newX = Math.max(20, Math.min(e.clientX - 200, window.innerWidth - 200));
        let newY = Math.max(20, Math.min(e.clientY - 50, window.innerHeight - 200));
        floatPanel(dragInfo.panelId, { x: newX, y: newY });
        endDrag();
      }

      dockIntent.targetPanelId = null;
      dockIntent.direction = null;
    };
"""
code = mu_regex.sub(new_mu, code)

# 7. useEffect reset code
code = code.replace("setDropTargetId(null);\n      setCompassDir(null);\n", "")

# 8. PanelSlot preview
ps_regex = re.compile(r'\{showPreview && <DockPreview direction=\{compassDir\} />\}')
new_ps = "{showPreview && !compassDir?.startsWith('edge-') && <DockPreview direction={compassDir} />}"
code = ps_regex.sub(new_ps, code)

# 9. GlobalEdgePreview EXPORT
code += """
export const GlobalEdgePreview: React.FC = () => {
  const { dragState, compassDir } = useDockLayoutStore();
  if (dragState !== 'dragging' || !compassDir?.startsWith('edge-')) return null;
  return <DockPreview direction={compassDir} isGlobal={true} />;
};
"""

with open('src/components/dock/DockContainer.tsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Done resetting and reapplying.")
