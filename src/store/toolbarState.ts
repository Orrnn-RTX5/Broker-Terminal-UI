import type { PayloadFor } from '../types/commands';
import { DEFAULT_CHART_TIMEFRAME } from '../constants/chartDefaults';

export interface ToolbarState {
  activeTool: PayloadFor<'SELECT_TOOL'>['tool'] | null;
  chartType: 'candlestick' | 'bar' | 'line' | 'area';
  timeframe: string;
  crosshairEnabled: boolean;
  autoScrollEnabled: boolean;
  chartShiftEnabled: boolean;
  magnetEnabled: boolean;
  candleWidth: number; // for zoom
  indicators: Array<{ name: string; params: any }>;
  drawings: Array<{ id: string; type: string; points: any[] }>;
}

export type ToolbarAction =
  | { type: 'SELECT_TOOL'; tool: ToolbarState['activeTool']; subtype?: string }
  | { type: 'SET_CHART_TYPE'; chartType: ToolbarState['chartType'] }
  | { type: 'SET_TIMEFRAME'; timeframe: string }
  | { type: 'TOGGLE_CROSSHAIR' }
  | { type: 'TOGGLE_AUTO_SCROLL' }
  | { type: 'SET_AUTO_SCROLL'; enabled: boolean }
  | { type: 'TOGGLE_CHART_SHIFT' }
  | { type: 'SET_CHART_SHIFT'; enabled: boolean }
  | { type: 'TOGGLE_MAGNET' }
  | { type: 'EXPORT_CHART' }
  | { type: 'ZOOM'; delta: number }
  | { type: 'ADD_INDICATOR'; indicator: { name: string; params: any } }
  | { type: 'REMOVE_INDICATOR'; name: string }
  | { type: 'ADD_DRAWING'; drawing: { id: string; type: string; points: any[] } }
  | { type: 'DELETE_DRAWING'; id: string }
  | { type: 'CLEAR_DRAWINGS' };

export const initialToolbarState: ToolbarState = {
  activeTool: null,
  chartType: (typeof window !== 'undefined' ? localStorage.getItem('rtx5_chart_type') as ToolbarState['chartType'] : null) || 'candlestick',
  timeframe: DEFAULT_CHART_TIMEFRAME,
  crosshairEnabled: false,
  autoScrollEnabled: false,
  chartShiftEnabled: false,
  magnetEnabled: false,
  candleWidth: 10,
  indicators: [],
  drawings: []
};

export function toolbarReducer(state: ToolbarState, action: ToolbarAction): ToolbarState {
  switch (action.type) {
    case 'SELECT_TOOL':
     
      return {
        ...state,
        activeTool: action.tool === 'cursor' ? null : action.tool
      };

    case 'SET_CHART_TYPE':
      return {
        ...state,
        chartType: action.chartType
      };

    case 'SET_TIMEFRAME':
      return {
        ...state,
        timeframe: action.timeframe
      };

    case 'TOGGLE_CROSSHAIR':
      return {
        ...state,
        crosshairEnabled: !state.crosshairEnabled
      };

    case 'TOGGLE_AUTO_SCROLL':
      return {
        ...state,
        autoScrollEnabled: !state.autoScrollEnabled
      };

    case 'SET_AUTO_SCROLL':
      return {
        ...state,
        autoScrollEnabled: action.enabled
      };

    case 'TOGGLE_CHART_SHIFT':
      return {
        ...state,
        chartShiftEnabled: !state.chartShiftEnabled
      };

    case 'SET_CHART_SHIFT':
      return {
        ...state,
        chartShiftEnabled: action.enabled
      };

    case 'TOGGLE_MAGNET':
      return {
        ...state,
        magnetEnabled: !state.magnetEnabled
      };

    case 'ZOOM': {
      const newWidth = Math.max(2, Math.min(50, state.candleWidth + action.delta));
      return {
        ...state,
        candleWidth: newWidth
      };
    }

    case 'ADD_INDICATOR':
      // Prevent duplicate indicators
      if (state.indicators.some(ind => ind.name === action.indicator.name)) {
        return state;
      }
      return {
        ...state,
        indicators: [...state.indicators, action.indicator]
      };

    case 'REMOVE_INDICATOR':
      return {
        ...state,
        indicators: state.indicators.filter(ind => ind.name !== action.name)
      };

    case 'ADD_DRAWING':
      return {
        ...state,
        drawings: [...state.drawings, action.drawing]
      };

    case 'DELETE_DRAWING':
      return {
        ...state,
        drawings: state.drawings.filter(d => d.id !== action.id)
      };

    case 'CLEAR_DRAWINGS':
      return {
        ...state,
        drawings: []
      };

    default:
      return state;
  }
}
