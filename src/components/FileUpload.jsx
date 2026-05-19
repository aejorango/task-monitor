// src/components/FileUpload.jsx — drag-and-drop / click upload that pushes
// to Firebase Storage and appends to a local attachments[] state.

import { useState, useRef } from 'react';
import { uploadFile, deleteUpload } from '../services/firebase';
import { useAuth } from '../hooks/useTasks';

export default function FileUpload({ taskId, attachments, onChange, multiple = true }) {
  const { userId } = useAuth();
  const [uploading, setUploading] = useState([]); // [{ name, progress }]
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const dropRef  = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (files) => {
    if (!files || files.length === 0 || !userId) return;
    setError(null);
    const list = Array.from(files);
    const slots = list.map((f) => ({ id: Math.random().toString(36).slice(2), name: f.name, progress: 0 }));
    setUploading((cur) => [...cur, ...slots]);

    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const slot = slots[i];
      try {
        const att = await uploadFile({
          userId,
          taskId: taskId || null,
          file: f,
          onProgress: (frac) => {
            setUploading((cur) => cur.map((s) => s.id === slot.id ? { ...s, progress: frac } : s));
          },
        });
        onChange([...(attachments || []), att]);
      } catch (err) {
        console.error(err);
        setError(`${f.name}: ${err.message || err}`);
      } finally {
        setUploading((cur) => cur.filter((s) => s.id !== slot.id));
      }
    }
  };

  const remove = async (att) => {
    onChange((attachments || []).filter((a) => a !== att));
    if (att.path) deleteUpload(att.path);
  };

  return (
    <div className="file-upload">
      <div
        ref={dropRef}
        className={`file-drop ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          style={{ display: 'none' }}
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <span className="muted small">
          📎 Drop files here or <span className="table-link">click to choose</span>
        </span>
      </div>

      {error && (
        <div className="auth-error" style={{ marginTop: 8 }}>
          <p className="auth-error-msg">{error}</p>
        </div>
      )}

      {uploading.length > 0 && (
        <div className="upload-progress-list">
          {uploading.map((u) => (
            <div key={u.id} className="upload-row">
              <span className="upload-name">⬆ {u.name}</span>
              <div className="csv-progress-bar" style={{ flex: 1, margin: '0 8px' }}>
                <div className="csv-progress-fill" style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </div>
              <span className="mono small">{Math.round(u.progress * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {(attachments?.length > 0) && (
        <ul className="attachments-grid">
          {attachments.map((a, i) => (
            <li key={a.path || a.url || i} className="attachment-tile">
              {a.type === 'image' ? (
                <a href={a.url} target="_blank" rel="noreferrer noopener" className="attachment-thumb">
                  <img src={a.url} alt={a.name} />
                </a>
              ) : (
                <a href={a.url} target="_blank" rel="noreferrer noopener" className="attachment-icon">
                  📄
                </a>
              )}
              <a href={a.url} target="_blank" rel="noreferrer noopener" className="attachment-name" title={a.name}>
                {a.name}
              </a>
              {a.size && <span className="muted small mono">{formatBytes(a.size)}</span>}
              <button type="button" className="link-danger" onClick={() => remove(a)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
