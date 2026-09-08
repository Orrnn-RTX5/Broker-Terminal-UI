import { useEffect, useRef, useState } from 'react';
import { drawingManager, type Drawing } from '../services/drawingManager';
import { useAppStore } from '../store/useAppStore';
import type { PositionSizing } from './positionDrawingValues';

export function PositionDrawingSettings({ drawing, contextId, onClose }: {
  drawing: Drawing; contextId?: string; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const account = useAppStore(state => state.account);
  const [error, setError] = useState('');
  const sizing = drawing.positionSizing;
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const numeric = (key: string) => Number(data.get(key));
    const entry = numeric('entry'); const target = numeric('target'); const stop = numeric('stop');
    const direction = drawing.subtype === 'long_position' ? 1 : -1;
    if (direction * (target - entry) <= 0 || direction * (entry - stop) <= 0) {
      setError('Target and stop must be on opposite sides of entry for this position.'); return;
    }
    const settings: PositionSizing = {
      accountSize: numeric('accountSize'), risk: numeric('risk'),
      riskMode: data.get('riskMode') as PositionSizing['riskMode'],
      pointValue: numeric('pointValue'), lotSize: numeric('lotSize'),
      quantityPrecision: numeric('quantityPrecision'),
      ...(data.get('leverage') ? { leverage: numeric('leverage') } : {}),
    };
    if (drawingManager.updateDrawingProperties(drawing.id, {
      points: drawing.points.map((point, index) => index === 0 ? { ...point, price: entry } : point),
      positionTargetPrice: target, positionStopPrice: stop, positionSizing: settings,
    }, contextId)) onClose();
  };
  return <dialog ref={dialogRef} className="position-drawing-settings" aria-label="Position drawing settings" onCancel={onClose} onClose={onClose}>
    <form onSubmit={submit}>
      <h2>Position drawing settings</h2>
      <label>Account size<input name="accountSize" type="number" min="0.00000001" step="any" required defaultValue={sizing?.accountSize ?? account?.balance ?? ''} /></label>
      <label>Risk<input name="risk" type="number" min="0.00000001" step="any" required defaultValue={sizing?.risk ?? ''} /></label>
      <label>Risk unit<select name="riskMode" defaultValue={sizing?.riskMode ?? 'percent'}><option value="percent">% of account</option><option value="amount">Account currency</option></select></label>
      <label>Point value<input name="pointValue" type="number" min="0.00000001" step="any" required defaultValue={sizing?.pointValue ?? ''} aria-describedby="position-point-value-help" /></label>
      <p id="position-point-value-help">Account-currency value of one price unit per unit of the instrument.</p>
      <label>Lot size<input name="lotSize" type="number" min="0.00000001" step="any" required defaultValue={sizing?.lotSize ?? 1} /></label>
      <label>Leverage<input name="leverage" type="number" min="0.00000001" step="any" defaultValue={sizing?.leverage ?? ''} placeholder="No cap" /></label>
      <label>Quantity decimals<input name="quantityPrecision" type="number" min="0" max="8" step="1" required defaultValue={sizing?.quantityPrecision ?? 2} /></label>
      <label>Entry price<input name="entry" type="number" step="any" required defaultValue={drawing.points[0]?.price} /></label>
      <label>Target price<input name="target" type="number" step="any" required defaultValue={drawing.positionTargetPrice} /></label>
      <label>Stop price<input name="stop" type="number" step="any" required defaultValue={drawing.positionStopPrice} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="position-drawing-settings__actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit">Apply</button></div>
    </form>
  </dialog>;
}
