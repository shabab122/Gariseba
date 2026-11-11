import { useEffect, useRef, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { api } from './api.js';
import { Alert, dateTime } from './ui.jsx';

export function OpenAIConnection() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function testConnection() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setResult(null);
    setError('');
    try {
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
      const response = await api('/admin/ai/test', { method: 'POST', body: {}, signal });
      if (request.signal.aborted) return;
      if (signal.aborted || typeof response.ok !== 'boolean' || typeof response.message !== 'string' || typeof response.code !== 'string') {
        throw new Error('The connection test did not return a valid result. Try again.');
      }
      setResult(response);
    } catch (err) {
      if (!request.signal.aborted) {
        setError(err.name === 'TimeoutError' ? 'The connection test timed out. Check the server connection and try again.' : err.message);
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return <section className="panel admin-config mb-4" aria-labelledby="openai-connection-title">
    <div>
      <h2 id="openai-connection-title">OpenAI connection</h2>
      <p className="muted mt-2">Test the current server settings with a short vehicle question. Your OpenAI API account may charge for this test.</p>
    </div>
    <div aria-live="polite">
      {busy && <p className="muted" role="status">Waiting for OpenAI…</p>}
      {error && <Alert>{error}</Alert>}
      {result && <Alert kind={result.ok ? 'success' : 'warning'}>
        <p>{result.message}</p>
        <p className="mt-1 text-sm">Result code <code>{result.code}</code></p>
        <p className="muted mt-1 text-sm">Checked <time dateTime={result.checkedAt}>{dateTime(result.checkedAt, 'en', 'medium')}</time></p>
      </Alert>}
    </div>
    <button type="button" className="btn btn-outline justify-self-start" disabled={busy} onClick={testConnection}>
      <PlugZap size={17} />{busy ? 'Testing connection…' : 'Test OpenAI connection'}
    </button>
    <p className="muted text-sm">After editing the server environment, restart the app before testing. Up to three tests are allowed per minute.</p>
  </section>;
}
