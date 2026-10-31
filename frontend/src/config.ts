const env = import.meta.env;

export const API_URL: string = (env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
export const WS_URL: string = (env.VITE_WS_URL || API_URL.replace(/^http/, 'ws')).replace(/\/$/, '');

export const DEFAULT_DECK = 'fibonacci';

export const COFFEE_CARD = '☕';
export const STORY_DECK = ['1', '2', '3', '5', '8', '13', '20', COFFEE_CARD] as const;
