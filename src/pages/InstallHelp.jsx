import { Link } from 'react-router-dom';

export default function InstallHelp() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-serif text-umc-900">Install on your phone</h1>

      <section className="card">
        <h2 className="text-lg font-serif text-umc-900 mb-2">iPhone (Safari)</h2>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-2">
          <li>Open this page in Safari (not Chrome).</li>
          <li>Tap the Share button (square with an up arrow) at the bottom.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. The bulletin will appear as an app icon.</li>
        </ol>
      </section>

      <section className="card">
        <h2 className="text-lg font-serif text-umc-900 mb-2">Android (Chrome)</h2>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-2">
          <li>Open this page in Chrome.</li>
          <li>Tap the three-dot menu in the top right.</li>
          <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>Confirm. The bulletin will appear as an app icon.</li>
        </ol>
      </section>

      <p className="text-center">
        <Link to="/" className="text-umc-700 underline text-sm">
          ← Back to bulletin
        </Link>
      </p>
    </div>
  );
}
