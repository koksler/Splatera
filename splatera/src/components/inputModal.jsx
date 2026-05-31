import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Input from './input';
import Button from './button';
import './inputModal.css';

const getLanguage = (ext) => {
  if (!ext) return 'text';
  const map = { js: 'javascript', py: 'python', rs: 'rust', html: 'html', css: 'css', json: 'json', md: 'markdown' };
  return map[ext.toLowerCase()] || 'text';
};

export default function InputModal({ title, data, onConfirm, onCancel }) {
  if (!data) {
    console.warn("InputModal: data prop is missing!");
    return null;
  }

  const [value, setValue] = useState(data.name || '');

  const isCodeOrText = data.kind === 'Code' || data.kind === 'Text';
  const imgSrc = !isCodeOrText && (data.preview || (data.path ? convertFileSrc(data.path) : null));
  const ext = data.name ? data.name.split('.').pop().toLowerCase() : '';

  const handleOverlayClick = (e) => {
    if (e.target.classList.contains('modal-overlay')) onCancel();
  };

  return (
    <div
      className="modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
    >
      <div className="modal-content">
        
        {/* IMAGE PREVIEW */}
        {imgSrc && (
          <div className="modal-preview-wrapper" style={{ marginBottom: '15px' }}>
            <img src={imgSrc} alt="preview" className="modal-preview-img" />
          </div>
        )}

        {/* CODE PREVIEW */}
        {isCodeOrText && data.contentSnippet && (
          <div 
            className="modal-preview-wrapper" 
            style={{ 
              alignItems: 'flex-start',
              overflow: 'hidden',
              backgroundColor: '#1E1E1E',
              marginBottom: '15px'
            }}
          >
            <SyntaxHighlighter
              language={getLanguage(ext)}
              style={vscDarkPlus}
              customStyle={{ 
                margin: 0, 
                padding: '15px',
                background: 'transparent', 
                fontSize: '11px',
                width: '100%',
                height: '100%',
                boxSizing: 'border-box'
              }}
              wrapLongLines={true}
            >
              {data.contentSnippet}
            </SyntaxHighlighter>
          </div>
        )}

        <div className="modal-header" style={{ marginBottom: '10px' }}>{title}</div>
        
        <div style={{ width: '100%', marginBottom: '15px' }}>
          <Input 
            autoFocus 
            value={value} 
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onConfirm(value)}
          />
        </div>

        <div className="modal-actions">
          <Button text="Cancel" onClick={onCancel} className="modal-btn" />
          <Button text="Confirm" onClick={() => onConfirm(value)} className="modal-btn" />
        </div>
      </div>
    </div>
  );
}