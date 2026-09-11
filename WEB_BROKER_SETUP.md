# Select the web terminal broker

Edit `.env.web`. Lines starting with `#` are disabled. Remove `#` from **every setting in one broker block**, and add `#` to the settings in all other broker blocks. Keep the shared web settings enabled.

For example, to use Achiever Financials, uncomment the **Achiever Financials** block and comment out the **TEST** block. The active broker ID should then be:

```dotenv
VITE_BROKER_ID=achiever-financials
```

Restart the development server:

```powershell
npm run dev:web
```

Open `http://127.0.0.1:5173` and log in with that broker's account. Changing brokers requires a fresh login; saved accounts, language, chart preferences, and other settings are retained. Reloading the same broker keeps its valid session.

TEST, Achiever Financials, MyProp, and Grow Trading Academy have complete blocks. Only one block may be active. Startup reports duplicate active settings instead of combining brokers. An explicitly set shell variable or `.env.web.local` can override `.env.web`, following Vite's normal precedence.

## Production

```powershell
npm run build:web
```

Deploy the resulting `dist` directory. Vite automatically generates `dist/runtime-config.js` from the selected environment. Editing `public/runtime-config.js` is unnecessary.

Docker keeps the broker selected during the build when no deployment broker override is supplied. To override the image at container startup, provide that broker's complete runtime configuration, including `BROKER_ID`, `API_HOST`, `WS_HOST`, `DEFAULT_MT5_SERVER`, and `DISCOVERY_BASE_URL` (plus the corresponding feed settings when required).

Electron uses its own broker/session selection and `.env.electron`; web configuration does not replace its selected broker.
