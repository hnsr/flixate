import { useRegisterSW } from "virtual:pwa-register/react";

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function UpdatePrompt(): React.JSX.Element | null {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_scriptUrl, registration) {
      if (!registration) return;
      window.setInterval(() => void registration.update(), UPDATE_INTERVAL_MS);
    },
  });

  if (!offlineReady && !needRefresh) return null;

  const dismiss = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <aside className="update-prompt" role={needRefresh ? "alert" : "status"} aria-live="polite">
      <div>
        <strong>{needRefresh ? "A fresh Flixate is ready" : "Flixate is ready offline"}</strong>
        <p>
          {needRefresh
            ? "Reload when convenient to use the latest app and catalog loader."
            : "The app shell and previously opened catalog data can now work without a connection."}
        </p>
      </div>
      <div className="update-prompt-actions">
        {needRefresh && (
          <button className="primary-button" type="button" onClick={() => void updateServiceWorker(true)}>
            Reload
          </button>
        )}
        <button className="secondary-button" type="button" onClick={dismiss}>
          {needRefresh ? "Later" : "Got it"}
        </button>
      </div>
    </aside>
  );
}
