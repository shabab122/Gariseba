import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useMutation } from './admin-config.jsx';
import { Alert, Checkbox, Dialog, Field } from './ui.jsx';

export function TechnicianAccount({ technician, close }) {
  const [account, setAccount] = useState(undefined);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const endpoint = '/admin/technicians/' + technician._id + '/account';
  const mutation = useMutation(() => { setPassword(''); setSaved(true); setLoading(true); setReload((value) => value + 1); });
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setLoading(true);
    api(endpoint, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setAccount(result.account);
      setUsername(result.account?.username || '');
      setEnabled(result.account?.enabled !== false);
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, reload]);
  return <Dialog title={'Login account · ' + technician.name} description="The technician signs in at /admin and sees only their own assignments. Saving account changes signs out that technician's current sessions." onClose={() => !mutation.busy && close()}>
    {error && <Alert>{error} <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Refresh account</button></Alert>}
    {account === undefined && !error && <p className="muted">Loading account…</p>}
    {account !== undefined && <form className="dialog-form" onSubmit={(event) => {
      event.preventDefault();
      setSaved(false);
      mutation.submit(endpoint, { method: account ? 'PATCH' : 'POST', body: account
        ? { version: account.version, enabled, ...(password ? { password } : {}) }
        : { username, password, enabled } });
    }}>
      <Field id="technician-username" label="Technician username"><input id="technician-username" value={username} disabled={Boolean(account)} onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9._\-]{3,40}" minLength={3} maxLength={40} autoComplete="off" required /></Field>
      <Field id="technician-account-password" label={account ? 'New password (leave blank to keep it)' : 'Initial password'} optional={Boolean(account)}><input id="technician-account-password" type="password" value={password} minLength={12} maxLength={72} autoComplete="new-password" required={!account} disabled={mutation.busy || loading} onChange={(event) => setPassword(event.target.value)} /></Field>
      <p className="muted text-sm">Use at least 12 characters, including a letter and a number. Share the initial password with the technician through your usual private channel.</p>
      <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)}>Allow technician sign-in</Checkbox>
      {mutation.error && <Alert>{mutation.error} <button type="button" className="text-link" onClick={() => setReload((value) => value + 1)}>Refresh account</button></Alert>}
      {saved && <Alert kind="success">Technician login account saved.</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-outline" onClick={close} disabled={mutation.busy}>Close</button>
        <button type="submit" className="btn btn-primary" disabled={mutation.busy || loading}>{mutation.busy ? 'Saving…' : account ? 'Save account changes' : 'Create login account'}</button>
      </div>
    </form>}
  </Dialog>;
}
