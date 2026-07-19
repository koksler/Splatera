import React, { useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import TextField from './textField';
import Button from './button';
import './inputModal.css';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov'];

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { js: 'javascript', py: 'python', rs: 'rust', html: 'html', css: 'css', json: 'json', md: 'markdown' };
  return map[ext.toLowerCase()] || 'text';
};

export default function InputModal({ title = "Let’s rename this", data, onConfirm, onCancel }) {
  if (!data) return null;

  const [value, setValue] = useState(data.file_name || data.name || '');

  const ext = (data.file_name || data.name || '').split('.').pop().toLowerCase();
  const isCodeOrText = data.kind === 'Code' || data.kind === 'Text';
  const isVideo = data.kind === 'Video' || VIDEO_EXTS.includes(ext);
  const isImage = !isCodeOrText && !isVideo && (data.preview || data.path || IMAGE_EXTS.includes(ext));

  const previewSrc = isImage
    ? (data.preview || (data.path ? convertFileSrc(data.path) : null))
    : (isVideo ? (data.path ? convertFileSrc(data.path) : null) : null);

  const handleConfirm = () => {
    if (onConfirm) onConfirm(value);
  };

  return (
    <div
      className="input-modal-overlay"
      onMouseDown={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
    >
      <div className="input-modal-container" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header Title */}
        <div className="input-modal-title">Let’s rename this</div>

        {/* Square Preview Box (230x230) */}
        <div className="input-modal-preview-box">
          {previewSrc && !isVideo && (
            <img src={previewSrc} alt="preview" className="input-modal-preview-media" />
          )}
          {previewSrc && isVideo && (
            <video
              src={previewSrc}
              className="input-modal-preview-media"
              muted
              autoPlay
              loop
              playsInline
            />
          )}
          {isCodeOrText && data.contentSnippet && (
            <SyntaxHighlighter
              language={getLanguage(ext)}
              style={vscDarkPlus}
              customStyle={{
                margin: 0,
                padding: '12px',
                background: 'transparent',
                fontSize: '11px',
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
              }}
              wrapLongLines
            >
              {data.contentSnippet}
            </SyntaxHighlighter>
          )}
          {!previewSrc && !data.contentSnippet && (
            <span style={{ color: 'var(--color-text-button)', fontSize: '12px' }}>
              No preview available
            </span>
          )}
        </div>

        {/* TextField */}
        <div style={{ width: '100%' }}>
          <TextField
            autoFocus
            placeholder="Enter a new name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
          />
        </div>

        {/* Footer Action Buttons */}
        <div className="input-modal-footer">
          <Button
            icon={X}
            text="Close"
            onClick={onCancel}
            className="input-modal-btn-flex"
          />
          <Button
            icon={RotateCcw}
            text="Confirm"
            onClick={handleConfirm}
            className="input-modal-btn-flex"
          />
        </div>
      </div>
    </div>
  );
}