import type { IconName } from '../ui/Icon';

export interface StampOption {
    subtype: string;
    label: string;
    icon: IconName;
}

export const STAMP_OPTIONS = [
    { subtype: 'thumbsUp', label: 'Thumbs Up', icon: 'thumbs-up' },
    { subtype: 'thumbsDown', label: 'Thumbs Down', icon: 'thumbs-down' },
    { subtype: 'arrowUp', label: 'Arrow Up', icon: 'arrow-up' },
    { subtype: 'arrowDown', label: 'Arrow Down', icon: 'arrow-down' },
    { subtype: 'stopSign', label: 'Stop Sign', icon: 'stop' },
    { subtype: 'checkSign', label: 'Check Sign', icon: 'check-circle' },
    { subtype: 'leftPriceLabel', label: 'Left Price Label', icon: 'label' },
    { subtype: 'rightPriceLabel', label: 'Right Price Label', icon: 'label' },
    { subtype: 'buy', label: 'Buy', icon: 'arrow-up' },
    { subtype: 'sell', label: 'Sell', icon: 'arrow-down' },
    { subtype: 'arrow', label: 'Arrow', icon: 'arrow-right' },
] as const satisfies readonly StampOption[];
