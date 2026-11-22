import { API } from './modules/api.js';
import { loginDemo, logoutSession } from './modules/session.js';

// Public contract used by the capture scripts and the shell.
export const AlfiAPI = Object.assign(API, { login: loginDemo, logout: logoutSession });
window.AlfiAPI = AlfiAPI;
