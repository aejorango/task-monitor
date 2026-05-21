// src/components/WorkspaceEditor.jsx — create / edit a workspace.

import { useRef, useState } from 'react';
import { useAuth } from '../hooks/useTasks';
import {
  addWorkspace,
  updateWorkspace,
  softDeleteWorkspace,
  uploadFile,
  deleteUpload,
} from '../services/firebase';

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
const ICONS  = ['◆', '◉', '◈', '▲', '★', '☀', '✦', '✿', '⌘', '⚡', '☂', '✈'];

export default function WorkspaceEditor({ workspace, onClose }) {
  const { userId } = useAuth();
  const isNew = !workspace;
  const [name, setName]           = useState(workspace?.name || '');
  const [description, setDescr]   = useState(workspace?.description || '');
  const [color, setColor]         = useState(workspace?.color || COLORS[0]);
  const [icon,  setIcon]          = useState(workspace?.icon  || ICONS[0]);
  const [logoUrl, setLogoUrl]     = useState(workspace?.logoUrl || '');
  const [logoPath, setLogoPath]   = useState(workspace?.logoPath || '');
  const [logoUrlInput, setLogoUrlInput] = useState(workspace?.logoUrl || '');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [logoError, setLogoError] = useState(null);
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const fileInputRef = useRef(null);
  const [saving, setSaving]       = useState(false);

  const pickLogo = () => fileInputRef.current?.click();

  const onLogoChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !userId) return;
    if (!file.type.startsWith('image/')) {
      setLogoError('Logo must be an image file.');
      return;
    }
    setLogoError(null);
    setLogoPreviewError(false);
    setUploading(true);
    setUploadPct(0);
    try {
      const prevPath = logoPath;
      const att = await uploadFile({
        userId,
        taskId: `workspace-logos/${workspace?.id || 'new'}`,
        file,
        onProgress: setUploadPct,
      });
      setLogoUrl(att.url);
      setLogoUrlInput(att.url);
      setLogoPath(att.path);
      if (prevPath) deleteUpload(prevPath);
    } catch (err) {
      console.error(err);
      const code = err?.code || err?.name || '';
      const detail = err?.message || String(err);
      setLogoError(
        code
          ? `Upload failed (${code}): ${detail}. Try pasting a public image URL below instead.`
          : `Upload failed: ${detail}. Try pasting a public image URL below instead.`
      );
    } finally {
      setUploading(false);
    }
  };

  const applyUrl = () => {
    setLogoError(null);
    setLogoPreviewError(false);
    const url = logoUrlInput.trim();
    if (!url) {
      // Clear logo entirely
      const prevPath = logoPath;
      setLogoUrl('');
      setLogoPath('');
      if (prevPath) deleteUpload(prevPath);
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setLogoError('Logo URL must start with http:// or https://');
      return;
    }
    // Linking an external URL means we no longer "own" a storage path —
    // if a previous upload existed, delete it from storage to free space.
    if (logoPath && url !== logoUrl) {
      deleteUpload(logoPath);
      setLogoPath('');
    }
    setLogoUrl(url);
  };

  const clearLogo = () => {
    const prevPath = logoPath;
    setLogoUrl('');
    setLogoUrlInput('');
    setLogoPath('');
    setLogoPreviewError(false);
    if (prevPath) deleteUpload(prevPath);
  };

  const save = async () => {
    if (!name.trim()) { alert('Workspace name is required.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        color,
        icon,
        logoUrl: logoUrl || '',
        logoPath: logoPath || '',
      };
      if (isNew) {
        const result = await addWorkspace(userId, payload);
        onClose(result.id);
      } else {
        await updateWorkspace(workspace.id, payload);
        onClose();
      }
    } catch (err) {
      console.error(err);
      alert('Could not save workspace. ' + (err?.message || ''));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete workspace "${workspace.name}"? Projects and tasks inside it become inaccessible. This is a soft delete; an admin can recover via Firestore.`)) return;
    setSaving(true);
    try { await softDeleteWorkspace(workspace.id); onClose(); }
    catch (err) { console.error(err); alert('Could not delete workspace.'); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3 className="modal-title">{isNew ? 'Create workspace' : 'Edit workspace'}</h3>
        <p className="modal-sub">A workspace contains projects, tasks, activities, and templates. Members of the workspace can see and edit everything inside it.</p>

        <div className="field-row">
          <div className="field" style={{ flex: '0 0 64px' }}>
            <label className="label">Preview</label>
            <div className="ws-icon-preview" style={{ background: (logoUrl && !logoPreviewError) ? 'transparent' : color, overflow: 'hidden' }}>
              {logoUrl && !logoPreviewError
                ? <img
                    src={logoUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setLogoPreviewError(true)}
                    onLoad={() => setLogoPreviewError(false)}
                  />
                : icon}
            </div>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Name</label>
            <input
              autoFocus
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Personal, Bridged, Client Work"
            />
          </div>
        </div>

        <div className="field">
          <label className="label">Logo (optional)</label>
          <p className="muted small" style={{ marginTop: 0 }}>
            Use a logo image instead of the icon below. Either <strong>upload</strong> a file or <strong>paste a public image URL</strong>.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onLogoChange}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" className="btn btn-sm" onClick={pickLogo} disabled={uploading}>
              {uploading ? `Uploading… ${Math.round(uploadPct * 100)}%` : (logoUrl && logoPath ? 'Replace uploaded logo' : '⬆ Upload image')}
            </button>
            {logoUrl && !uploading && (
              <button type="button" className="btn btn-sm btn-ghost link-danger" onClick={clearLogo}>
                Remove logo
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'center' }}>
            <input
              className="input input-sm"
              type="url"
              value={logoUrlInput}
              onChange={(e) => setLogoUrlInput(e.target.value)}
              placeholder="https://example.com/logo.png"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyUrl(); } }}
            />
            <button type="button" className="btn btn-sm" onClick={applyUrl} disabled={uploading}>
              Use URL
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>
            Tip: right-click any web image → "Copy image address", or use a hosted URL (Google Drive direct-link, Imgur, your CDN, etc.).
          </p>

          {logoPreviewError && logoUrl && (
            <p className="auth-error-msg" style={{ marginTop: 6 }}>
              That URL didn't load as an image. Check it's a direct link to a .png / .jpg / .svg file, not a webpage.
            </p>
          )}
          {logoError && <p className="auth-error-msg" style={{ marginTop: 6 }}>{logoError}</p>}
        </div>

        <div className="field">
          <label className="label">Description (optional)</label>
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescr(e.target.value)} placeholder="What's this workspace for?" />
        </div>

        <div className="field">
          <label className="label">Color</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: c, border: color === c ? '2px solid var(--c-text)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">Icon</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ICONS.map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIcon(i)}
                title={i}
                className={`icon-pick ${icon === i ? 'selected' : ''}`}
              >{i}</button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          {!isNew && <button className="btn btn-danger" onClick={remove} disabled={saving}>Delete</button>}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => onClose()} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : (isNew ? 'Create' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
