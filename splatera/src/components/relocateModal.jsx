import React, { useState, useEffect } from 'react';
import { X, Check, FolderOpen } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import TextField from './textField';
import Button from './button';
import './relocateModal.css';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov'];

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { js: 'javascript', py: 'python', rs: 'rust', html: 'html', css: 'css', json: 'json', md: 'markdown' };
  return map[ext.toLowerCase()] || 'text';
};

export default function RelocateModal({
  title = "Locate missing file",
  data,
  onConfirm,
  onCancel,
}) {
  if (!data) return null;

  const [selectedPath, setSelectedPath] = useState('');

  // Global ESC key listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onCancel) onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const fileName = data.file_name || data.name || 'Unknown File';
  const origPath = data.path || data.original_path || '';
  const ext = fileName.split('.').pop().toLowerCase();
  const isCodeOrText = data.kind === 'Code' || data.kind === 'Text';
  const isVideo = data.kind === 'Video' || VIDEO_EXTS.includes(ext);
  const isImage = !isCodeOrText && !isVideo;

  const previewSrc = data.preview
    ? data.preview
    : (data.previewPath ? convertFileSrc(data.previewPath) : null);

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Select replacement for "${fileName}"`,
      });
      if (!selected) return;
      const rawPath = typeof selected === 'object' && selected !== null && selected.path
        ? selected.path
        : selected;
      if (rawPath) {
        setSelectedPath(rawPath);
      }
    } catch (err) {
      console.error('File dialog error:', err);
    }
  };

  const handleConfirm = () => {
    if (!selectedPath.trim()) return;
    if (onConfirm) onConfirm(selectedPath.trim());
  };

  return (
    <div
      className="relocate-modal-overlay"
      onMouseDown={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
    >
      <div className="relocate-modal-container" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header Title */}
        <div className="relocate-modal-title">{title}</div>

        {/* Preview Box */}
        <div className="relocate-modal-preview-box">
          {previewSrc && (
            <img src={previewSrc} alt="preview" className="relocate-modal-preview-media" />
          )}
          {!previewSrc && isCodeOrText && data.contentSnippet && (
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

        {/* Missing File Info */}
        <div className="relocate-modal-info">
          <div className="relocate-modal-info-label">Original path:</div>
          <div>{origPath || fileName}</div>
        </div>

        {/* Path Selection Row */}
        <div className="relocate-modal-path-row">
          <div className="relocate-modal-input-wrap">
            <TextField
              autoFocus
              placeholder="Select or enter new file path..."
              value={selectedPath}
              onChange={(e) => setSelectedPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            />
          </div>
          <Button
            icon={FolderOpen}
            text="Browse..."
            onClick={handleBrowse}
            className="relocate-modal-browse-btn"
          />
        </div>

        {/* Footer Action Buttons */}
        <div className="relocate-modal-footer">
          <Button
            icon={X}
            text="Cancel"
            onClick={onCancel}
            className="relocate-modal-btn-flex"
          />
          <Button
            icon={Check}
            text="Confirm Relocation"
            onClick={handleConfirm}
            className="relocate-modal-btn-flex"
            disabled={!selectedPath.trim()}
          />
        </div>
      </div>
    </div>
  );
}
