import * as App from "../wailsjs/go/main/App";

export const APP_CONSTANTS = {
    get title(): Promise<string> {
        return App.GetTitle().catch(() => 'New App');
    },

    get colors() {
        return Object.freeze({
            primary: '#222020',
            secondary: '#ffffff'
        } as const);
    }
};
